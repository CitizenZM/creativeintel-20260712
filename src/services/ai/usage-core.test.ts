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
    expect(openai.unpricedCalls).toBe(4);
    expect(openai.costUsd).toBe(0);

    expect(s.totals.inputTokens).toBe(5500);
    expect(s.totals.outputTokens).toBe(1050);
    expect(s.totals.videoMinutes).toBeCloseTo(25 / 60);
    expect(s.totals.paidSpendUsd).toBeCloseTo(0.28);
    expect(s.totals.unpricedPaidCalls).toBe(4);
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
