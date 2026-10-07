/**
 * Keyframe consistency gate. Every start (K<n>) and end (K<n>E) keyframe edited
 * from references is scored; a failing frame is regenerated with its defects
 * turned into explicit corrections in the edit prompt, at most `maxRerolls`
 * times; after that the best-scoring attempt is kept. The tick-based executor
 * persists the state between attempts on the job's settings (`decideKeyframe`);
 * `generateConsistentKeyframe` runs the same loop in one call. A kept best attempt
 * that still has a major product defect is repaired from the official packshot
 * (repair.ts) when CONSISTENCY_REPAIR is on (default).
 */
import { correctionsFor } from "./corrections";
import type { BBox } from "./pixel-metrics";
import type { ConsistencyScore } from "./score";
import { summarizeScore } from "./thresholds";

export const MAX_CONSISTENCY_REROLLS = Number(process.env.CONSISTENCY_REROLLS ?? 2);

export interface KeyframeCandidate {
  url: string;
  score: number;
  pass: boolean;
  defects: string[];
  /** For the repair: the product's box in this frame, its major defects, the best-matching product photo. */
  bbox?: BBox | null;
  major?: string[];
  refIndex?: number;
}

/** CONSISTENCY_REPAIR=off keeps a defective best attempt as generated. */
export function consistencyRepairEnabled(): boolean {
  return !/^(off|0|false|no)$/i.test(process.env.CONSISTENCY_REPAIR ?? "");
}

/** Major defects the packshot composite fixes (the product itself, not people or the scene). */
const PRODUCT_MAJOR = /colou?r|shape|warp|bezel|aspect|proportion|stick|too thin|too thick|thickness|logo|different product|wrong product|camera module|ports? moved|stand wrong|painting/i;
const NOT_PRODUCT = /face|hair|skin|cast|clothing|hand|finger|limb|age differs|scene|collage|garbled|missing/i;

/** Why a kept attempt should be repaired from the packshot, or null (passes, no box, no major product defect). */
export function repairReason(c: KeyframeCandidate): string | null {
  if (c.pass || !c.bbox) return null;
  const hits = (c.major ?? []).filter((d) => PRODUCT_MAJOR.test(d) && !NOT_PRODUCT.test(d));
  return hits.length ? hits.slice(0, 2).join("; ").slice(0, 200) : null;
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
  if (!result.pass && result.product?.bbox) {
    current.bbox = result.product.bbox;
    current.major = (result.majorIssues ?? []).slice(0, 4);
    if (result.product.pixel) current.refIndex = result.product.pixel.refIndex;
  }
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
export function consistencyRecord(
  result: ConsistencyScore,
  decision: Extract<GateDecision, { action: "accept" }>,
  attempts: number,
  repair?: { method: string; reason: string; score: number; pass: boolean; url?: string } | null
) {
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
    ...(repair ? { repair } : {}),
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
  /** Packshot repair of a defective best attempt (returns the repaired URL and its pixel re-score, or null). */
  repair?: (chosen: KeyframeCandidate, reason: string) => Promise<{ url: string; result: ConsistencyScore } | null>;
}): Promise<{
  url: string;
  result: ConsistencyScore;
  decision: Extract<GateDecision, { action: "accept" }>;
  attempts: number;
  repair?: { reason: string; url: string; result: ConsistencyScore };
}> {
  let corrections: string[] = [];
  let previous: KeyframeCandidate[] = [];
  const results = new Map<string, ConsistencyScore>();
  for (let attempt = 0; ; attempt++) {
    const url = await opts.generate(corrections, attempt);
    const result = await opts.score(url);
    results.set(url, result);
    const d = decideKeyframe(url, result, { attempts: attempt, previous }, { maxRerolls: opts.maxRerolls, productSpec: opts.productSpec });
    if (d.action === "accept") {
      const reason = opts.repair && consistencyRepairEnabled() ? repairReason(d.chosen) : null;
      const fixed = reason ? await opts.repair!(d.chosen, reason).catch(() => null) : null;
      if (fixed && reason) return { url: fixed.url, result: fixed.result, decision: d, attempts: attempt, repair: { reason, ...fixed } };
      return { url: d.url, result: results.get(d.url) ?? result, decision: d, attempts: attempt };
    }
    corrections = d.corrections;
    previous = d.candidates;
  }
}
