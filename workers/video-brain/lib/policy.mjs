// Mirror of src/services/brain/policy.ts (the server re-checks every approval; this decides what to ask for).
export const RESERVE_FACTOR = 1.3;
export const reserveUsd = (est) => Math.round(est * RESERVE_FACTOR * 10000) / 10000;

export function canAutoApprove(run, policy, approvedTodayUsd, now = Date.now()) {
  if (!policy.autoApprove) return { ok: false, reason: 'auto-approve is off' };
  if (run.status !== 'awaiting_approval') return { ok: false, reason: `status ${run.status}` };
  if (run.cancelRequested) return { ok: false, reason: 'cancel requested' };
  if (!(run.estUsd > 0)) return { ok: false, reason: 'no estimate' };
  const r = reserveUsd(run.estUsd);
  if (r > policy.maxRunUsd) return { ok: false, reason: `reservation $${r.toFixed(2)} > run cap $${policy.maxRunUsd}` };
  if (approvedTodayUsd + r > policy.maxDayUsd) return { ok: false, reason: `day cap: $${approvedTodayUsd.toFixed(2)} + $${r.toFixed(2)} > $${policy.maxDayUsd}` };
  const ageH = (now - new Date(run.updatedAt).getTime()) / 3_600_000;
  if (ageH > policy.maxRunAgeH) return { ok: false, reason: `estimate ${ageH.toFixed(0)} h old > ${policy.maxRunAgeH} h` };
  return { ok: true, reserveUsd: r };
}
