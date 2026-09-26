import { describe, expect, it } from "vitest";
import { costForTokens, monthStartUtc, summarizeUsage, type UsageGroup } from "./usage-core";

const g = (over: Partial<UsageGroup>): UsageGroup => ({
  provider: "glm",
  model: "glm-4.7-flash",
  capability: "text",
  calls: 1,
  pricedCalls: 1,
  inputTokens: 0,
  outputTokens: 0,
  images: 0,
  videoSeconds: 0,
  costUsd: 0,
  ...over,
});

describe("summarizeUsage", () => {
  it("rolls groups up per engine and totals the month", () => {
    const s = summarizeUsage([
      g({ capability: "text", calls: 10, pricedCalls: 10, inputTokens: 1000, outputTokens: 200 }),
      g({ capability: "vision", model: "glm-4.6v-flash", calls: 2, pricedCalls: 2, inputTokens: 500, outputTokens: 50 }),
      g({ capability: "video", model: "cogvideox-flash", calls: 3, pricedCalls: 3, videoSeconds: 15 }),
      g({ provider: "openai", model: "gpt-4o", calls: 4, pricedCalls: 0, inputTokens: 4000, outputTokens: 800, costUsd: null }),
      g({ provider: "custom:p1", model: "cogvideox-3", capability: "video", calls: 2, pricedCalls: 2, videoSeconds: 10, costUsd: 0.28 }),
    ]);

    const glm = s.engines.find((e) => e.provider === "glm")!;
    expect(glm.free).toBe(true);
    expect(glm.calls).toBe(15);
    expect(glm.inputTokens).toBe(1500);
    expect(glm.videoMinutes).toBeCloseTo(0.25);

    const openai = s.engines.find((e) => e.provider === "openai")!;
    expect(openai.free).toBe(false);
    // gpt-4o logs no cost, so it's estimated at list price: 4000 in + 800 out.
    expect(openai.unpricedCalls).toBe(0);
    expect(openai.costUsd).toBeCloseTo(0.018);
    expect(openai.estimatedUsd).toBeCloseTo(0.018);

    expect(s.totals.inputTokens).toBe(5500);
    expect(s.totals.outputTokens).toBe(1050);
    expect(s.totals.videoMinutes).toBeCloseTo(25 / 60);
    expect(s.totals.paidSpendUsd).toBeCloseTo(0.298);
    expect(s.totals.unpricedPaidCalls).toBe(0);
    expect(s.totals.freeCalls).toBe(15);
    // Most-used engine first.
    expect(s.engines[0].provider).toBe("glm");
  });

  it("handles an empty month", () => {
    const s = summarizeUsage([]);
    expect(s.engines).toEqual([]);
    expect(s.totals.paidSpendUsd).toBe(0);
  });
});

describe("costForTokens", () => {
  it("prices tokens per million, or null when no price is known", () => {
    expect(costForTokens({ inputPerMTokUsd: 2, outputPerMTokUsd: 8 }, 500_000, 250_000)).toBeCloseTo(3);
    expect(costForTokens(null, 100, 100)).toBeNull();
    expect(costForTokens({}, 100, 100)).toBeNull();
  });
});

describe("monthStartUtc", () => {
  it("is midnight UTC on the first of the month", () => {
    expect(monthStartUtc(new Date("2026-09-25T13:00:00Z")).toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });
});

describe("list-price estimates", () => {
  it("prices unpriced env-provider calls at list price", async () => {
    const { summarizeUsage, estimateListCost } = await import("./usage-core");
    expect(estimateListCost({ model: "gpt-4o", inputTokens: 1_000_000, outputTokens: 100_000, images: 0 })).toBeCloseTo(3.5);
    expect(estimateListCost({ model: "gpt-image-1", inputTokens: 0, outputTokens: 0, images: 10 })).toBeCloseTo(0.42);
    expect(estimateListCost({ model: "unknown-model", inputTokens: 5, outputTokens: 5, images: 0 })).toBeNull();
    const s = summarizeUsage([
      { provider: "openai", model: "gpt-4o", capability: "text", calls: 2, pricedCalls: 0, inputTokens: 1_000_000, outputTokens: 0, images: 0, videoSeconds: 0, costUsd: null },
      { provider: "openai", model: "mystery", capability: "text", calls: 1, pricedCalls: 0, inputTokens: 10, outputTokens: 10, images: 0, videoSeconds: 0, costUsd: null },
    ]);
    expect(s.totals.paidSpendUsd).toBeCloseTo(2.5);
    expect(s.totals.unpricedPaidCalls).toBe(1);
    expect(s.engines[0].estimatedUsd).toBeCloseTo(2.5);
  });
});
