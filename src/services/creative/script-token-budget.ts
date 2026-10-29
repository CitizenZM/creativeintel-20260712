/** Keep short-form scripts from consuming the long-form output ceiling. */
export function scriptOutputTokenCap(durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 8000;
  return Math.max(4500, Math.min(8000, Math.ceil(2500 + durationSec * 250)));
}
