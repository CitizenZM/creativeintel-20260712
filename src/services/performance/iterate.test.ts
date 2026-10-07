import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ project: { findUnique: vi.fn(), update: vi.fn() } }));
vi.mock("@/lib/db", () => ({ prisma: db }));
const agent = vi.hoisted(() => ({ loadElementLearning: vi.fn() }));
vi.mock("./agent", () => agent);
const trends = vi.hoisted(() => ({ trendSlice: vi.fn() }));
vi.mock("@/services/research/hook-trends", async (orig) => ({ ...(await orig<object>()), trendSlice: trends.trendSlice }));

import type { CampaignPlan } from "@/services/creative/campaign-plan.types";
import { hookById } from "@/services/creative/library";
import { operatorActionSchema } from "@/services/operator";
import type { TrendSlice } from "@/services/research/hook-trends";
import { learnElements, type PerfInputRow } from "./attribution";
import { elementResolver } from "./elements";
import { estimateRoundCost, planNextRound, proposeNextRound } from "./iterate";

const NOW = new Date("2026-10-07T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const row = (adName: string, impressions: number, views3s: number, clicks: number, conversions: number, spend: number): PerfInputRow => ({
  adName,
  platform: "tiktok",
  impressions,
  views3s,
  thruplays: 0,
  clicks,
  spend,
  conversions,
  dateFrom: day(10),
  dateTo: day(1),
});

/** Round 1 on TikTok: H10 before/after wins (CTR 2.5 %), H16 deal and H02 macro lose, H31 is under-sampled. */
const ROWS: PerfInputRow[] = [
  row("Vivid_QLED65_20s_HookH10_E06_9x16_VAndrewMultilingual_MAuto_CSeeWhy", 60000, 18000, 1500, 60, 420),
  row("Vivid_QLED65_20s_HookH16_E04_9x16_VAndrewMultilingual_MAuto_CShopNow", 60000, 9000, 420, 8, 410),
  row("Vivid_QLED65_20s_HookH02_E06_9x16_VAndrewMultilingual_MAuto_CSeeWhy", 50000, 11000, 1000, 30, 350),
  row("Vivid_QLED65_20s_HookH31_E06_9x16_VAndrewMultilingual_MAuto_CSeeWhy", 900, 260, 25, 1, 7),
];
const learning = () => learnElements(ROWS, elementResolver(), { seed: 1 });

const plan = {
  version: 1,
  createdAt: day(14).toISOString(),
  productTitle: "Vivid QLED 65",
  goal: "cold",
  bigIdea: "Bright enough for a sunny room",
  keywords: [],
  notes: [],
  platforms: [
    {
      platform: "tiktok",
      label: "TikTok",
      durationSec: 20,
      aspect: "9:16",
      hookVariants: [
        { hookId: "H10", name: "Before/After", family: "demo", durationSec: 2, openingVisual: "", openingText: "BEFORE / AFTER", openingVO: "" },
        { hookId: "H16", name: "Deal", family: "claim", durationSec: 2, openingVisual: "", openingText: "40% OFF", openingVO: "" },
        { hookId: "H02", name: "Macro", family: "reveal", durationSec: 2, openingVisual: "", openingText: "LOOK CLOSER", openingVO: "" },
      ],
      endCard: { id: "E06", name: "Rating", button: "See why" },
      endCardAlternates: [],
      beats: [],
      scripts: [],
    },
  ],
} as unknown as CampaignPlan;

const risingSlice = {
  category: "electronics",
  platform: "tiktok",
  windowDays: 28,
  from: day(28).toISOString(),
  to: NOW.toISOString(),
  totalAds: 21,
  families: [],
  hooks: [
    { hookId: "H08", name: "POV", family: "native", ads: 4, owners: 3, share: 0.19, longevityScore: 0.13, avgRunDays: 7, launchesThisWeek: 3, launchesLastWeek: 0, wowGrowth: 3, momentum: 0.43, novelty: 0.62, status: "rising", examples: [] },
    { hookId: "H12", name: "Speed ramp", family: "demo", ads: 2, owners: 2, share: 0.1, longevityScore: 0.12, avgRunDays: 12, launchesThisWeek: 2, launchesLastWeek: 0, wowGrowth: 2, momentum: 0.2, novelty: 0.8, status: "rising", examples: [] },
    { hookId: "H16", name: "Deal", family: "claim", ads: 8, owners: 4, share: 0.38, longevityScore: 0.42, avgRunDays: 40, launchesThisWeek: 1, launchesLastWeek: 1, wowGrowth: 0, momentum: -0.07, novelty: 0, status: "saturated", examples: [] },
  ],
} as unknown as TrendSlice;

