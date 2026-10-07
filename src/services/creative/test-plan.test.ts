import { describe, expect, it, vi } from "vitest";
import type { CampaignPlan, PlatformPlan } from "./campaign-plan.types";
import { buildTestPlan, DEFAULT_BASELINES, platformFamily, scaleSchedule, splitCents, writeTestPlanNarrative } from "./test-plan";
import { sampleSizeForLift } from "@/services/performance/stats";

const pp = (platform: PlatformPlan["platform"], hooks: string[], end: string, alts: string[]): PlatformPlan =>
  ({
    platform,
    hookVariants: hooks.map((hookId) => ({ hookId })),
    endCard: { id: end },
    endCardAlternates: alts.map((id) => ({ id })),
  }) as unknown as PlatformPlan;

const PLAN = {
  version: 1,
  createdAt: "2026-10-06T00:00:00Z",
  productTitle: "Acme Air Fryer",
  goal: "cold",
  bigIdea: "",
  keywords: [],
  notes: [],
  platforms: [pp("meta_feed", ["H01", "H16", "H20"], "E04", ["E02", "E06"]), pp("tiktok", ["H08", "H11", "H35"], "E12", ["E09"])],
} as unknown as CampaignPlan;

const now = new Date("2026-10-06T00:00:00Z");

describe("budget helpers", () => {
  it("splitCents sums exactly", () => {
    const parts = splitCents(1000, [0.35, 0.25, 0.4]);
    expect(parts).toEqual([350, 250, 400]);
    const odd = splitCents(1000.01, [1, 1, 1]);
    expect(Math.round(odd.reduce((s, x) => s + x, 0) * 100)).toBe(100001);
  });
  it("scale schedule compounds ~+25 %/day and sums to the phase budget", () => {
    const s = scaleSchedule(1000, 5, 0.25);
    expect(s).toHaveLength(5);
    expect(Math.round(s.reduce((a, b) => a + b, 0) * 100)).toBe(100000);
    expect(s[1] / s[0]).toBeCloseTo(1.25, 2);
  });
});

describe("buildTestPlan", () => {
  it("splits the budget across platforms and phases with exact sums", () => {
    const tp = buildTestPlan({ plan: PLAN, totalBudget: 5000, days: 14, now });
    expect(tp.platforms.map((p) => p.platform)).toEqual(["meta_feed", "tiktok"]);
    expect(tp.platforms.reduce((s, p) => s + p.budget, 0)).toBeCloseTo(5000, 6);
    for (const p of tp.platforms) {
      expect(p.phases.map((x) => x.name)).toEqual(["test", "iterate", "scale"]);
      expect(p.phases.reduce((s, x) => s + x.budget, 0)).toBeCloseTo(p.budget, 6);
      expect(p.phases.reduce((s, x) => s + x.days, 0)).toBe(14);
      const scale = p.phases[2];
      expect(scale.schedule!.reduce((s, x) => s + x, 0)).toBeCloseTo(scale.budget, 6);
    }
    expect(buildTestPlan({ plan: PLAN, totalBudget: 5000, days: 14, now })).toEqual(tp);
  });

  it("sizes variants with the power calculation on hook rate and CTR", () => {
    const tp = buildTestPlan({ plan: PLAN, totalBudget: 20000, days: 14, platforms: ["meta_feed"], now });
    const meta = tp.platforms[0];
    const b = DEFAULT_BASELINES.meta;
    expect(meta.power.hookRate.impressionsPerVariant).toBe(sampleSizeForLift(b.hookRate, 0.2));
    expect(meta.power.ctr.impressionsPerVariant).toBe(sampleSizeForLift(b.ctr, 0.2));
    expect(meta.power.ctr.costPerVariant).toBeCloseTo((meta.power.ctr.impressionsPerVariant / 1000) * b.cpm, 2);
    expect(meta.power.decisionMetric).toBe("ctr");
    expect(meta.round1.length).toBeGreaterThanOrEqual(2);
    expect(meta.round1.length).toBeLessThanOrEqual(6);
    expect(meta.round1.slice(0, 3).map((v) => v.hookId)).toEqual(["H01", "H16", "H20"]);
    expect(meta.round1[0].endCardId).toBe("E04");
    expect(meta.structure.test).toMatch(/ABO/);
    expect(meta.structure.scale).toMatch(/CBO|Advantage\+/);
  });

  it("small budgets fall back to hook rate and flag an underpowered round", () => {
    const small = buildTestPlan({ plan: PLAN, totalBudget: 300, days: 7, platforms: ["tiktok"], now }).platforms[0];
    expect(small.power.decisionMetric).toBe("hookRate");
    expect(small.round1).toHaveLength(Math.max(2, Math.min(small.power.hookRate.affordableVariants, 6)));
    expect(small.structure.test).toMatch(/[Mm]anual/);
    expect(small.structure.scale).toMatch(/Smart\+/);
    const tiny = buildTestPlan({ plan: PLAN, totalBudget: 10, days: 3, platforms: ["tiktok"], now }).platforms[0];
    expect(tiny.power.underpowered).toBe(true);
    expect(tiny.phases.map((p) => p.name)).toEqual(["test"]);
    expect(tiny.round1).toHaveLength(2);
  });

  it("kill and scale rules use the target CPA and baselines; account baselines override assumptions", () => {
    const tp = buildTestPlan({ plan: PLAN, totalBudget: 3000, days: 10, platforms: ["youtube_shorts"], targetCpa: 40, baseline: { youtube: { cpm: 9, ctr: 0.008 } }, now });
    const yt = tp.platforms[0];
    expect(platformFamily("youtube_shorts")).toBe("youtube");
    expect(yt.baseline).toMatchObject({ cpm: 9, ctr: 0.008, source: "input" });
    expect(yt.structure.test).toMatch(/Demand Gen/);
    expect(yt.killRules.join(" ")).toMatch(/CPA > \$80\.00 .*after \$80\.00 spend/);
    expect(yt.scaleRules.join(" ")).toMatch(/\+20–30%/);
    expect(yt.round1[0].hookId).toBe("H01"); // not in the plan → first plan platform's variants
    expect(tp.assumptions.join(" ")).toMatch(/not this account's data/);
  });

  it("awareness swaps CPA rules for reach rules", () => {
    const tp = buildTestPlan({ plan: PLAN, totalBudget: 2000, days: 7, goal: "awareness", platforms: ["meta_feed"], now });
    expect(tp.platforms[0].killRules.join(" ")).not.toMatch(/CPA/);
    expect(tp.platforms[0].killRules.join(" ")).toMatch(/CPM/);
  });
});

describe("narrative", () => {
  it("one mocked model call; falls back to the deterministic summary", async () => {
    const tp = buildTestPlan({ plan: PLAN, totalBudget: 5000, days: 14, now });
    const llm = vi.fn(async () => ({ narrative: "Test 6 hooks on Meta first." }));
    expect(await writeTestPlanNarrative(tp, llm)).toEqual({ narrative: "Test 6 hooks on Meta first.", source: "llm" });
    expect(llm).toHaveBeenCalledTimes(1);
    const fb = await writeTestPlanNarrative(tp, async () => {
      throw new Error("down");
    });
    expect(fb.source).toBe("scaffold");
    expect(fb.narrative).toMatch(/meta_feed/);
  });
});
