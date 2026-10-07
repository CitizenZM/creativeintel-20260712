/**
 * Approval of a paid server run → the run's USD spend cap. The spend guard only reads
 * LibtvRun.approvedBudgetUsd, so a creditCap (US cents on the server engines: OpenRouter, Matrix,
 * paid Zhipu) is only enforced once it is written there. Both approve paths (Studio route, operator
 * approve-run) go through this. Pure.
 */
import { isServerEngine } from "@/services/video-gen/libtv-pricing";

/** The lower of the existing run budget and the new one: an approval never raises a lower cap. */
export function minBudgetUsd(existingUsd: number | null | undefined, usd: number): number {
  return existingUsd != null && existingUsd < usd ? existingUsd : usd;
}

export type ApprovalBudget = { ok: true; capBudgetUsd?: number } | { ok: false; error: string };

/**
 * A paid server run (non-zero estimate) needs a creditCap covering its estimate; the cap becomes its
 * USD budget (cents / 100). Free server runs and LibTV runs (prepaid LibTV credits) get no USD budget here.
 */
export function serverApprovalBudget(run: { executor: string | null; creditsEstimated: number }, creditCap: number | null | undefined): ApprovalBudget {
  if (!isServerEngine(run.executor) || !(run.creditsEstimated > 0)) return { ok: true };
  const cap = typeof creditCap === "number" && creditCap > 0 ? Math.round(creditCap) : null;
  if (cap === null) {
    return { ok: false, error: `This run is estimated at ${run.creditsEstimated} credits (US cents) — a paid approval needs a creditCap of at least that; it becomes the run's USD spend cap.` };
  }
  if (cap < run.creditsEstimated) return { ok: false, error: `Credit cap ${cap} is below the estimate of ${run.creditsEstimated} credits` };
  return { ok: true, capBudgetUsd: Math.round(cap) / 100 };
}
