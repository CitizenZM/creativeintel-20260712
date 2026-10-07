/**
 * The spend guard at the executor call sites: one wrapper per kind of paid call, scoped to the run and
 * job, estimated from the live price table. See budget-guard.ts for the reserve → call → reconcile cycle.
 */
import { isBudgetExceeded, settleOpenJob, withSpendGuard, type SpendKind } from "./budget-guard";
import { jobModel, jobUnitUsd, llmCostUsd, qcCallUsd, type CostJob } from "./cost-model";
import { loadPriceTable } from "./prices";

export interface RunRef {
  id: string;
  projectId?: string | null;
  executor?: string | null;
  clipDurationSec?: number | null;
}
type JobRef = CostJob & { id: string };

/** The vision model QC calls are estimated at (the engine actually used is reconciled after the call). */
export function qcEstimateModel(): string | undefined {
  return process.env.AI_GEMINI_VISION_MODEL || process.env.AI_VISION_MODEL || undefined;
}

/** A keyframe (image gen / edit) or clip submit. Clips stay reserved until their poll reports the cost. */
export async function guardJobCall<T>(kind: "image" | "video", run: RunRef, job: JobRef, call: () => Promise<T>): Promise<T> {
  if (!run.projectId) return call();
  const prices = await loadPriceTable();
  const est = jobUnitUsd(prices, job, run.executor, run.clipDurationSec).usd ?? 0;
  return withSpendGuard({ projectId: run.projectId, runId: run.id, jobId: job.id, kind, model: jobModel(job) }, est, call, { prices, settle: kind === "video" ? "later" : "now" });
}

/** Poll of a submitted clip: reconcile its reservation with the reported cost once it finishes. */
export function settleClipOnPoll<T extends { status: string }>(run: RunRef, job: { id: string }, poll: () => Promise<T>): Promise<T> {
  return settleOpenJob(run.projectId, job.id, "video", poll, { done: (r) => r.status === "SUCCESS" });
}

/**
 * A keyframe vision-QC review. Over budget it is skipped (null = no verdict, the keyframe is kept):
 * a missing review must not fail a run, and it must not spend unapproved money either.
 */
export async function guardQc<T>(run: RunRef, job: { id: string }, refImages: number, review: () => Promise<T>): Promise<T | null> {
  if (!run.projectId) return review();
  const prices = await loadPriceTable();
  const model = qcEstimateModel() ?? prices.qc.defaultModel;
  try {
    return await withSpendGuard({ projectId: run.projectId, runId: run.id, jobId: job.id, kind: "vision_qc", model }, qcCallUsd(prices, model, refImages, "expected"), review, { prices });
  } catch (err) {
    if (!isBudgetExceeded(err)) throw err;
    console.warn(`[spend-guard] keyframe QC skipped: ${err.message}`);
    return null;
  }
}

/** A text / vision LLM call outside the keyframe loop (director review, shot director). */
export async function guardLlm<T>(
  scope: { projectId?: string | null; runId?: string | null; kind?: SpendKind },
  est: { model?: string; inTokens: number; outTokens: number },
  call: () => Promise<T>
): Promise<T> {
  if (!scope.projectId) return call();
  const prices = await loadPriceTable();
  const model = est.model ?? (scope.kind === "vision_qc" ? (qcEstimateModel() ?? prices.qc.defaultModel) : DEFAULT_TEXT_MODEL);
  const usd = llmCostUsd(prices, model, est.inTokens, est.outTokens).usd ?? 0;
  return withSpendGuard({ projectId: scope.projectId, runId: scope.runId ?? null, kind: scope.kind ?? "llm", model }, usd, call, { prices });
}

/** OpenRouter's standard text tier (claude-client.ts) — what a text call is estimated at. */
export const DEFAULT_TEXT_MODEL = "deepseek/deepseek-v4-pro";
