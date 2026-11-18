/**
 * AdStudioRun state machine. The user creates a batch from a Studio storyboard; the Mac adstudio-worker
 * (workers/adstudio-worker) claims runs over /api/worker/adstudio, re-analyses the storyboard, writes the plan
 * (hook, script, key frames, estimate) and stops at awaiting_approval; video is only generated after approve().
 *
 *   queued -> planning -> awaiting_approval -> approved -> generating -> completed
 *   any -> failed | cancelled          (no heartbeat for STALE_MS -> back to queued / approved)
 */
import { cleanBranding } from "./adstudio-branding";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { spendLedger } from "@/services/ops/budget-guard";
import { ACTIVE_STATES, END_CARD_THEMES, OPENING_STYLE, PLAN_READY, WORKER_STATES, isFormat, isWorkflow, planVariants, type AdStudioWorkflow } from "./adstudio-catalog";
import { END_CARDS, hookById } from "@/services/creative/library";
import { loadXarkContext } from "./adstudio-context";
import { framesFromScript, scriptIdOf } from "./adstudio-script-frames";
import { saveReviewInsight } from "./adstudio-results";
import { applyBudgetMode, budgetContext } from "./adstudio-budget";

export const STALE_MS = 120_000;
/** the only engine that finishes without an approval stop (stock footage, no spend) */
export const FREE_ENGINE = "remix";
const json = (v: unknown) => v as Prisma.InputJsonValue;

export class AdStudioError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export interface CreateBatchInput {
  projectId: string;
  storyboardId: string;
  hookTypes: string[];
  engines: string[];
  offer?: { text?: string; was?: number | null; now?: number | null; code?: string };
  notes?: string;
  createdById?: string | null;
  /** storyboard (default) | reference | replace — adstudio-catalog.ts ADSTUDIO_WORKFLOWS */
  workflow?: string;
  /** house hook library id (H01–H35), "auto" = the campaign plan's first hook, "" = none */
  openingId?: string;
  /** end-card template (E01–E12), "auto" = the campaign plan's end card, "" = Ad Studio's own close */
  endCardId?: string;
  endCardTheme?: string;
  /** video (default) | slides | mixed - see VISUAL_MODES */
  visualMode?: string;
  /** Ad Studio imitation format (auto | product_lock | interview | testimonial | single_scene | montage) */
  format?: string;
  /** logo / product photo / link / coupon / headline / button typed in the panel (adstudio-branding.ts) */
  branding?: unknown;
}

const SCRIPT_SELECT = { title: true, angle: true, hook: true, bodyBeats: true, cta: true, hookVariants: true, selectedHookIdx: true, ctaVariants: true, selectedCtaIdx: true } as const;

/** P3: a Creative script without a storyboard — its scenes / beats become the frames (adstudio-script-frames.ts) */
async function scriptSource(projectId: string, scriptId: string) {
  const row = await prisma.script.findUnique({ where: { id: scriptId }, select: { ...SCRIPT_SELECT, projectId: true, deletedAt: true, scenes: true, body: true, totalDurationSec: true } });
  if (!row || row.projectId !== projectId || row.deletedAt) throw new AdStudioError("Script not found", 404);
  const frames = framesFromScript(row);
  if (!frames.length) throw new AdStudioError("This script has no scenes, beats or hook yet");
  const script = { title: row.title, angle: row.angle, hook: row.hook, bodyBeats: row.bodyBeats, cta: row.cta, hookVariants: row.hookVariants, selectedHookIdx: row.selectedHookIdx, ctaVariants: row.ctaVariants, selectedCtaIdx: row.selectedCtaIdx };
  return {
    storyboard: { id: `script:${scriptId}`, title: row.title.replace(/^⚠\s*/, ""), frameSeconds: 2, totalDuration: `${Math.round(frames[frames.length - 1].endSec)}s`, frames, fromScript: true },
    script,
  };
}

export const REF_SOURCE = "ref:";
export const refUrlOf = (id: string) => (id.startsWith(REF_SOURCE) ? id.slice(REF_SOURCE.length) : null);

