import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  project: { findUnique: vi.fn(), findMany: vi.fn() },
  contentAsset: { findMany: vi.fn() },
  adTeardown: { findMany: vi.fn() },
  adStructure: { findMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: db }));

import { operatorActionSchema } from "@/services/operator";
import { metaAds, NOW, structure, teardownAssets, teardowns, tiktokAds, vagueAds } from "./__fixtures__/trend-ads";
import {
  buildHookTrendReport,
  categoryKey,
  classifyAds,
  computeHookTrends,
  hookTrendReport,
  mergeBias,
  recordFromContentAsset,
  recordFromStructure,
  recordFromTeardown,
  toTrendRecords,
  trendBias,
  trendBiasFromSlice,
  trendPlatformOf,
  type ClassifiedAd,
} from "./hook-trends";

const records = () => toTrendRecords({ contentAssets: [...tiktokAds, ...metaAds, ...teardownAssets], teardowns, structures: [structure] }, "electronics");

async function classified(): Promise<ClassifiedAd[]> {
  return (await classifyAds(records())).classified;
}

describe("records from the stored research rows", () => {
  it("normalises platforms and categories", () => {
    expect(trendPlatformOf("TikTok")).toBe("tiktok");
    expect(trendPlatformOf("Instagram")).toBe("meta");
    expect(trendPlatformOf("Facebook")).toBe("meta");
    expect(trendPlatformOf("instagram_reels")).toBe("meta");
    expect(trendPlatformOf("YouTube Shorts")).toBe("youtube");
    expect(trendPlatformOf(null)).toBeNull();
    expect(categoryKey("tv")).toBe("electronics");
    expect(categoryKey("TVs")).toBe("electronics");
    expect(categoryKey("kitchen")).toBe("kitchen");
    expect(categoryKey("Air purifiers")).toBe("home_air");
    expect(categoryKey("")).toBeNull();
  });

  it("maps a Meta / TikTok ContentAsset, a teardown and a structure", () => {
    const a = recordFromContentAsset(tiktokAds[1], "electronics");
    expect(a).toMatchObject({ kind: "ad", platform: "tiktok", owner: "Lumen TV", category: "electronics", hookText: "POV: your TV in a bright living room" });
    expect(a.url).toMatch(/^https:\/\/www\.tiktok\.com\//);
    const t = recordFromTeardown(teardowns[0], "electronics");
    expect(t).toMatchObject({ kind: "teardown", platform: "tiktok", hookType: "before_after", url: teardownAssets[0].url });
    expect(t.beats[0].visual).toMatch(/before\/after/i);
    expect(t.firstSeenAt?.getTime()).toBe(teardownAssets[0].firstSeenAt?.getTime());
    const s = recordFromStructure(structure, "electronics");
    expect(s).toMatchObject({ kind: "structure", platform: "tiktok", owner: "Brightline" });
  });

  it("a teardown replaces its own content asset (no double count)", () => {
    const r = records();
    expect(r.filter((x) => x.id === "ca_ba_1" || x.id === "td_ca_ba_1")).toHaveLength(1);
    expect(r.find((x) => x.url === teardownAssets[0].url)?.kind).toBe("teardown");
    expect(r).toHaveLength(tiktokAds.length + metaAds.length + teardowns.length + 1);
  });
});

describe("classifyAds — the cloner's rules, batched LLM only for the unsure", () => {
  it("classifies with rules (no model) and drops openings with no signal", async () => {
    const llm = vi.fn();
    const r = await classifyAds([...records(), ...toTrendRecords({ contentAssets: vagueAds.slice(0, 3) }, "electronics")]);
    expect(llm).not.toHaveBeenCalled();
    expect(r.llmCalls).toBe(0);
    const by = (title: string) => r.classified.find((c) => c.title === title)?.hookId;
    expect(by("POV: your TV in a bright living room")).toBe("H08");
    expect(by("Stop scrolling if your TV looks washed out")).toBe("H28");
    expect(by("30% off the brightest TV we make")).toBe("H16");
    expect(by("1,500 nits of brightness")).toBe("H15");
    expect(by("3 reasons gamers switch to mini-LED")).toBe("H13");
    expect(r.classified.find((c) => c.kind === "teardown")).toMatchObject({ hookId: "H10", family: "demo", method: "rules" });
    expect(r.unclassified).toBe(3);
  });

  it("sends unsure openings to the model in batches of ≤ 40 and keeps sure ones on rules", async () => {
    const llm = vi.fn(async ({ user }: { system: string; user: string }) => {
      const ads = JSON.parse(user).ads as { i: number }[];
      return { picks: ads.map((a) => ({ i: a.i, hookId: a.i % 2 ? "H01" : "h99" })) };
    });
    const input = [...records(), ...toTrendRecords({ contentAssets: vagueAds }, "electronics")];
    const r = await classifyAds(input, { llm });
    const unsure = input.length - r.classified.filter((c) => c.method === "rules").length;
    expect(llm).toHaveBeenCalledTimes(Math.ceil(unsure / 40));
    for (const call of llm.mock.calls) expect(JSON.parse(call[0].user).ads.length).toBeLessThanOrEqual(40);
    expect(r.llmCalls).toBe(llm.mock.calls.length);
    expect(r.classified.some((c) => c.method === "llm" && c.hookId === "H01")).toBe(true);
    // An unknown model id falls back (vague ones have no rule signal → unclassified).
    expect(r.classified.find((c) => c.title === "POV: your TV in a bright living room")?.method).toBe("rules");
    expect(r.classified.every((c) => /^H\d\d$/.test(c.hookId))).toBe(true);
  });

  it("a model failure keeps the rule / hook-type fallback", async () => {
    const r = await classifyAds(records(), { llm: async () => { throw new Error("rate limited"); } });
    expect(r.classified.find((c) => c.title === "$200 off this weekend only")).toMatchObject({ hookId: "H16", method: "fallback" });
  });
});

describe("computeHookTrends — share, week-over-week, longevity, novelty", () => {
  it("TikTok × electronics: POV rising, deal slam saturated, before/after the longevity leader, stop-scroll fading", async () => {
    const c = await classified();
    const slice = computeHookTrends(c.filter((x) => x.platform === "tiktok"), { now: NOW, category: "electronics", platform: "tiktok" });
    const h = (id: string) => slice.hooks.find((x) => x.hookId === id)!;
    expect(slice.totalAds).toBe(21);
    expect(slice.hooks.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 5);
    expect(slice.hooks[0].hookId).toBe("H16"); // most used first

    expect(h("H08").status).toBe("rising");
    expect(h("H08").launchesThisWeek).toBe(3);
    expect(h("H08").wowGrowth).toBeGreaterThan(1);
    expect(h("H08").novelty).toBeGreaterThan(0.3);

    expect(h("H16").status).toBe("saturated");
    expect(h("H16").share).toBeGreaterThanOrEqual(0.25);
    expect(h("H16").novelty).toBe(0);

    expect(h("H10").avgRunDays).toBeGreaterThan(80);
    expect(h("H10").longevityScore).toBeGreaterThan(h("H10").share * 1.4);
    const lift = (x: ReturnType<typeof h>) => x.longevityScore / x.share;
    expect(Math.max(...slice.hooks.map(lift))).toBe(lift(h("H10")));

    expect(h("H28").status).toBe("fading");
    expect(h("H15").status).toBe("steady");
    expect(h("H08").examples[0].url).toMatch(/tiktok\.com/);
    expect(slice.families.find((f) => f.family === "claim")!.share).toBeGreaterThan(0.4);
  });

  it("ads outside the window don't count", async () => {
    const c = await classified();
    const slice = computeHookTrends(c.filter((x) => x.platform === "tiktok"), { now: NOW, windowDays: 7 });
    expect(slice.hooks.find((x) => x.hookId === "H28")).toBeUndefined();
  });
});

describe("trendBias", () => {
  it("is bounded ±2: rising up, saturated down; nothing on thin data", async () => {
    const c = await classified();
    const slice = computeHookTrends(c.filter((x) => x.platform === "tiktok"), { now: NOW });
    const b = trendBiasFromSlice(slice);
    expect(b.H08).toBeGreaterThan(0.5);
    expect(b.H16).toBeLessThan(0);
    for (const v of Object.values(b)) expect(Math.abs(v!)).toBeLessThanOrEqual(2);
    expect(trendBiasFromSlice(computeHookTrends(c.slice(0, 3), { now: NOW }))).toEqual({});
  });

  it("mergeBias: our own performance wins over trends when both score an id", () => {
    expect(mergeBias({ H08: -1.2, E03: 0.5 }, { H08: 1.8, H16: -1.5 })).toEqual({ H08: -1.2, E03: 0.5, H16: -1.5 });
    expect(mergeBias(undefined, { H16: -1 })).toEqual({ H16: -1 });
    expect(mergeBias({}, {})).toBeUndefined();
    expect(mergeBias(undefined, undefined)).toBeUndefined();
  });

  it("loads the category's ads (rules only, no model) and scores one platform", async () => {
    db.project.findMany.mockResolvedValueOnce([{ id: "proj_tv", category: "TVs" }, { id: "proj_x", category: "Air fryers" }]).mockResolvedValueOnce([]);
    db.contentAsset.findMany.mockResolvedValue([...tiktokAds, ...metaAds, ...teardownAssets]);
    db.adTeardown.findMany.mockResolvedValue(teardowns);
    db.adStructure.findMany.mockResolvedValue([structure]);
    const b = await trendBias("electronics", "tiktok", { now: NOW });
    expect(b.H08).toBeGreaterThan(0);
    expect(b.H16).toBeLessThan(0);
    expect(db.contentAsset.findMany.mock.calls[0][0].where.projectId.in).toEqual(["proj_tv"]);
  });

  it("returns {} when the database fails", async () => {
    db.project.findMany.mockRejectedValueOnce(new Error("db down"));
    expect(await trendBias("electronics", "tiktok", { now: NOW })).toEqual({});
  });
});

describe("hookTrendReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.project.findUnique.mockResolvedValue({ id: "proj_tv", category: "TVs", productBrief: { category: "tv" }, campaignPlan: { platforms: [{ platform: "tiktok", hookVariants: [{ hookId: "H16" }, { hookId: "H10" }] }] } });
    db.project.findMany.mockResolvedValueOnce([{ id: "proj_tv", category: "TVs" }]).mockResolvedValueOnce([]);
    db.contentAsset.findMany.mockResolvedValue([...tiktokAds, ...metaAds, ...teardownAssets]);
    db.adTeardown.findMany.mockResolvedValue(teardowns);
    db.adStructure.findMany.mockResolvedValue([structure]);
  });

  it("weekly report: rising hooks with example links, saturated hooks to avoid, recommendations", async () => {
    const r = await hookTrendReport("proj_tv", { now: NOW, platform: "tiktok" });
    expect(r.category).toBe("electronics");
    expect(r.platform).toBe("tiktok");
    expect(r.rising[0].hookId).toBe("H08");
    expect(r.rising[0].examples.length).toBeGreaterThan(0);
    expect(r.rising[0].examples[0].url).toMatch(/^https:\/\//);
    expect(r.saturated.map((s) => s.hookId)).toContain("H16");
    expect(r.longevityLeaders[0].hookId).toBe("H10");
    expect(r.recommendations.join("\n")).toMatch(/H08/);
    expect(r.recommendations.join("\n")).toMatch(/H16.*(saturated|Avoid)/i);
    // Our plan leads with a saturated hook: the report says so.
    expect(r.ourPlan?.hookIds).toEqual(["H16", "H10"]);
    expect(r.recommendations.some((x) => /plan/i.test(x) && /H16/.test(x))).toBe(true);
    expect(r.coverage.llmCalls).toBe(0);
  });

  it("all platforms: one slice per platform plus the overall one", async () => {
    const r = await hookTrendReport("proj_tv", { now: NOW });
    expect(r.platform).toBe("all");
    expect(r.slices.map((s) => s.platform).sort()).toEqual(["all", "meta", "tiktok"]);
    expect(r.coverage.byPlatform).toMatchObject({ tiktok: 22, meta: 6 });
  });

  it("no ads: an empty report that says to run research", () => {
    const r = buildHookTrendReport([], { projectId: "p", category: "electronics", platform: "all", now: NOW, unclassified: 0, llmCalls: 0 });
    expect(r.rising).toEqual([]);
    expect(r.recommendations[0]).toMatch(/research/i);
  });

  it("operator action hook-trends validates", () => {
    expect(operatorActionSchema.parse({ action: "hook-trends", projectId: "p1", platform: "tiktok", category: "tv" })).toMatchObject({ action: "hook-trends" });
    expect(() => operatorActionSchema.parse({ action: "hook-trends" })).toThrow();
  });
});
