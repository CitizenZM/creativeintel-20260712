import type { BrainPolicy } from "./contract";

export interface ApprovalCandidate { status: string; estUsd: number; updatedAt: Date | string; cancelRequested?: boolean }
export type ApprovalVerdict = { ok: true; reserveUsd: number } | { ok: false; reason: string };

/**
 * Brain autonomy for spend (design §9 decision 2 = A): a run waiting at the approval gate is approved by the brain when
 * its reservation (estimate x 1.3) is <= maxRunUsd, today's brain approvals + this one stay <= maxDayUsd, and the
 * estimate is fresh (updated within maxRunAgeH). Anything else stays for a person; the brain never waits on it silently.
 */
export function canAutoApprove(run: ApprovalCandidate, policy: BrainPolicy, approvedTodayUsd: number, reserve: (est: number) => number, now = Date.now()): ApprovalVerdict {
  if (!policy.autoApprove) return { ok: false, reason: "auto-approve is off" };
  if (run.status !== "awaiting_approval") return { ok: false, reason: `status ${run.status}` };
  if (run.cancelRequested) return { ok: false, reason: "cancel requested" };
  if (!(run.estUsd > 0)) return { ok: false, reason: "no estimate" };
  const r = reserve(run.estUsd);
  if (r > policy.maxRunUsd) return { ok: false, reason: `reservation $${r.toFixed(2)} > run cap $${policy.maxRunUsd}` };
  if (approvedTodayUsd + r > policy.maxDayUsd) return { ok: false, reason: `day cap: $${approvedTodayUsd.toFixed(2)} + $${r.toFixed(2)} > $${policy.maxDayUsd}` };
  const ageH = (now - new Date(run.updatedAt).getTime()) / 3_600_000;
  if (ageH > policy.maxRunAgeH) return { ok: false, reason: `estimate ${ageH.toFixed(0)} h old > ${policy.maxRunAgeH} h` };
  return { ok: true, reserveUsd: r };
}