/** campaign plan defaults: its first platform's first hook and its end card */
export function planDefaults(plan: unknown): { hookId?: string; endCardId?: string } {
  const p = (plan as { platforms?: { hookVariants?: { hookId?: string }[]; endCard?: { id?: string } }[] } | null)?.platforms?.[0];
  return { hookId: p?.hookVariants?.[0]?.hookId, endCardId: p?.endCard?.id };
}

/** opening (house hook library) and ending (end-card template) for the batch; null = not used */
export function pickOpeningEnding(input: { openingId?: string; endCardId?: string; endCardTheme?: string }, plan: unknown) {
  const d = planDefaults(plan);
  const hid = input.openingId === "auto" ? d.hookId : input.openingId;
  const h = hid ? hookById(hid) : undefined;
  const opening = h ? { id: h.id, name: h.name, desc: h.desc, keyframe: h.keyframe, motion: h.motion, text: h.text, durationSec: h.durationSec, sfx: h.sfx, risk: h.risk, style: OPENING_STYLE[h.id] ?? null } : null;
  const eid = input.endCardId === "auto" ? d.endCardId : input.endCardId;
  const e = eid ? END_CARDS.find((x) => x.id === eid) : undefined;
  const theme = (END_CARD_THEMES as readonly string[]).includes(input.endCardTheme ?? "") ? input.endCardTheme : "brand";
  return { opening, endCard: e ? { id: e.id, name: e.name, theme } : null };
}

/** a reference video (competitor ad, TikTok / Instagram link, or an uploaded file) as the batch source */
async function referenceSource(projectId: string, url: string) {
  let u: URL;
  try { u = new URL(url); } catch { throw new AdStudioError("The reference must be a video link"); }
  if (!/^https?:$/.test(u.protocol)) throw new AdStudioError("The reference must be an http(s) link");
  const ad = await prisma.contentAsset.findFirst({ where: { projectId, OR: [{ url }, { videoUrl: url }] }, select: { title: true, overallScore: true } });
  return { id: `${REF_SOURCE}${url}`, title: ad?.title ?? u.hostname.replace(/^www\./, ""), frameSeconds: 2, totalDuration: null, frames: [], reference: { url, title: ad?.title ?? null, score: ad?.overallScore ?? null } };
}

/** Everything the worker needs, frozen at create time: the storyboard (or script) is read, never written. */
export async function buildInput(projectId: string, storyboardId: string) {
  const refUrl = refUrlOf(storyboardId);
  if (refUrl) {
    const [project, kit, src] = await Promise.all([
      prisma.project.findUnique({ where: { id: projectId }, select: { brandName: true, brandUrl: true, productUrl: true, productName: true, campaignGoal: true } }),
      prisma.brandKit.findUnique({ where: { projectId }, select: { offerText: true, landingUrl: true, ctaOptions: true, claimsAllowed: true, claimsForbidden: true, toneGuidelines: true, doNotShow: true } }),
      referenceSource(projectId, refUrl),
    ]);
    if (!project) throw new AdStudioError("Project not found", 404);
    if (!project.productUrl) throw new AdStudioError("Add the product page URL in Setup first — Ad Studio reads price and photos from it", 409);
    return { project, storyboard: src, script: null, brandKit: kit, context: await loadXarkContext(projectId, null) };
  }
  const fromScript = scriptIdOf(storyboardId);
  if (fromScript) {
    const [project, kit, src] = await Promise.all([
      prisma.project.findUnique({ where: { id: projectId }, select: { brandName: true, brandUrl: true, productUrl: true, productName: true, campaignGoal: true } }),
      prisma.brandKit.findUnique({ where: { projectId }, select: { offerText: true, landingUrl: true, ctaOptions: true, claimsAllowed: true, claimsForbidden: true, toneGuidelines: true, doNotShow: true } }),
      scriptSource(projectId, fromScript),
    ]);
    if (!project) throw new AdStudioError("Project not found", 404);
    if (!project.productUrl) throw new AdStudioError("Add the product page URL in Setup first — Ad Studio reads price and photos from it", 409);
    return { project, storyboard: src.storyboard, script: src.script, brandKit: kit, context: await loadXarkContext(projectId, fromScript) };
  }
  const [project, storyboard, kit] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { brandName: true, brandUrl: true, productUrl: true, productName: true, campaignGoal: true },
    }),
    prisma.storyboard.findUnique({ where: { id: storyboardId } }),
    prisma.brandKit.findUnique({
      where: { projectId },
      select: { offerText: true, landingUrl: true, ctaOptions: true, claimsAllowed: true, claimsForbidden: true, toneGuidelines: true, doNotShow: true },
    }),
  ]);
  if (!project) throw new AdStudioError("Project not found", 404);
  if (!storyboard || storyboard.projectId !== projectId || storyboard.deletedAt) throw new AdStudioError("Storyboard not found", 404);
  const frames = Array.isArray(storyboard.frames) ? storyboard.frames : [];
  if (!frames.length) throw new AdStudioError("This storyboard has no frames yet");
  if (!project.productUrl) throw new AdStudioError("Add the product page URL in Setup first — Ad Studio reads price and photos from it", 409);
  const script = storyboard.scriptId
    ? await prisma.script.findUnique({
        where: { id: storyboard.scriptId },
        select: SCRIPT_SELECT,
      })
    : null;
  return {
    project,
    storyboard: { id: storyboard.id, title: storyboard.title, frameSeconds: storyboard.frameSeconds, totalDuration: storyboard.totalDuration, frames },
    script,
    brandKit: kit,
    // Setup / Research / Insights / Planning / Creative — what the steps before Studio worked out (adstudio-context.ts)
    context: await loadXarkContext(projectId, storyboard.scriptId),
  };
}