describe("proposeNextRound", () => {
  it("keeps the winner, kills losers (P(best) < 5 % with enough sample), re-tests the under-sampled", () => {
    const p = proposeNextRound({ projectId: "p1", learning: learning(), plan, trends: risingSlice, platform: "tiktok", now: NOW });
    expect(p.mode).toBe("iterate");
    expect(p.decisionMetric).toBe("ctr");
    expect(p.keep.map((k) => k.id)).toEqual(["H10"]);
    expect(p.kill.map((k) => k.id).sort()).toEqual(["H02", "H16"]);
    for (const k of p.kill) expect(k.pBest!).toBeLessThan(0.05);
    expect(p.retest.map((r) => r.id)).toEqual(["H31"]);
    expect(p.retest[0].reason).toMatch(/sample|impressions/i);
    expect(p.endCards.keep.map((e) => e.id)).toEqual(["E06"]);
    expect(p.endCards.kill.map((e) => e.id)).toEqual(["E04"]);
    // Killed hooks never appear in the next batch.
    expect(p.batch.dims.hooks).not.toContain("H16");
    expect(p.batch.variants.some((v) => v.hook === "H16" || v.hook === "H02" || v.endCard === "E04")).toBe(false);
  });

  it("explores 2–3 new hooks from the winning family plus rising trends", () => {
    const p = proposeNextRound({ projectId: "p1", learning: learning(), plan, trends: risingSlice, platform: "tiktok", now: NOW });
    expect(p.winningFamily).toBe("demo");
    expect(p.explore.length).toBeGreaterThanOrEqual(2);
    expect(p.explore.length).toBeLessThanOrEqual(3);
    const fromFamily = p.explore.filter((e) => hookById(e.hookId)!.family === "demo");
    expect(fromFamily.length).toBeGreaterThanOrEqual(2);
    // Rising + in the winning family ranks first; a rising hook from another family fills the last slot.
    expect(p.explore[0].hookId).toBe("H12");
    expect(p.explore.map((e) => e.hookId)).toContain("H08");
    for (const e of p.explore) {
      expect(["H10", "H16", "H02", "H31"]).not.toContain(e.hookId);
      expect(hookById(e.hookId)!.aiFit).not.toBe("low");
      expect(e.reason.length).toBeGreaterThan(10);
    }
    expect(p.newHookVariants.map((h) => h.hookId)).toEqual(p.explore.map((e) => e.hookId));
  });

  it("suggests cutdowns for the winner and builds a batch-matrix compatible spec", () => {
    const p = proposeNextRound({ projectId: "p1", learning: learning(), plan, trends: risingSlice, platform: "tiktok", now: NOW });
    expect(p.cutdowns).toEqual([{ hookId: "H10", durations: [15, 6], aspects: [] }]);
    expect(p.batch.dims).toMatchObject({ hooks: ["H10", "H31", ...p.explore.map((e) => e.hookId)], endCards: ["E06"], aspects: ["9:16"], durations: [20, 15, 6] });
    const h10 = p.batch.variants.filter((v) => v.hook === "H10");
    expect(h10.map((v) => v.durationSec).sort()).toEqual([15, 20, 6]);
    expect(h10.every((v) => !v.needsGeneration)).toBe(true);
    expect(p.batch.variants.filter((v) => v.needsGeneration).map((v) => v.hook)).toEqual(p.explore.map((e) => e.hookId));
    expect(p.batch.variants[0].name).toMatch(/^Vivid_/);
    expect(p.batch.variants[0].name).toMatch(/_HookH10_E06_9x16_/);
  });

  it("aspects for winners on Meta", () => {
    const meta = { ...plan, platforms: [{ ...plan.platforms[0], platform: "meta_feed", aspect: "4:5", durationSec: 15 }] } as CampaignPlan;
    const p = proposeNextRound({ projectId: "p1", learning: learning(), plan: meta, platform: "meta_feed", now: NOW });
    expect(p.cutdowns[0]).toEqual({ hookId: "H10", durations: [10, 6], aspects: ["1:1", "9:16"] });
  });

  it("costs only new hooks (cost model); never spends — approval required", () => {
    const p = proposeNextRound({ projectId: "p1", learning: learning(), plan, trends: risingSlice, platform: "tiktok", now: NOW });
    expect(p.cost.reEditUsd).toBe(0);
    expect(p.cost.newHookClips).toBe(p.explore.length);
    expect(p.cost.perHookClipUsd).toBeGreaterThan(0.1);
    expect(p.cost.totalUsd).toBeCloseTo(p.cost.perHookClipUsd * p.explore.length, 4);
    expect(p.cost.highUsd).toBeGreaterThan(p.cost.totalUsd);
    expect(p.approval.required).toBe(true);
    expect(p.approval.note).toMatch(/approve to render/i);
    expect(p.approval.note).toMatch(/nothing (was )?rendered/i);
  });

  it("re-edits only cost $0", () => {
    const p = proposeNextRound({ projectId: "p1", learning: learning(), plan, trends: risingSlice, platform: "tiktok", now: NOW, maxExplore: 0 });
    expect(p.explore).toEqual([]);
    expect(p.batch.variants.length).toBeGreaterThan(0);
    expect(p.batch.variants.every((v) => !v.needsGeneration)).toBe(true);
    expect(p.cost.totalUsd).toBe(0);
    expect(p.cost.highUsd).toBe(0);
    expect(p.cost.newHookClips).toBe(0);
    expect(estimateRoundCost([]).totalUsd).toBe(0);
    expect(estimateRoundCost(["H08"]).totalUsd).toBeGreaterThan(0);
  });

  it("no data: a sensible exploration round (3 diverse hooks), no keep/kill", () => {
    const p = proposeNextRound({ projectId: "p1", learning: null, plan: null, trends: null, category: "electronics", platform: "tiktok", now: NOW });
    expect(p.mode).toBe("explore");
    expect(p.keep).toEqual([]);
    expect(p.kill).toEqual([]);
    expect(p.explore).toHaveLength(3);
    expect(new Set(p.explore.map((e) => hookById(e.hookId)!.family)).size).toBe(3);
    expect(p.batch.variants).toHaveLength(3);
    expect(p.cost.totalUsd).toBeGreaterThan(0);
    expect(p.notes.join(" ")).toMatch(/no (imported )?results/i);
  });

  it("no data but a plan: explores the plan's hooks and adds a rising trend", () => {
    const p = proposeNextRound({ projectId: "p1", learning: null, plan, trends: risingSlice, platform: "tiktok", now: NOW });
    expect(p.mode).toBe("explore");
    expect(p.explore.map((e) => e.hookId)).toEqual(["H10", "H02", "H08"]);
    expect(p.explore.find((e) => e.hookId === "H08")!.reason).toMatch(/rising/i);
  });
});

