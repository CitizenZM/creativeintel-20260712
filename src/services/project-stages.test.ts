import { beforeEach, describe, expect, it, vi } from "vitest";
const query = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ prisma: { $queryRaw: query } }));
vi.mock("@/lib/sql-table", () => ({ sqlTable: (name: string) => name }));
vi.mock("@/services/brand-kit", () => ({ calculateBrandKitCompleteness: () => ({ score: 95, missing: [], ready: { creative: true } }) }));
import { getProjectStages, getProjectsStages } from "./project-stages";
const snapshot = (id: string) => ({
  id, project: { productName: "Product", productUrl: null, productPageTitle: null, productConfirmedAt: null, campaignGoal: "Sales", goalType: "conversion", category: null, campaignSelection: { styleCategories: ["testimonial"] } },
  kit: null, competitors: 3, assets: 10, paidAssets: 1, teardowns: 2, pickedPoints: 1, pickedPatterns: 0, pickedInsights: 0,
  scripts: 2, selectedScripts: 1, approvedBoards: 1, unresearched: [], runs: [{ status: "completed", masterMp4Url: "https://example.com/master.mp4" }],
});
beforeEach(() => query.mockReset());
describe("project progress summaries", () => {
  it("batches eight projects in one query and preserves requested order", async () => {
    const ids = Array.from({ length: 8 }, (_, i) => `p${i}`);
    query.mockResolvedValue([...ids].reverse().map(snapshot));
    const stages = await getProjectsStages(ids);
    expect(query).toHaveBeenCalledTimes(1);
    expect(stages.map((s) => s.projectId)).toEqual(ids);
    expect(stages.every((s) => s.next === null)).toBe(true);
  });
  it("keeps coverage and storyboard approval as completion criteria", async () => {
    query.mockResolvedValue([{ ...snapshot("p"), unresearched: [{ name: "New competitor" }], approvedBoards: 0 }]);
    const stages = await getProjectStages("p");
    expect(stages.next?.id).toBe("research");
    expect(stages.next?.criteria.find((c) => c.id === "research.coverage")?.label).toContain("New competitor");
    expect(stages.stages.find((s) => s.id === "creative")?.state).toBe("partial");
  });
  it("does not query an empty list and rejects a missing project", async () => {
    expect(await getProjectsStages([])).toEqual([]);
    expect(query).not.toHaveBeenCalled();
    query.mockResolvedValue([]);
    await expect(getProjectStages("missing")).rejects.toThrow("Project not found");
  });
});
