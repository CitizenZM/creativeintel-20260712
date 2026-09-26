/**
 * Scripts whose compliance violations survived the rewrite are saved with this
 * prefix on the title (creative/scripts and scripts-batch routes).
 */
export const COMPLIANCE_FLAG = "⚠ ";

export function isFlaggedScript(s: { title: string }): boolean {
  return s.title.startsWith(COMPLIANCE_FLAG.trim());
}

/** Best script to produce: compliant before flagged, then highest predicted score. */
export function pickBestScript<T extends { title: string; predictedScore?: number | null }>(scripts: T[]): T {
  if (!scripts.length) throw new Error("No scripts to pick from");
  return [...scripts].sort(
    (a, b) => Number(isFlaggedScript(a)) - Number(isFlaggedScript(b)) || (b.predictedScore ?? 0) - (a.predictedScore ?? 0)
  )[0];
}
