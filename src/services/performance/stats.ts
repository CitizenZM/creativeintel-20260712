/**
 * Performance Agent statistics: beta-binomial posteriors for rate metrics, P(best) and expected
 * loss by seeded Monte Carlo (deterministic in tests), a "call the winner" rule with a min-sample
 * guard, the classic two-proportion z-test (back-compat), and the two-proportion power calculation
 * the test-plan strategist sizes its rounds with. Pure — no I/O.
 */

export type Rng = () => number;

/** mulberry32 — small, fast, seedable PRNG in [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a string hash → 32-bit seed. */
export function seedFrom(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function sampleNormal(rng: Rng): number {
  const u1 = rng() || 1e-12;
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Gamma(shape, 1) — Marsaglia & Tsang (2000); shape < 1 via the u^(1/shape) boost. */
export function sampleGamma(shape: number, rng: Rng): number {
  if (shape < 1) return sampleGamma(shape + 1, rng) * Math.pow(rng() || 1e-12, 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = sampleNormal(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x ** 4) return d * v;
    if (Math.log(u || 1e-12) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

export function sampleBeta(alpha: number, beta: number, rng: Rng): number {
  const x = sampleGamma(alpha, rng);
  const y = sampleGamma(beta, rng);
  return x + y > 0 ? x / (x + y) : 0.5;
}

export interface BetaPosterior {
  alpha: number;
  beta: number;
  mean: number;
  sd: number;
  /** Normal-approximation 95 % credible interval, clipped to [0, 1]. */
  ci95: [number, number];
}

/** Beta(prior.alpha + x, prior.beta + n − x); default uniform Beta(1, 1). Fractional (decayed) counts are fine. */
export function betaPosterior(successes: number, trials: number, prior: { alpha: number; beta: number } = { alpha: 1, beta: 1 }): BetaPosterior {
  const n = Math.max(0, trials);
  const x = Math.min(Math.max(0, successes), n);
  const a = prior.alpha + x;
  const b = prior.beta + n - x;
  const mean = a / (a + b);
  const sd = Math.sqrt((a * b) / ((a + b) ** 2 * (a + b + 1)));
  return { alpha: a, beta: b, mean, sd, ci95: [Math.max(0, mean - 1.96 * sd), Math.min(1, mean + 1.96 * sd)] };
}

/**
 * P(arm is best) and expected loss E[max θ − θ_i] by Monte Carlo over the posteriors. Same seed →
 * same answer.
 */
export function probabilityBest(arms: Pick<BetaPosterior, "alpha" | "beta">[], opts: { seed?: number; draws?: number } = {}): { pBest: number[]; expectedLoss: number[] } {
  const k = arms.length;
  if (!k) return { pBest: [], expectedLoss: [] };
  const draws = Math.max(100, opts.draws ?? 10_000);
  const rng = mulberry32(opts.seed ?? 1);
  const wins = new Array<number>(k).fill(0);
  const loss = new Array<number>(k).fill(0);
  const theta = new Array<number>(k);
  for (let d = 0; d < draws; d++) {
    let best = 0;
    for (let i = 0; i < k; i++) {
      theta[i] = sampleBeta(arms[i].alpha, arms[i].beta, rng);
      if (theta[i] > theta[best]) best = i;
    }
    wins[best]++;
    for (let i = 0; i < k; i++) loss[i] += theta[best] - theta[i];
  }
  return { pBest: wins.map((w) => w / draws), expectedLoss: loss.map((l) => l / draws) };
}

/** Two-proportion z (pooled SE) — the legacy significance test, kept for back-compat. */
export function twoProportionZ(x1: number, n1: number, x2: number, n2: number): number {
  if (n1 <= 0 || n2 <= 0) return 0;
  const p = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  return se > 0 ? (x1 / n1 - x2 / n2) / se : 0;
}

export interface ArmInput {
  level: string;
  successes: number;
  trials: number;
}

export interface ArmResult extends ArmInput {
  posterior: BetaPosterior;
  /** null when the arm is under the min-sample guard. */
  pBest: number | null;
  expectedLoss: number | null;
  eligible: boolean;
}

export interface AbOptions {
  /** Min-sample guard: arms below it never enter the comparison. Default 1000 trials. */
  minTrials?: number;
  minSuccesses?: number;
  seed?: number;
  draws?: number;
  /** Call the winner at P(best) ≥ this (default 0.95)… */
  pBestThreshold?: number;
  /** …or when its expected loss < lossRel × its posterior mean (default 0.01 = 1 %). */
  lossRel?: number;
  prior?: { alpha: number; beta: number };
}

export interface AbResult {
  arms: ArmResult[];
  status: "winner" | "no_winner" | "insufficient_data";
  winner: { level: string; pBest: number; expectedLoss: number; liftVsRunnerUp: number | null; rule: "p_best" | "expected_loss" } | null;
  /** Frequentist z of the leader vs the runner-up (back-compat; informative only). */
  z: number | null;
  note: string;
}

export function abTest(input: ArmInput[], opts: AbOptions = {}): AbResult {
  const minTrials = opts.minTrials ?? 1000;
  const minSuccesses = opts.minSuccesses ?? 0;
  const arms: ArmResult[] = input.map((a) => ({
    ...a,
    posterior: betaPosterior(a.successes, a.trials, opts.prior),
    pBest: null,
    expectedLoss: null,
    eligible: a.trials >= minTrials && a.successes >= minSuccesses,
  }));
  const eligible = arms.filter((a) => a.eligible);
  // Min-sample guard: under-sampled arms are left out; a call needs two arms over the floor.
  if (eligible.length < 2) {
    const waiting = arms.length - eligible.length;
    return { arms, status: "insufficient_data", winner: null, z: null, note: `${waiting} of ${arms.length} arms under the min sample (${minTrials} trials${minSuccesses ? `, ${minSuccesses} successes` : ""})` };
  }
  fill(eligible, opts);
  const ranked = [...eligible].sort((a, b) => b.pBest! - a.pBest! || b.posterior.mean - a.posterior.mean);
  const [lead, runner] = ranked;
  const z = Math.round(twoProportionZ(lead.successes, lead.trials, runner.successes, runner.trials) * 100) / 100;
  const lift = runner.posterior.mean > 0 ? Math.round((lead.posterior.mean / runner.posterior.mean - 1) * 1000) / 1000 : null;
  const pTh = opts.pBestThreshold ?? 0.95;
  const lossRel = opts.lossRel ?? 0.01;
  const rule = lead.pBest! >= pTh ? "p_best" : lead.expectedLoss! < lossRel * lead.posterior.mean ? "expected_loss" : null;
  if (!rule) return { arms, status: "no_winner", winner: null, z, note: `leader ${lead.level} P(best) ${(lead.pBest! * 100).toFixed(1)}% — keep testing` };
  return {
    arms,
    status: "winner",
    winner: { level: lead.level, pBest: lead.pBest!, expectedLoss: lead.expectedLoss!, liftVsRunnerUp: lift, rule },
    z,
    note: rule === "p_best" ? `${lead.level} wins: P(best) ${(lead.pBest! * 100).toFixed(1)}%` : `${lead.level} is safe to pick: expected loss under ${lossRel * 100}% of its rate`,
  };
}

function fill(arms: ArmResult[], opts: AbOptions) {
  const r = probabilityBest(arms.map((a) => a.posterior), { seed: opts.seed, draws: opts.draws });
  arms.forEach((a, i) => {
    a.pBest = r.pBest[i];
    a.expectedLoss = r.expectedLoss[i];
  });
}

/* ───────────────────────── power ───────────────────────── */

/** Inverse standard-normal CDF (Acklam's rational approximation, |rel. error| < 1.2e-9). */
export function normalQuantile(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const tail = (q: number) => (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  if (p < 0.02425) return tail(Math.sqrt(-2 * Math.log(p)));
  if (p > 1 - 0.02425) return -tail(Math.sqrt(-2 * Math.log(1 - p)));
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/**
 * Per-arm sample size to detect p1 vs p2 with a two-sided test (Fleiss, Levin & Paik §4.2):
 * n = [z₁₋α/₂·√(2p̄q̄) + z₁₋β·√(p₁q₁ + p₂q₂)]² / (p₁ − p₂)², optionally with the continuity correction
 * n' = n/4·(1 + √(1 + 4/(n·|p₁ − p₂|)))².
 */
export function sampleSizeTwoProportions(p1: number, p2: number, opts: { alpha?: number; power?: number; continuity?: boolean } = {}): number {
  const delta = Math.abs(p1 - p2);
  if (!(delta > 0)) return Infinity;
  const za = normalQuantile(1 - (opts.alpha ?? 0.05) / 2);
  const zb = normalQuantile(opts.power ?? 0.8);
  const pbar = (p1 + p2) / 2;
  const n = (za * Math.sqrt(2 * pbar * (1 - pbar)) + zb * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) ** 2 / delta ** 2;
  const out = opts.continuity ? (n / 4) * (1 + Math.sqrt(1 + 4 / (n * delta))) ** 2 : n;
  return Math.ceil(out - 1e-9);
}

/** Per-arm sample size to detect a relative lift on a baseline rate (e.g. 0.2 = +20 %). */
export function sampleSizeForLift(baseline: number, relLift: number, opts: { alpha?: number; power?: number; continuity?: boolean } = {}): number {
  return sampleSizeTwoProportions(baseline, Math.min(0.999, baseline * (1 + relLift)), opts);
}
