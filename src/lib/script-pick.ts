import { scoreScriptAttention, type ScriptForScoring } from "./attention-blueprint";

/**
 * Scripts whose compliance violations survived the rewrite are saved with this
 * prefix on the title (creative/scripts and scripts-batch routes).
 */
export const COMPLIANCE_FLAG = "⚠ ";

export function isFlaggedScript(s: { title: string }): boolean {
  return s.title.startsWith(COMPLIANCE_FLAG.trim());
}

type Pickable = { title: string; predictedScore?: number | null } & Partial<{
  totalDurationSec: number | null;
  hook: ScriptForScoring["hook"];
  bodyBeats: ScriptForScoring["body"];
  cta: ScriptForScoring["cta"];
}>;

/**
 * Pick score: the model's own prediction blended 50/50 with the deterministic
 * attention score (attention-blueprint.ts) when the script is structured — a
 * script can't grade its own pacing.
 */
export function pickScore(s: Pickable): number {
  const predicted = s.predictedScore ?? 0;
  if (!s.hook?.text && !s.bodyBeats?.length) return predicted;
  const attention = scoreScriptAttention({ totalDurationSec: s.totalDurationSec, hook: s.hook, body: s.bodyBeats, cta: s.cta }).score;
  return (predicted + attention) / 2;
}

/** Best script to produce: compliant before flagged, then the highest pick score. */
export function pickBestScript<T extends Pickable>(scripts: T[]): T {
  if (!scripts.length) throw new Error("No scripts to pick from");
  return [...scripts].sort((a, b) => Number(isFlaggedScript(a)) - Number(isFlaggedScript(b)) || pickScore(b) - pickScore(a))[0];
}
