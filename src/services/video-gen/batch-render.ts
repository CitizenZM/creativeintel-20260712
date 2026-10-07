/**
 * Batch Mode on a finished server master: plan a variant matrix (creative/batch-matrix.ts) and render
 * its free re-edit variants through the same path as hook variants and delivery exports
 * (glm-assemble renderFromRun: same clips, new edit). Variants that need a new hook clip stay
 * `needs_generation` — nothing is generated here. Batches live on LibtvRun.qcReport.batches
 * (newest last, the last 10 kept), next to qcReport.variants and qcReport.exports.
 */
import { prisma } from "@/lib/db";
import {
  buildBatchMatrix,
  claimableVariants,
  estimateBatchCost,
  renderParamsFor,
  type BatchDims,
  type BatchMatrix,
  type BatchSource,
  type BatchVariant,
} from "@/services/creative/batch-matrix";
import type { CampaignPlan } from "@/services/creative/campaign-plan.types";
import { renderFromRun } from "./glm-assemble";
import { isServerEngine } from "./libtv-pricing";
import { storyboardFrames } from "./server-executor";

const MAX_BATCHES = 10;

type Qc = Record<string, unknown> & { batches?: BatchMatrix[]; durationSec?: number; hookStyle?: string };

const qcOf = (v: unknown): Qc => (v && typeof v === "object" ? (v as Qc) : {});

async function patchBatch(runId: string, batchId: string, fn: (b: BatchMatrix) => BatchMatrix): Promise<BatchMatrix | null> {
  const run = await prisma.libtvRun.findUnique({ where: { id: runId }, select: { qcReport: true } });
  const qc = qcOf(run?.qcReport);
  let out: BatchMatrix | null = null;
  const batches = (qc.batches ?? []).map((b) => (b.id === batchId ? (out = fn(b)) : b));
  if (!out) return null;
  await prisma.libtvRun.update({ where: { id: runId }, data: { qcReport: { ...qc, batches } as never } });
  return out;
}

const patchVariant = (runId: string, batchId: string, variantId: string, patch: Partial<BatchVariant>) =>
  patchBatch(runId, batchId, (b) => ({ ...b, variants: b.variants.map((v) => (v.id === variantId ? { ...v, ...patch } : v)) }));

async function loadRunContext(runId: string) {
  const run = await prisma.libtvRun.findUnique({ where: { id: runId } });
  if (!run) throw new Error("Run not found");
  if (!isServerEngine(run.executor) || run.status !== "completed") throw new Error(`Only completed server runs can be batched (status ${run.status})`);
  const [project, script, frames] = await Promise.all([
    prisma.project.findUnique({ where: { id: run.projectId }, select: { brandName: true, campaignPlan: true } }),
    run.scriptId ? prisma.script.findUnique({ where: { id: run.scriptId }, select: { title: true, totalDurationSec: true } }) : null,
    storyboardFrames(run.storyboardId, run.directorPlan),
  ]);
  const qc = qcOf(run.qcReport);
  const durationSec = qc.durationSec || script?.totalDurationSec || Math.max(0, ...frames.map((f) => f.endSec)) || 15;
  return { run, project, script, frames, qc, durationSec, masterHookStyle: typeof qc.hookStyle === "string" ? qc.hookStyle : "q" };
}

/** The run as a batch source; the campaign plan (when there is one) names the master's hook and the hook texts. */
export function runBatchSource(ctx: {
  brand?: string | null;
  title?: string | null;
  aspectRatio: string;
  durationSec: number;
  masterHookStyle: string;
  frames: { endCard?: { id: string; data?: { button?: string | null } } | null }[];
  plan?: CampaignPlan | null;
}): BatchSource {
  const title = (ctx.title ?? "").replace(/^⚠\s*/, "").trim().toLowerCase();
  const scripts = ctx.plan?.platforms.flatMap((p) => p.scripts) ?? [];
  const masterHookId = scripts.find((s) => title && s.title.trim().toLowerCase() === title)?.hookId ?? null;
  const hookTexts: Record<string, string> = {};
  for (const p of ctx.plan?.platforms ?? []) for (const h of p.hookVariants) hookTexts[h.hookId] ??= h.openingText;
  const end = [...ctx.frames].reverse().find((f) => f.endCard?.id)?.endCard;
  return {
    kind: "run",
    brand: ctx.brand,
    title: ctx.title,
    masterAspect: ctx.aspectRatio,
    masterDurationSec: ctx.durationSec,
    masterHookStyle: ctx.masterHookStyle,
    masterHookId,
    endCardId: end?.id ?? null,
    endCardButton: end?.data?.button ?? null,
    hookTexts,
  };
}