export async function createBatch(input: CreateBatchInput) {
  const workflow: AdStudioWorkflow = isWorkflow(input.workflow) ? input.workflow : "storyboard";
  const isRef = !!refUrlOf(input.storyboardId);
  if (workflow === "storyboard" && isRef) throw new AdStudioError("Pick a storyboard or script for this workflow");
  if (workflow !== "storyboard" && !isRef) throw new AdStudioError("Pick a reference video for this workflow");
  const visualMode = visualModeOf({ visualMode: input.visualMode });
  // video mode needs footage the worker can generate: the stock-photo remix engine would bring product photos back
  if (visualMode === "video" && input.engines.some((e) => e === FREE_ENGINE)) throw new AdStudioError("Video mode needs an AI video engine - the stock remix uses product photos. Pick an engine, or choose Slides / Mixed.");
  const variants = planVariants(input.hookTypes, input.engines);
  const base = await buildInput(input.projectId, input.storyboardId);
  const plan = await prisma.project.findUnique({ where: { id: input.projectId }, select: { campaignPlan: true } });
  const { opening, endCard } = pickOpeningEnding(input, plan?.campaignPlan);
  const branding = cleanBranding(input.branding);
  const extra = { workflow, opening, endCard, format: isFormat(input.format) ? input.format : "auto", branding, visualMode };
  const batchId = randomUUID();
  const baseOffer = input.offer ?? (base.brandKit?.offerText ? { text: base.brandKit.offerText } : undefined);
  // typed coupon code / text win over the brand kit's offer
  const offer = branding.couponCode || branding.couponText ? { ...baseOffer, ...(branding.couponCode ? { code: branding.couponCode } : {}), ...(branding.couponText ? { text: branding.couponText } : {}) } : baseOffer;
  // budget fallback: while the Video Brain says the model budget is out, plan as $0 slides (adstudio-budget.ts)
  const budget = await budgetContext();
  return prisma.$transaction(async (tx) => {
    const leaders = new Map<string, string>();
    const runs = [];
    for (const v of variants) {
      const run = await tx.adStudioRun.create({
        data: {
          projectId: input.projectId,
          storyboardId: input.storyboardId,
          batchId,
          hookType: v.hookType,
          engine: v.engine,
          planFromRunId: v.leader ? null : leaders.get(v.hookType) ?? null,
          input: json(applyBudgetMode({ ...base, ...extra, offer: offer ?? null, notes: input.notes ?? "", soundProfile: v.soundProfile }, budget.out, budget.enabled, v.engine).input),
          createdById: input.createdById ?? null,
        },
      });
      if (v.leader) leaders.set(v.hookType, run.id);
      runs.push(run);
    }
    return { batchId, runs };
  });
}

