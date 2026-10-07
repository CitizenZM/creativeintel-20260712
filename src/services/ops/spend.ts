/**
 * The spend guard at the executor call sites: one wrapper per kind of paid call, scoped to the run and
 * job, estimated from the live price table. See budget-guard.ts for the reserve → call → reconcile cycle.
 */
import { guardDisabled, isBudgetExceeded, settleOpenJob, spendLedger, withSpendGuard, type SpendKind } from "./budget-guard";
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

/**
 * Poll of a submitted clip: reconcile its reservation once the provider settles it — SUCCESS at the
 * reported cost (else the estimate), FAIL at the reported cost or $0 (a failed generation is unbilled).
 */
export function settleClipOnPoll<T extends { status: string }>(run: RunRef, job: { id: string }, poll: () => Promise<T>): Promise<T> {
  return settleOpenJob(run.projectId, job.id, "video", poll, { done: (r) => r.status === "SUCCESS" || r.status === "FAIL", unbilled: (r) => r.status === "FAIL" });
}

/**
 * Close every open reservation of a job that is re-queued or failed outside a poll (a submit that
 * timed out, an invocation that died before the task id was saved): $0 when the provider said FAIL
 * ("unbilled"), else at the estimate. A resubmit then reserves afresh, and the next poll settles that one.
 */
export async function releaseJobReservations(run: RunRef, jobId: string, mode: "unbilled" | "estimate", kind: SpendKind = "video"): Promise<number> {
  if (!run.projectId || guardDisabled()) return 0;
  const ledger = await spendLedger();
  let closed = 0;
  for (let i = 0; i < 20; i++) {
    const open = await ledger.openEntryForJob(jobId, kind).catch(() => null);
    if (!open) break;
    try {
      await ledger.settle(open.id, mode === "unbilled" ? 0 : open.estUsd);
    } catch {
      break;
    }
    closed++;
  }
  return closed;
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