/** Plan a batch for a finished run and keep it on the run (with its cost estimate). */
export async function planBatchForRun(input: { runId: string; dims: BatchDims; design: "pairwise" | "full"; maxVariants: number; hookSec?: number }): Promise<BatchMatrix> {
  const ctx = await loadRunContext(input.runId);
  const source = runBatchSource({
    brand: ctx.project?.brandName,
    title: ctx.script?.title,
    aspectRatio: ctx.run.aspectRatio,
    durationSec: ctx.durationSec,
    masterHookStyle: ctx.masterHookStyle,
    frames: ctx.frames,
    plan: ctx.project?.campaignPlan as CampaignPlan | null,
  });
  const matrix = buildBatchMatrix({ source, dims: input.dims, design: input.design, maxVariants: input.maxVariants });
  matrix.cost = estimateBatchCost(matrix.variants, { imageModel: ctx.run.imageModel, videoModel: ctx.run.videoModel, hookSec: input.hookSec ?? 3 });
  const fresh = await prisma.libtvRun.findUnique({ where: { id: input.runId }, select: { qcReport: true } });
  const qc = qcOf(fresh?.qcReport);
  const batches = [...(qc.batches ?? []).filter((b) => b.id !== matrix.id), matrix].slice(-MAX_BATCHES);
  await prisma.libtvRun.update({ where: { id: input.runId }, data: { qcReport: { ...qc, batches } as never } });
  return matrix;
}

export async function getBatch(runId: string, batchId: string): Promise<BatchMatrix | null> {
  const run = await prisma.libtvRun.findUnique({ where: { id: runId }, select: { qcReport: true } });
  return qcOf(run?.qcReport).batches?.find((b) => b.id === batchId) ?? null;
}

/** Claim up to `limit` free variants (marks them pending) — render them with renderClaimedVariants. */
export async function claimBatchVariants(runId: string, batchId: string, limit: number): Promise<BatchVariant[]> {
  const at = new Date().toISOString();
  let claimed: BatchVariant[] = [];
  const b = await patchBatch(runId, batchId, (batch) => {
    claimed = claimableVariants(batch.variants, limit);
    const ids = new Set(claimed.map((v) => v.id));
    return { ...batch, variants: batch.variants.map((v) => (ids.has(v.id) ? { ...v, status: "pending" as const, pendingAt: at, error: null } : v)) };
  });
  if (!b) throw new Error("Batch not found");
  return claimed;
}

/** Render one claimed variant (~2–3 min re-edit) and store its result on the batch. */
export async function renderBatchVariant(runId: string, batchId: string, variant: BatchVariant): Promise<BatchVariant> {
  try {
    const ctx = await loadRunContext(runId);
    const jobs = await prisma.libtvJob.findMany({ where: { runId } });
    const p = renderParamsFor(variant, { masterAspect: ctx.run.aspectRatio, masterDurationSec: ctx.durationSec, masterHookStyle: ctx.masterHookStyle }, ctx.frames);
    const out = await renderFromRun({
      runId,
      projectId: ctx.run.projectId,
      aspectRatio: ctx.run.aspectRatio,
      frames: p.frames,
      jobs,
      hookStyle: p.hookStyle,
      hookText: p.hookText,
      outputAspect: p.outputAspect,
      cutdownSec: p.cutdownSec,
      voice: p.voice,
      musicMood: p.musicMood,
      ctaText: p.ctaText,
      tag: `batch-${batchId}-${variant.id}`,
    });
    const patch: Partial<BatchVariant> = { status: "rendered", masterUrl: out.masterUrl, previewUrl: out.previewUrl, renderedAt: new Date().toISOString(), pendingAt: null, error: null };
    await patchVariant(runId, batchId, variant.id, patch);
    return { ...variant, ...patch };
  } catch (err) {
    const patch: Partial<BatchVariant> = { status: "failed", pendingAt: null, error: (err instanceof Error ? err.message : String(err)).slice(0, 300) };
    await patchVariant(runId, batchId, variant.id, patch).catch(() => {});
    return { ...variant, ...patch };
  }
}

/** Render claimed variants one after another (each is a full re-edit). */
export async function renderClaimedVariants(runId: string, batchId: string, variants: BatchVariant[]): Promise<BatchVariant[]> {
  const out: BatchVariant[] = [];
  for (const v of variants) out.push(await renderBatchVariant(runId, batchId, v));
  return out;
}