describe("planNextRound (DB)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads learning, plan and trends, stores the proposal on Project.nextRound", async () => {
    db.project.findUnique.mockResolvedValue({ id: "p1", category: "TVs", productBrief: { category: "tv" }, campaignPlan: plan });
    agent.loadElementLearning.mockResolvedValue(learning());
    trends.trendSlice.mockResolvedValue(risingSlice);
    db.project.update.mockResolvedValue({});
    const p = await planNextRound("p1", { now: NOW });
    expect(trends.trendSlice).toHaveBeenCalledWith("electronics", "tiktok", expect.objectContaining({ projectId: "p1" }));
    expect(p.keep[0].id).toBe("H10");
    const call = db.project.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: "p1" });
    expect(call.data.nextRound.keep[0].id).toBe("H10");
    expect(call.data.nextRoundAt).toBeInstanceOf(Date);
  });

  it("survives a trend failure and a missing project", async () => {
    db.project.findUnique.mockResolvedValueOnce({ id: "p1", category: null, productBrief: null, campaignPlan: null });
    agent.loadElementLearning.mockResolvedValue(null);
    trends.trendSlice.mockRejectedValue(new Error("db down"));
    const p = await planNextRound("p1", { now: NOW });
    expect(p.mode).toBe("explore");
    db.project.findUnique.mockResolvedValueOnce(null);
    await expect(planNextRound("nope")).rejects.toThrow(/not found/i);
  });

  it("operator action next-round validates", () => {
    expect(operatorActionSchema.parse({ action: "next-round", projectId: "p1" })).toEqual({ action: "next-round", projectId: "p1" });
    expect(() => operatorActionSchema.parse({ action: "next-round" })).toThrow();
  });
});