const LIST_SELECT = {
  id: true, storyboardId: true, batchId: true, hookType: true, engine: true, planFromRunId: true, status: true, step: true, progress: true,
  plan: true, storyboardAB: true, estimate: true, review: true, metrics: true, autofix: true, log: true, estUsd: true, actualUsd: true,
  finalMp4Url: true, posterUrl: true, error: true, cancelRequested: true, approvedAt: true, heartbeatAt: true, createdAt: true, updatedAt: true,
} satisfies Prisma.AdStudioRunSelect;

export async function listRuns(projectId: string, storyboardId?: string | null) {
  return prisma.adStudioRun.findMany({
    where: { projectId, ...(storyboardId ? { storyboardId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 60,
    select: LIST_SELECT,
  });
}

/** user approval: reserves the estimate in the spend ledger (project budget + monthly allowance), atomically once */
export async function approveRun(projectId: string, runId: string) {
  const run = await prisma.adStudioRun.findUnique({ where: { id: runId } });
  if (!run || run.projectId !== projectId) throw new AdStudioError("Run not found", 404);
  if (run.status !== "awaiting_approval") throw new AdStudioError(`Run cannot be approved from status "${run.status}"`, 409);
  const ledger = await spendLedger();
  const model = String((run.estimate as { model?: string } | null)?.model ?? run.engine);
  // reserve first (throws BudgetExceeded with nothing changed), then flip the status and attach the reservation in ONE
  // conditional write, so the worker can never claim an approved run that has no reservation, and a cancel that wins
  // the race leaves no open reservation. The acting coworker (if any) comes from the request's spend scope.
  const r = await ledger.reserve({ projectId, runId, kind: "video", model: `adstudio:${model}` }, reserveUsd(run.estUsd));
  const { count } = await prisma.adStudioRun.updateMany({ where: { id: runId, status: "awaiting_approval" }, data: { status: "approved", approvedAt: new Date(), spendEntryId: r.id } });
  if (count !== 1) {
    await ledger.settle(r.id, 0);
    throw new AdStudioError("Run was approved or changed by someone else", 409);
  }
  return prisma.adStudioRun.findUniqueOrThrow({ where: { id: runId }, select: LIST_SELECT });
}

/** video (default): every shot is real footage · slides: key frames + camera moves, no video model · mixed: AI scenes plus photo/type-card shots */
export const VISUAL_MODES = ["video", "slides", "mixed"] as const;
export type VisualMode = (typeof VISUAL_MODES)[number];
export const visualModeOf = (input: unknown): VisualMode => { const m = (input as { visualMode?: string } | null)?.visualMode; return (VISUAL_MODES as readonly string[]).includes(m ?? "") ? (m as VisualMode) : "video"; };

/** a failed run may be retried this many times (the worker resumes at the failed step, so a plan already paid for is reused) */
export const MAX_RETRIES = 3;
/** retry a failed run: a run that reached the approval gate goes back to "awaiting_approval" (the user approves the video spend
 *  again, a fresh reservation); one that failed while planning goes back to "queued". Conditional on still being failed. */
export async function retryRun(projectId: string, runId: string) {
  const run = await prisma.adStudioRun.findUnique({ where: { id: runId } });
  if (!run || run.projectId !== projectId) throw new AdStudioError("Run not found", 404);
  if (run.status !== "failed") throw new AdStudioError(`Only a failed run can be retried (this one is ${run.status})`, 409);
  const input = (run.input ?? {}) as Record<string, unknown>; const retries = Number(input.retries ?? 0);
  if (retries >= MAX_RETRIES) throw new AdStudioError(`Already retried ${retries} times - start a new batch instead`, 409);
  const gated = !!run.estimate && run.estUsd > 0;
  const { count } = await prisma.adStudioRun.updateMany({
    where: { id: runId, status: "failed" },
    data: { status: gated ? "awaiting_approval" : "queued", error: null, cancelRequested: false, workerId: null, spendEntryId: null, approvedAt: null, input: json({ ...input, retries: retries + 1 }) },
  });
  if (count !== 1) throw new AdStudioError("Run changed while retrying, try again", 409);
  return prisma.adStudioRun.findUniqueOrThrow({ where: { id: runId }, select: LIST_SELECT });
}

/** the pipeline may re-generate failed scenes up to estimate x 1.3 (ad-studio run.mjs frame QA cap); the reservation covers that cap */
export const RESERVE_FACTOR = 1.3;
export const reserveUsd = (estUsd: number) => Math.round(estUsd * RESERVE_FACTOR * 10000) / 10000;

/** queued / waiting runs stop at once; a run the worker is executing stops at its next heartbeat. Files are kept. */
export async function cancelRun(projectId: string, runId: string) {
  const run = await prisma.adStudioRun.findUnique({ where: { id: runId } });
  if (!run || run.projectId !== projectId) throw new AdStudioError("Run not found", 404);
  if (!ACTIVE_STATES.includes(run.status)) throw new AdStudioError(`Run is already ${run.status}`, 409);
  if (WORKER_STATES.includes(run.status)) {
    return prisma.adStudioRun.update({ where: { id: runId }, data: { cancelRequested: true }, select: LIST_SELECT });
  }
  // conditional: an approve or a claim that landed after the read wins, and the user retries
  const { count } = await prisma.adStudioRun.updateMany({ where: { id: runId, status: run.status, spendEntryId: run.spendEntryId }, data: { status: "cancelled" } });
  if (count !== 1) throw new AdStudioError("Run changed while cancelling, try again", 409);
  if (run.spendEntryId) await (await spendLedger()).settle(run.spendEntryId, 0);
  return prisma.adStudioRun.findUniqueOrThrow({ where: { id: runId }, select: LIST_SELECT });
}

// ─── worker side ────────────────────────────────────────────────────────────

/** runs whose worker went quiet go back to the state they were claimed from */
export async function requeueStale(now = Date.now()) {
  const cutoff = new Date(now - STALE_MS);
  const dead = await prisma.adStudioRun.findMany({ where: { status: { in: ["planning", "generating"] }, heartbeatAt: { lt: cutoff }, cancelRequested: true }, select: { id: true, spendEntryId: true } });
  for (const d of dead) {
    const { count } = await prisma.adStudioRun.updateMany({ where: { id: d.id, status: { in: ["planning", "generating"] } }, data: { status: "cancelled", workerId: null, error: "cancelled (worker stopped)" } });
    if (count === 1 && d.spendEntryId) await (await spendLedger()).settle(d.spendEntryId, 0);
  }
  const a = await prisma.adStudioRun.updateMany({ where: { status: "planning", heartbeatAt: { lt: cutoff } }, data: { status: "queued", workerId: null } });
  const b = await prisma.adStudioRun.updateMany({ where: { status: "generating", heartbeatAt: { lt: cutoff } }, data: { status: "approved", workerId: null } });
  return a.count + b.count;
}

export type ClaimPhase = "plan" | "copy_plan" | "generate";

/** next job for the worker: generation first (the user is waiting on approved work), then plans */
export async function claimNext(workerId: string) {
  await requeueStale();
  const approved = await prisma.adStudioRun.findMany({ where: { status: "approved", cancelRequested: false }, orderBy: { approvedAt: "asc" }, take: 5, select: { id: true } });
  for (const c of approved) {
    const { count } = await prisma.adStudioRun.updateMany({ where: { id: c.id, status: "approved" }, data: { status: "generating", workerId: lease(workerId), heartbeatAt: new Date() } });
    if (count === 1) return claimed(c.id, "generate");
  }
  const queued = await prisma.adStudioRun.findMany({
    where: { status: "queued", cancelRequested: false },
    orderBy: { createdAt: "asc" },
    take: 20,
    select: { id: true, planFromRunId: true },
  });
  for (const c of queued) {
    if (c.planFromRunId) {
      const leader = await prisma.adStudioRun.findUnique({ where: { id: c.planFromRunId }, select: { status: true } });
      if (!leader || !PLAN_READY.includes(leader.status)) {
        // the leader failed or was cancelled: this variant writes its own plan
        if (leader && ["failed", "cancelled"].includes(leader.status)) await prisma.adStudioRun.update({ where: { id: c.id }, data: { planFromRunId: null } });
        else continue;
      }
    }
    const { count } = await prisma.adStudioRun.updateMany({ where: { id: c.id, status: "queued" }, data: { status: "planning", workerId: lease(workerId), heartbeatAt: new Date(), step: "ingest" } });
    if (count === 1) {
      const r = await prisma.adStudioRun.findUnique({ where: { id: c.id }, select: { planFromRunId: true } });
      return claimed(c.id, r?.planFromRunId ? "copy_plan" : "plan");
    }
  }
  return null;
}

/** one claim = one lease id ("<worker>#<random>"). A run requeued after a missed heartbeat and claimed again gets a new
 *  lease, so reports from the first attempt are refused and that attempt is told to stop. */
const lease = (workerId: string) => `${workerId.slice(0, 80)}#${randomUUID().slice(0, 8)}`;

async function claimed(id: string, phase: ClaimPhase) {
  let r = await prisma.adStudioRun.findUniqueOrThrow({ where: { id } });
  if (phase !== "generate") {
    // a run queued before the budget ran out is planned as $0 slides too (the record shows it: input.fallback = "budget")
    const budget = await budgetContext();
    const b = applyBudgetMode((r.input ?? {}) as Record<string, unknown>, budget.out, budget.enabled, r.engine);
    if (b.changed) r = await prisma.adStudioRun.update({ where: { id }, data: { input: json(b.input) } });
  }
  return { runId: r.id, phase, hookType: r.hookType, engine: r.engine, planFromRunId: r.planFromRunId, input: r.input, claim: r.workerId, estUsd: r.estUsd, reserveUsd: reserveUsd(r.estUsd) };
}

/** the run, if this report belongs to its current claim (claim omitted = an older worker; accepted) */
async function owned(runId: string, claim?: string) {
  const r = await prisma.adStudioRun.findUnique({ where: { id: runId } });
  if (!r) throw new AdStudioError("Run not found", 404);
  if (claim && r.workerId !== claim) throw new AdStudioError("This claim is no longer the run's current one", 409);
  return r;
}

export interface ProgressPatch {
  step?: string;
  progress?: number;
  log?: string[];
  plan?: unknown;
  storyboardAB?: unknown;
}

/** heartbeat + progress; the answer tells the worker to stop when the user cancelled */
export async function reportProgress(runId: string, p: ProgressPatch & { claim?: string }) {
  const r = await owned(runId);
  if (p.claim && r.workerId !== p.claim) return { cancel: true, status: "reclaimed" };
  if (!WORKER_STATES.includes(r.status)) return { cancel: true, status: r.status };
  await prisma.adStudioRun.update({
    where: { id: runId },
    data: {
      heartbeatAt: new Date(),
      ...(p.step ? { step: p.step } : {}),
      ...(typeof p.progress === "number" ? { progress: Math.max(0, Math.min(100, Math.round(p.progress))) } : {}),
      ...(p.log ? { log: json(p.log.slice(-60)) } : {}),
      ...(p.plan !== undefined ? { plan: json(p.plan) } : {}),
      ...(p.storyboardAB !== undefined ? { storyboardAB: json(p.storyboardAB) } : {}),
    },
  });
  return { cancel: r.cancelRequested };
}

/** the plan is ready: wait for the user. preUsd = what the plan already cost (key frames), booked as spent. */
export async function reportGate(runId: string, g: { estimate: { usd: number } & Record<string, unknown>; plan?: unknown; storyboardAB?: unknown; preUsd?: number; log?: string[]; claim?: string }) {
  const r = await owned(runId, g.claim);
  if (r.status !== "planning") throw new AdStudioError(`gate from status "${r.status}"`, 409);
  if (r.cancelRequested) {
    await prisma.adStudioRun.update({ where: { id: runId }, data: { status: "cancelled" } });
    return { cancel: true };
  }
  if (g.preUsd && g.preUsd > 0) {
    await prisma.spendEntry.create({ data: { projectId: r.projectId, runId, kind: "image", model: "adstudio:keyframes", estUsd: g.preUsd, actualUsd: g.preUsd } });
  }
  await prisma.adStudioRun.update({
    where: { id: runId },
    data: {
      status: "awaiting_approval", step: "generate", progress: 50, heartbeatAt: new Date(), estimate: json(g.estimate), estUsd: Number(g.estimate.usd) || 0,
      actualUsd: g.preUsd ?? 0,
      ...(g.plan !== undefined ? { plan: json(g.plan) } : {}),
      ...(g.storyboardAB !== undefined ? { storyboardAB: json(g.storyboardAB) } : {}),
      ...(g.log ? { log: json(g.log.slice(-60)) } : {}),
    },
  });
  return { cancel: false };
}

export async function reportDone(runId: string, d: { finalMp4Url: string; posterUrl?: string; review?: unknown; metrics?: unknown; autofix?: unknown; plan?: unknown; actualUsd?: number; log?: string[]; claim?: string }) {
  const r = await owned(runId, d.claim);
  // a free run (stock remix, or slides mode: key frames + camera moves, no video model) renders during planning and never waits
  // for approval; a paid video engine must pass the gate
  const freeRun = r.engine === FREE_ENGINE || visualModeOf(r.input) === "slides";
  if (r.status !== "generating" && !(r.status === "planning" && freeRun)) throw new AdStudioError(`done from status "${r.status}"`, 409);
  const actual = d.actualUsd ?? r.estUsd;
  if (r.spendEntryId) await (await spendLedger()).settle(r.spendEntryId, Math.max(0, actual - (r.actualUsd ?? 0)));
  // a slides run paid only for its key frames during planning: book them (no gate ran to do it)
  else if (r.status === "planning" && actual > 0) await prisma.spendEntry.create({ data: { projectId: r.projectId, runId, kind: "image", model: "adstudio:keyframes", estUsd: actual, actualUsd: actual } });
  if (d.review) await saveReviewInsight(r.projectId, r, d.review); // P4: review → Insights
  return prisma.adStudioRun.update({
    where: { id: runId },
    data: {
      status: "completed", step: "review", progress: 100, heartbeatAt: new Date(), finalMp4Url: d.finalMp4Url, posterUrl: d.posterUrl ?? null,
      review: json(d.review ?? null), metrics: json(d.metrics ?? null), autofix: json(d.autofix ?? null), actualUsd: actual,
      ...(d.plan !== undefined ? { plan: json(d.plan) } : {}),
      ...(d.log ? { log: json(d.log.slice(-60)) } : {}),
    },
    select: { id: true, status: true },
  });
}

export async function reportFailed(runId: string, error: string, opts: { cancelled?: boolean; actualUsd?: number; log?: string[]; claim?: string } = {}) {
  const r = await owned(runId, opts.claim);
  if (!WORKER_STATES.includes(r.status)) return { status: r.status };
  if (r.spendEntryId && typeof opts.actualUsd === "number") await (await spendLedger()).settle(r.spendEntryId, Math.max(0, opts.actualUsd - (r.actualUsd ?? 0)));
  // a plan that failed after paid key frames: book what it spent (the gate would have), so the ledger is not short
  else if (r.status === "planning" && typeof opts.actualUsd === "number" && opts.actualUsd > 0) {
    await prisma.spendEntry.create({ data: { projectId: r.projectId, runId, kind: "image", model: "adstudio:keyframes", estUsd: opts.actualUsd, actualUsd: opts.actualUsd } });
  }
  return prisma.adStudioRun.update({
    where: { id: runId },
    data: { status: opts.cancelled ? "cancelled" : "failed", error: error.slice(0, 2000), heartbeatAt: new Date(), ...(typeof opts.actualUsd === "number" ? { actualUsd: opts.actualUsd } : {}), ...(opts.log ? { log: json(opts.log.slice(-60)) } : {}) },
    select: { id: true, status: true },
  });
}
