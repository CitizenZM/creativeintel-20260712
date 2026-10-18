import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  project: { findUnique: vi.fn(), update: vi.fn() },
  campaignSelection: { findUnique: vi.fn() },
  brandKit: { findUnique: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: db }));
const perf = vi.hoisted(() => ({ performanceBias: vi.fn() }));
vi.mock("@/services/performance/agent", () => perf);
const trends = vi.hoisted(() => ({ trendBiasByPlatform: vi.fn() }));
vi.mock("@/services/research/hook-trends", async (orig) => ({ ...(await orig<object>()), trendBiasByPlatform: trends.trendBiasByPlatform }));
const planner = vi.hoisted(() => ({ planCampaign: vi.fn() }));
vi.mock("./campaign-planner", async (orig) => ({ ...(await orig<object>()), planCampaign: planner.planCampaign }));

import { createCampaignPlan } from "./campaign-plan.store";

describe("createCampaignPlan bias", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.project.findUnique.mockResolvedValue({ id: "p1", productBrief: { category: "tv", sellingPoints: [], product: {} }, campaignGoal: null, goalType: null });
    db.campaignSelection.findUnique.mockResolvedValue(null);
    db.brandKit.findUnique.mockResolvedValue(null);
    db.project.update.mockResolvedValue({});
    planner.planCampaign.mockResolvedValue({ platforms: [] });
  });

  it("merges competitor trend bias under our performance bias", async () => {
    perf.performanceBias.mockResolvedValue({ H08: -1, E03: 0.5 });
    trends.trendBiasByPlatform.mockResolvedValue({ tiktok: { H08: 1.8, H16: -1.5 } });
    await createCampaignPlan("p1", { platforms: ["tiktok"] });
    expect(trends.trendBiasByPlatform).toHaveBeenCalledWith("tv", ["tiktok"], { projectId: "p1" });
    expect(planner.planCampaign.mock.calls[0][0].biasByPlatform).toEqual({ tiktok: { H08: -1, E03: 0.5, H16: -1.5 } });
  });

  it("trend failure keeps the performance bias; both empty → no bias", async () => {
    perf.performanceBias.mockResolvedValue({ H10: 2 });
    trends.trendBiasByPlatform.mockRejectedValue(new Error("db down"));
    await createCampaignPlan("p1", { platforms: ["tiktok", "meta_feed"] });
    expect(planner.planCampaign.mock.calls[0][0].biasByPlatform).toEqual({ tiktok: { H10: 2 }, meta_feed: { H10: 2 } });
    perf.performanceBias.mockResolvedValue({});
    trends.trendBiasByPlatform.mockResolvedValue({});
    await createCampaignPlan("p1");
    expect(planner.planCampaign.mock.calls[1][0].bias).toBeUndefined();
    expect(Object.values(planner.planCampaign.mock.calls[1][0].biasByPlatform)).toEqual([undefined, undefined, undefined]);
  });

  it("an explicit bias (or null = off) skips loading", async () => {
    await createCampaignPlan("p1", { bias: null });
    expect(perf.performanceBias).not.toHaveBeenCalled();
    expect(trends.trendBiasByPlatform).not.toHaveBeenCalled();
    expect(planner.planCampaign.mock.calls[0][0].bias).toBeUndefined();
    expect(planner.planCampaign.mock.calls[0][0].biasByPlatform).toBeUndefined();
  });
});
