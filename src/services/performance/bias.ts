/**
 * Feedback into creative selection: turn posteriors into bounded score adjustments for hooks and
 * end cards (selectCreative's `bias` input). Thompson sampling — one draw per level from its
 * decayed Beta posterior — so proven winners usually lead while close calls still get explored.
 * Older data counts less (half-life decay), and thin data is shrunk toward zero. Pure.
 */
import { aggregateByElement, RATE_METRICS, type DecayOptions, type PerfInputRow, type RateMetric, type Resolver } from "./attribution";
import type { ElementDim } from "./elements";
import { betaPosterior, mulberry32, sampleBeta } from "./stats";

export interface BiasOptions {
  /** Thompson-sampling seed (default: random — exploration in production; fixed in tests). */
  seed?: number;
  now?: Date;
  halfLifeDays?: number;
  /** Max |adjustment| in selectCreative score points (the category primary hook is worth 4). Default 3. */
  maxWeight?: number;
  /** Score points per 100 % relative lift at full confidence. Default 10. */
  scale?: number;
}

export interface BiasDetail {
  id: string;
  dim: ElementDim;
  metric: RateMetric;
  sample: number;
  baseline: number;
  trials: number;
  confidence: number;
  contribution: number;
}

/** Which metrics move which element: hooks stop the scroll and earn the click; end cards earn the click and the sale. */
const PLAN: { dim: ElementDim; metrics: { metric: RateMetric; w: number }[] }[] = [
  { dim: "hookId", metrics: [{ metric: "hookRate", w: 0.5 }, { metric: "ctr", w: 0.5 }] },
  { dim: "endCardId", metrics: [{ metric: "ctr", w: 0.5 }, { metric: "cvr", w: 0.5 }] },
];

export function computeBias(rows: PerfInputRow[], resolve: Resolver, opts: BiasOptions = {}): { bias: Partial<Record<string, number>>; detail: BiasDetail[] } {
  const now = opts.now ?? new Date();
  const decay: DecayOptions = { now, halfLifeDays: opts.halfLifeDays ?? 21 };
  const maxW = opts.maxWeight ?? 3;
  const scale = opts.scale ?? 10;
  const rng = mulberry32(opts.seed ?? Math.floor(Math.random() * 2 ** 32));
  const agg = aggregateByElement(rows, resolve, { decay, dims: PLAN.map((p) => p.dim) });
  const raw = new Map<string, number>();
  const detail: BiasDetail[] = [];
  for (const { dim, metrics } of PLAN) {
    const levels = [...agg[dim].entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const { metric, w } of metrics) {
      const spec = RATE_METRICS[metric];
      const arms = levels
        .map(([id, t]) => ({ id, x: t[spec.num] as number, n: t[spec.den] as number }))
        .filter((a) => a.n >= spec.minTrials && a.x >= spec.minSuccesses);
      if (arms.length < 2) continue;
      const pooled = arms.reduce((s, a) => s + a.x, 0) / arms.reduce((s, a) => s + a.n, 0);
      if (!(pooled > 0)) continue;
      for (const a of arms) {
        const post = betaPosterior(a.x, a.n);
        const sample = sampleBeta(post.alpha, post.beta, rng);
        const confidence = a.n / (a.n + spec.minTrials);
        const contribution = w * (sample / pooled - 1) * confidence;
        raw.set(a.id, (raw.get(a.id) ?? 0) + contribution);
        detail.push({ id: a.id, dim, metric, sample, baseline: pooled, trials: Math.round(a.n), confidence, contribution });
      }
    }
  }
  const bias: Partial<Record<string, number>> = {};
  for (const [id, v] of raw) {
    const b = Math.round(Math.max(-maxW, Math.min(maxW, v * scale)) * 100) / 100;
    if (Math.abs(b) >= 0.05) bias[id] = b;
  }
  return { bias, detail };
}
