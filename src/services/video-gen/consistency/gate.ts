/**
 * Keyframe consistency gate. Every start (K<n>) and end (K<n>E) keyframe edited
 * from references is scored; a failing frame is regenerated with its defects
 * turned into explicit corrections in the edit prompt, at most `maxRerolls`
 * times; after that the best-scoring attempt is kept. The tick-based executor
 * persists the state between attempts on the job's settings (`decideKeyframe`);
 * `generateConsistentKeyframe` runs the same loop in one call.
 */
import { correctionsFor } from "./corrections";
import type { ConsistencyScore } from "./score";
import { summarizeScore } from "./thresholds";

export const MAX_CONSISTENCY_REROLLS = Number(process.env.CONSISTENCY_REROLLS ?? 2);

export interface KeyframeCandidate {
  url: string;
  score: number;
  pass: boolean;
  defects: string[];
}

export type GateDecision =
  | { action: "accept"; url: string; chosen: KeyframeCandidate; bestOf: boolean; candidates: KeyframeCandidate[] }
  | { action: "reroll"; corrections: string[]; candidates: KeyframeCandidate[] };

/** Best by score; on a tie the later attempt (it carried more corrections). */
export function bestCandidate(cands: KeyframeCandidate[]): KeyframeCandidate {
  return cands.reduce((best, c) => (c.pass && !best.pass) || (c.pass === best.pass && c.score >= best.score) ? c : best);
}

/**
 * Pure decision for one scored attempt. `previous` = earlier attempts (from the
 * job settings); `attempts` = re-rolls already spent.
 */
export function decideKeyframe(
  url: string,
  result: ConsistencyScore,
  state: { attempts: number; previous?: KeyframeCandidate[] },
  opts: { maxRerolls?: number; productSpec?: string } = {}
): GateDecision {
  const max = opts.maxRerolls ?? MAX_CONSISTENCY_REROLLS;
  const current: KeyframeCandidate = { url, score: result.score, pass: result.pass, defects: result.defects.slice(0, 6) };
  const candidates = [...(state.previous ?? []), current];
  if (result.pass || !result.reviewed) return { action: "accept", url, chosen: current, bestOf: false, candidates };
  if (state.attempts < max) {
    const named = result.defects.length ? result.defects : result.reasons;
    return { action: "reroll", corrections: correctionsFor(named, { productSpec: opts.productSpec }), candidates };
  }
  const chosen = bestCandidate(candidates);
  return { action: "accept", url: chosen.url, chosen, bestOf: chosen.url !== url || candidates.length > 1, candidates };
}

/** What the job settings record for the report. */
export function consistencyRecord(result: ConsistencyScore, decision: Extract<GateDecision, { action: "accept" }>, attempts: number) {
  return {
    ...summarizeScore(result),
    // The kept frame may be an earlier attempt: its own score and verdict win.
    score: decision.chosen.score,
    pass: decision.chosen.pass,
    defects: decision.chosen.defects,
    attempts: attempts + 1,
    bestOf: decision.bestOf,
    chosenUrl: decision.url,
    tries: decision.candidates.map((c) => ({ score: c.score, pass: c.pass })),
  };
}

/**
 * One-call loop: generate → score → (corrections → regenerate)… → keep the
 * best. `generate` receives the corrections of the previous failed attempt.
 */
export async function generateConsistentKeyframe(opts: {
  generate: (corrections: string[], attempt: number) => Promise<string>;
  score: (url: string) => Promise<ConsistencyScore>;
  maxRerolls?: number;
  productSpec?: string;
}): Promise<{ url: string; result: ConsistencyScore; decision: Extract<GateDecision, { action: "accept" }>; attempts: number }> {
  let corrections: string[] = [];
  let previous: KeyframeCandidate[] = [];
  const results = new Map<string, ConsistencyScore>();
  for (let attempt = 0; ; attempt++) {
    const url = await opts.generate(corrections, attempt);
    const result = await opts.score(url);
    results.set(url, result);
    const d = decideKeyframe(url, result, { attempts: attempt, previous }, { maxRerolls: opts.maxRerolls, productSpec: opts.productSpec });
    if (d.action === "accept") return { url: d.url, result: results.get(d.url) ?? result, decision: d, attempts: attempt };
    corrections = d.corrections;
    previous = d.candidates;
  }
}
