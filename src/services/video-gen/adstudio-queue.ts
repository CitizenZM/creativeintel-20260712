/**
 * AdStudioRun state machine. The user creates a batch from a Studio storyboard; the Mac adstudio-worker
 * (workers/adstudio-worker) claims runs over /api/worker/adstudio, re-analyses the storyboard, writes the plan
 * (hook, script, key frames, estimate) and stops at awaiting_approval; video is only generated after approve().
 *
 *   queued -> planning -> awaiting_approval -> approved -> generating -> completed
 *   any -> failed | cancelled          (no heartbeat for STALE_MS -> back to queued / approved)
 */
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { spendLedger } from "@/services/ops/budget-guard";
import { ACTIVE_STATES, PLAN_READY, WORKER_STATES, planVariants } from "./adstudio-catalog";

export const STALE_MS = 120_000;
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
}

/** Everything the worker needs, frozen at create time: the storyboard is read, never written. */
export async function buildInput(projectId: string, storyboardId: string) {
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
        select: { title: true, angle: true, hook: true, bodyBeats: true, cta: true, hookVariants: true, selectedHookIdx: true, ctaVariants: true, selectedCtaIdx: true },
      })
    : null;
  return {
    project,
    storyboard: { id: storyboard.id, title: storyboard.title, frameSeconds: storyboard.frameSeconds, totalDuration: storyboard.totalDuration, frames },
    script,
    brandKit: kit,
  };
}

export async function createBatch(input: CreateBatchInput) {
  const variants = planVariants(input.hookTypes, input.engines);
  const base = await buildInput(input.projectId, input.storyboardId);
  const batchId = randomUUID();
  const offer = input.offer ?? (base.brandKit?.offerText ? { text: base.brandKit.offerText } : undefined);
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
          input: json({ ...base, offer: offer ?? null, notes: input.notes ?? "", soundProfile: v.soundProfile }),
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
  const { count } = await prisma.adStudioRun.updateMany({ where: { id: runId, status: "awaiting_approval" }, data: { status: "approved", approvedAt: new Date() } });
  if (count !== 1) throw new AdStudioError("Run was approved or changed by someone else", 409);
  try {
    const ledger = await spendLedger();
    const model = String((run.estimate as { model?: string } | null)?.model ?? run.engine);
    // the acting coworker (if any) comes from the request's spend scope (route-guard withAccess)
    const r = await ledger.reserve({ projectId, runId, kind: "video", model: `adstudio:${model}` }, run.estUsd);
    return prisma.adStudioRun.update({ where: { id: runId }, data: { spendEntryId: r.id }, select: LIST_SELECT });
  } catch (err) {
    await prisma.adStudioRun.update({ where: { id: runId }, data: { status: "awaiting_approval", approvedAt: null } });
    throw err;
  }
}

/** queued / waiting runs stop at once; a run the worker is executing stops at its next heartbeat. Files are kept. */
export async function cancelRun(projectId: string, runId: string) {
  const run = await prisma.adStudioRun.findUnique({ where: { id: runId } });
  if (!run || run.projectId !== projectId) throw new AdStudioError("Run not found", 404);
  if (!ACTIVE_STATES.includes(run.status)) throw new AdStudioError(`Run is already ${run.status}`, 409);
  if (WORKER_STATES.includes(run.status)) {
    return prisma.adStudioRun.update({ where: { id: runId }, data: { cancelRequested: true }, select: LIST_SELECT });
  }
  if (run.spendEntryId) await (await spendLedger()).settle(run.spendEntryId, 0);
  return prisma.adStudioRun.update({ where: { id: runId }, data: { status: "cancelled" }, select: LIST_SELECT });
}

// ─── worker side ────────────────────────────────────────────────────────────

/** runs whose worker went quiet go back to the state they were claimed from */
export async function requeueStale(now = Date.now()) {
  const cutoff = new Date(now - STALE_MS);
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
    const { count } = await prisma.adStudioRun.updateMany({ where: { id: c.id, status: "approved" }, data: { status: "generating", workerId, heartbeatAt: new Date() } });
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
    const { count } = await prisma.adStudioRun.updateMany({ where: { id: c.id, status: "queued" }, data: { status: "planning", workerId, heartbeatAt: new Date(), step: "ingest" } });
    if (count === 1) {
      const r = await prisma.adStudioRun.findUnique({ where: { id: c.id }, select: { planFromRunId: true } });
      return claimed(c.id, r?.planFromRunId ? "copy_plan" : "plan");
    }
  }
  return null;
}

async function claimed(id: string, phase: ClaimPhase) {
  const r = await prisma.adStudioRun.findUniqueOrThrow({ where: { id } });
  return { runId: r.id, phase, hookType: r.hookType, engine: r.engine, planFromRunId: r.planFromRunId, input: r.input };
}

async function owned(runId: string) {
  const r = await prisma.adStudioRun.findUnique({ where: { id: runId } });
  if (!r) throw new AdStudioError("Run not found", 404);
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
export async function reportProgress(runId: string, p: ProgressPatch) {
  const r = await owned(runId);
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
export async function reportGate(runId: string, g: { estimate: { usd: number } & Record<string, unknown>; plan?: unknown; storyboardAB?: unknown; preUsd?: number; log?: string[] }) {
  const r = await owned(runId);
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

export async function reportDone(runId: string, d: { finalMp4Url: string; posterUrl?: string; review?: unknown; metrics?: unknown; autofix?: unknown; plan?: unknown; actualUsd?: number; log?: string[] }) {
  const r = await owned(runId);
  if (r.status !== "generating") throw new AdStudioError(`done from status "${r.status}"`, 409);
  const actual = d.actualUsd ?? r.estUsd;
  if (r.spendEntryId) await (await spendLedger()).settle(r.spendEntryId, Math.max(0, actual - (r.actualUsd ?? 0)));
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

export async function reportFailed(runId: string, error: string, opts: { cancelled?: boolean; actualUsd?: number; log?: string[] } = {}) {
  const r = await owned(runId);
  if (!WORKER_STATES.includes(r.status)) return { status: r.status };
  if (r.spendEntryId && typeof opts.actualUsd === "number") await (await spendLedger()).settle(r.spendEntryId, Math.max(0, opts.actualUsd - (r.actualUsd ?? 0)));
  return prisma.adStudioRun.update({
    where: { id: runId },
    data: { status: opts.cancelled ? "cancelled" : "failed", error: error.slice(0, 2000), heartbeatAt: new Date(), ...(opts.log ? { log: json(opts.log.slice(-60)) } : {}) },
    select: { id: true, status: true },
  });
}
