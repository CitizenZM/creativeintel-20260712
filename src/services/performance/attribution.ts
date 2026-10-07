/**
 * Creative-element attribution: aggregate imported ad results by every element level (hook id,
 * family, end card, platform, aspect, duration, voice, selling point, legacy hook style), derive
 * hook rate, hold rate, CTR, CPC, CPM, CVR, CPA and ROAS, and run the Bayesian A/B call on each
 * rate metric per dimension. Pure — rows in, learning out.
 */
import { ELEMENT_DIMS, levelOf, type AdElements, type ElementDim } from "./elements";
import { abTest, type AbResult } from "./stats";

export interface PerfInputRow {
  adName: string;
  platform: string;
  impressions: number;
  views3s: number;
  thruplays: number;
  clicks: number;
  spend: number;
  conversions: number;
  revenue?: number | null;
  dateFrom?: Date | null;
  dateTo?: Date | null;
}

export interface Totals {
  ads: number;
  impressions: number;
  views3s: number;
  thruplays: number;
  clicks: number;
  spend: number;
  conversions: number;
  revenue: number;
}

export interface Metrics {
  /** 3-second views ÷ impressions. */
  hookRate: number | null;
  /** ThruPlays (or 15 s / 6 s views) ÷ impressions; null when the export has none. */
  holdRate: number | null;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  /** Conversions ÷ clicks. */
  cvr: number | null;
  cpa: number | null;
  /** Revenue ÷ spend; null without a conversion-value column. */
  roas: number | null;
}

export type RateMetric = "hookRate" | "holdRate" | "ctr" | "cvr";

/** Successes / trials of each rate metric and its min-sample guard. */
export const RATE_METRICS: Record<RateMetric, { num: keyof Totals; den: keyof Totals; minTrials: number; minSuccesses: number }> = {
  hookRate: { num: "views3s", den: "impressions", minTrials: 1000, minSuccesses: 20 },
  holdRate: { num: "thruplays", den: "impressions", minTrials: 1000, minSuccesses: 20 },
  ctr: { num: "clicks", den: "impressions", minTrials: 2000, minSuccesses: 10 },
  cvr: { num: "conversions", den: "clicks", minTrials: 100, minSuccesses: 3 },
};

const div = (a: number, b: number) => (b > 0 ? a / b : null);

export function metricsOf(t: Totals): Metrics {
  return {
    hookRate: div(t.views3s, t.impressions),
    holdRate: t.thruplays > 0 ? div(t.thruplays, t.impressions) : null,
    ctr: div(t.clicks, t.impressions),
    cpc: div(t.spend, t.clicks),
    cpm: div(t.spend * 1000, t.impressions),
    cvr: div(t.conversions, t.clicks),
    cpa: div(t.spend, t.conversions),
    roas: t.revenue > 0 ? div(t.revenue, t.spend) : null,
  };
}

export interface DecayOptions {
  now: Date;
  /** Half-life of a row's weight in days (default 21). */
  halfLifeDays?: number;
}

/** 0.5^(age / half-life) by the row's end (or start) date; undated rows weigh 1. */
export function rowWeight(row: { dateTo?: Date | null; dateFrom?: Date | null }, decay?: DecayOptions): number {
  const d = row.dateTo ?? row.dateFrom;
  if (!decay || !d) return 1;
  const ageDays = Math.max(0, (decay.now.getTime() - d.getTime()) / 86_400_000);
  return Math.pow(0.5, ageDays / (decay.halfLifeDays ?? 21));
}

const zero = (): Totals => ({ ads: 0, impressions: 0, views3s: 0, thruplays: 0, clicks: 0, spend: 0, conversions: 0, revenue: 0 });

function addRow(t: Totals, r: PerfInputRow, w: number) {
  t.ads++;
  t.impressions += r.impressions * w;
  t.views3s += r.views3s * w;
  t.thruplays += r.thruplays * w;
  t.clicks += r.clicks * w;
  t.spend += r.spend * w;
  t.conversions += r.conversions * w;
  t.revenue += (r.revenue ?? 0) * w;
}

export type Resolver = (row: { adName: string; platform?: string | null }) => AdElements;

export function totalsOf(rows: PerfInputRow[], decay?: DecayOptions): Totals {
  const t = zero();
  for (const r of rows) addRow(t, r, rowWeight(r, decay));
  return t;
}

export function aggregateByElement(rows: PerfInputRow[], resolve: Resolver, opts: { decay?: DecayOptions; dims?: readonly ElementDim[] } = {}): Record<ElementDim, Map<string, Totals>> {
  const dims = opts.dims ?? ELEMENT_DIMS;
  const out = Object.fromEntries(ELEMENT_DIMS.map((d) => [d, new Map<string, Totals>()])) as Record<ElementDim, Map<string, Totals>>;
  for (const r of rows) {
    const e = resolve(r);
    const w = rowWeight(r, opts.decay);
    for (const dim of dims) {
      const level = levelOf(e, dim);
      if (!level) continue;
      const m = out[dim];
      const t = m.get(level) ?? zero();
      addRow(t, r, w);
      m.set(level, t);
    }
  }
  return out;
}

export interface LevelStats extends Totals, Metrics {
  level: string;
}

export interface DimLearning {
  dim: ElementDim;
  levels: LevelStats[];
  tests: Partial<Record<RateMetric, AbResult>>;
}

export interface ElementLearning {
  rows: number;
  totals: Totals & Metrics;
  dims: DimLearning[];
}

export interface LearnOptions {
  seed?: number;
  draws?: number;
  decay?: DecayOptions;
  dims?: readonly ElementDim[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Per dimension: level stats (most impressions first) + a Bayesian A/B call on each rate metric with ≥ 2 levels. */
export function learnElements(rows: PerfInputRow[], resolve: Resolver, opts: LearnOptions = {}): ElementLearning {
  const agg = aggregateByElement(rows, resolve, opts);
  const dims: DimLearning[] = [];
  for (const dim of opts.dims ?? ELEMENT_DIMS) {
    const m = agg[dim];
    if (!m.size) continue;
    const levels: LevelStats[] = [...m.entries()]
      .map(([level, t]) => ({ level, ...t, spend: r2(t.spend), revenue: r2(t.revenue), ...metricsOf(t) }))
      .sort((a, b) => b.impressions - a.impressions || (b.hookRate ?? 0) - (a.hookRate ?? 0) || a.level.localeCompare(b.level));
    const tests: DimLearning["tests"] = {};
    if (levels.length >= 2) {
      for (const metric of Object.keys(RATE_METRICS) as RateMetric[]) {
        const spec = RATE_METRICS[metric];
        if (!levels.some((l) => (l[spec.num] as number) > 0)) continue; // e.g. no ThruPlay column
        tests[metric] = abTest(
          levels.map((l) => ({ level: l.level, successes: l[spec.num] as number, trials: l[spec.den] as number })),
          { minTrials: spec.minTrials, minSuccesses: spec.minSuccesses, seed: (opts.seed ?? 1) + dims.length * 31 + metric.length, draws: opts.draws ?? 4000 }
        );
      }
    }
    dims.push({ dim, levels, tests });
  }
  const t = totalsOf(rows, opts.decay);
  return { rows: rows.length, totals: { ...t, ...metricsOf(t) }, dims };
}
