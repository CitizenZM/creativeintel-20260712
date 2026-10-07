import { describe, expect, it } from "vitest";
import { abTest, betaPosterior, mulberry32, normalQuantile, probabilityBest, sampleBeta, sampleSizeForLift, sampleSizeTwoProportions, twoProportionZ } from "./stats";

describe("beta-binomial posterior", () => {
  it("matches the closed form under a uniform prior", () => {
    // 30 successes / 100 trials → Beta(31, 71): mean 31/102, var ab/((a+b)²(a+b+1)).
    const p = betaPosterior(30, 100);
    expect(p.alpha).toBe(31);
    expect(p.beta).toBe(71);
    expect(p.mean).toBeCloseTo(31 / 102, 10);
    expect(p.sd).toBeCloseTo(Math.sqrt((31 * 71) / (102 ** 2 * 103)), 10);
    expect(p.ci95[0]).toBeLessThan(p.mean);
    expect(p.ci95[1]).toBeGreaterThan(p.mean);
  });
  it("respects a custom prior and clamps successes to trials", () => {
    const p = betaPosterior(5, 10, { alpha: 2, beta: 8 });
    expect([p.alpha, p.beta]).toEqual([7, 13]);
    expect(betaPosterior(12, 10).beta).toBe(1);
  });
  it("seeded beta samples are deterministic and centred on the mean", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const xs = Array.from({ length: 4000 }, () => sampleBeta(31, 71, a));
    expect(xs.slice(0, 5)).toEqual(Array.from({ length: 5 }, () => sampleBeta(31, 71, b)));
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(mean).toBeCloseTo(31 / 102, 2);
    // Shape < 1 path.
    const small = Array.from({ length: 4000 }, () => sampleBeta(0.5, 0.5, a));
    expect(small.reduce((s, x) => s + x, 0) / small.length).toBeCloseTo(0.5, 1);
  });
});

describe("P(best) and expected loss", () => {
  it("is deterministic for a seed and sums to 1", () => {
    const arms = [betaPosterior(300, 1000), betaPosterior(320, 1000), betaPosterior(250, 1000)];
    const r1 = probabilityBest(arms, { seed: 7, draws: 5000 });
    const r2 = probabilityBest(arms, { seed: 7, draws: 5000 });
    expect(r1).toEqual(r2);
    expect(r1.pBest.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 10);
    expect(r1.pBest[1]).toBeGreaterThan(r1.pBest[0]);
    expect(r1.pBest[2]).toBeLessThan(0.01);
    expect(r1.expectedLoss[1]).toBeLessThan(r1.expectedLoss[0]);
  });
  it("two identical arms split ~50/50", () => {
    const r = probabilityBest([betaPosterior(100, 1000), betaPosterior(100, 1000)], { seed: 3, draws: 20000 });
    expect(r.pBest[0]).toBeCloseTo(0.5, 1);
  });
  it("P(best) rises monotonically with an arm's successes", () => {
    let prev = -1;
    for (const x of [80, 90, 100, 110, 120, 140]) {
      const p = probabilityBest([betaPosterior(x, 1000), betaPosterior(100, 1000)], { seed: 11, draws: 8000 }).pBest[0];
      expect(p).toBeGreaterThan(prev);
      prev = p;
    }
  });
});

describe("A/B call", () => {
  it("calls a clear winner on P(best) ≥ 0.95", () => {
    const r = abTest(
      [
        { level: "H06", successes: 3400, trials: 10000 },
        { level: "H01", successes: 2500, trials: 10000 },
      ],
      { seed: 1 }
    );
    expect(r.status).toBe("winner");
    expect(r.winner).toMatchObject({ level: "H06", rule: "p_best" });
    expect(r.winner!.pBest).toBeGreaterThanOrEqual(0.95);
    expect(r.z).toBeGreaterThan(1.96);
  });
  it("min-sample guard: arms under the floor are excluded and nothing is called", () => {
    const r = abTest(
      [
        { level: "H06", successes: 40, trials: 100 },
        { level: "H01", successes: 10, trials: 100 },
      ],
      { seed: 1, minTrials: 1000 }
    );
    expect(r.status).toBe("insufficient_data");
    expect(r.winner).toBeNull();
    expect(r.arms.every((a) => !a.eligible && a.pBest === null)).toBe(true);
  });
  it("one eligible arm next to an under-sampled one is not a winner", () => {
    const r = abTest(
      [
        { level: "a", successes: 300, trials: 2000 },
        { level: "b", successes: 5, trials: 50 },
      ],
      { seed: 1, minTrials: 1000 }
    );
    expect(r.status).toBe("insufficient_data");
    expect(r.arms.find((a) => a.level === "a")!.eligible).toBe(true);
  });
  it("no winner when the gap is noise; expected-loss rule calls a negligible difference on big data", () => {
    const noisy = abTest(
      [
        { level: "a", successes: 105, trials: 1000 },
        { level: "b", successes: 100, trials: 1000 },
      ],
      { seed: 1 }
    );
    expect(noisy.status).toBe("no_winner");
    const big = abTest(
      [
        { level: "a", successes: 2_502_000, trials: 10_000_000 },
        { level: "b", successes: 2_500_000, trials: 10_000_000 },
      ],
      { seed: 1, lossRel: 0.01 }
    );
    expect(big.status).toBe("winner");
    expect(big.winner).toMatchObject({ level: "a", rule: "expected_loss" });
    expect(big.winner!.pBest).toBeLessThan(0.95);
  });
  it("keeps the two-proportion z-test", () => {
    expect(twoProportionZ(3400, 10000, 2500, 10000)).toBeCloseTo(13.9, 0);
    expect(twoProportionZ(1, 0, 1, 10)).toBe(0);
  });
});

describe("power calculation", () => {
  it("inverse normal matches tables", () => {
    expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 5);
    expect(normalQuantile(0.8)).toBeCloseTo(0.841621, 5);
    expect(normalQuantile(0.5)).toBeCloseTo(0, 8);
    expect(normalQuantile(0.001)).toBeCloseTo(-3.090232, 4);
  });
  it("textbook: 5 % vs 10 %, α 0.05 two-sided, 80 % power → 435 per group (474 with continuity correction)", () => {
    // Fleiss, Levin & Paik, Statistical Methods for Rates and Proportions (3rd ed.), §4.2.
    expect(sampleSizeTwoProportions(0.05, 0.1)).toBe(435);
    expect(sampleSizeTwoProportions(0.05, 0.1, { continuity: true })).toBe(474);
  });
  it("relative-lift helper and edge cases", () => {
    expect(sampleSizeForLift(0.05, 1)).toBe(435);
    expect(sampleSizeForLift(0.01, 0.2)).toBeGreaterThan(sampleSizeForLift(0.25, 0.2));
    expect(sampleSizeTwoProportions(0.1, 0.1)).toBe(Infinity);
  });
});
