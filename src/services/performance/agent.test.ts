import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  adPerformance: { findMany: vi.fn() },
  perfElementMap: { findMany: vi.fn() },
  libtvRun: { findMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/services/ai/claude-client", () => ({ analyzeWithClaude: vi.fn(() => Promise.reject(new Error("no paid calls in tests"))) }));

import { askPerformance, loadElementLearning, performanceBias } from "./agent";
import { buildStatsTable, uncitedNumbers } from "./ask";
import { learnElements } from "./attribution";
import { elementResolver } from "./elements";
import { rowsFromCsv } from "./import";

const r = (adName: string, impressions: number, views3s: number, clicks: number, conversions = 5, perfRevenue: number | null = null) => ({
  adName,
  platform: "meta",
  impressions,
  views3s,
  thruplays: 0,
  clicks,
  spend: impressions / 100,
  conversions,
  perfRevenue,
  dateFrom: null,
  dateTo: null,
});

beforeEach(() => {
  db.adPerformance.findMany.mockResolvedValue([
    r("Acme_Script_20s_HookQ", 20000, 7000, 300, 15, 900),
    r("Acme_Script_20s_HookC", 20000, 4800, 180, 6, 300),
  ]);
  db.perfElementMap.findMany.mockResolvedValue([{ adName: "Acme_Script_20s_HookQ", hookId: "H06", endCardId: "E04" }]);
  db.libtvRun.findMany.mockResolvedValue([{ id: "run1", qcReport: { variants: [{ adName: "Acme_Script_20s_HookC", hookStyle: "c", hookId: "H13", endCardId: "E06" }] } }]);
});

describe("Performance Agent (DB side, mocked)", () => {
  it("joins the mapping table and run variants to imported rows", async () => {
    const l = await loadElementLearning("p1", { seed: 2 });
    const hooks = l!.dims.find((d) => d.dim === "hookId")!;
    expect(hooks.levels.map((x) => x.level).sort()).toEqual(["H06", "H13"]);
    expect(hooks.tests.hookRate!.winner!.level).toBe("H06");
    expect(l!.totals.roas).toBeCloseTo(1200 / 400, 6);
  });
  it("performanceBias favours the winner and is {} without data", async () => {
    const bias = await performanceBias("p1", { seed: 4 });
    expect(bias.H06).toBeGreaterThan(0);
    expect(bias.H13).toBeLessThan(0);
    db.adPerformance.findMany.mockResolvedValue([]);
    expect(await performanceBias("p1")).toEqual({});
  });
  it("askPerformance makes one model call over the aggregated table and checks citations", async () => {
    const llm = vi.fn(async ({ user }: { system: string; user: string }) => {
      expect(user).toMatch(/QUESTION: Which hook should I scale\?/);
      expect(user).toMatch(/hookId \| H06/);
      return { answer: "Scale H06: hook rate 35.00% vs 24.00% for H13, and ROAS 4.50. Expect 12345 more sales.", cited: ["35.00%"] };
    });
    const res = await askPerformance("p1", "Which hook should I scale?", { llm });
    expect(llm).toHaveBeenCalledTimes(1);
    expect(res.source).toBe("llm");
    expect(res.table[0]).toMatchObject({ dim: "all", level: "all", impressions: 40000 });
    expect(res.uncited).toEqual(["12345"]);
  });
  it("model failure keeps the table; no data skips the model", async () => {
    const failed = await askPerformance("p1", "why?", { llm: async () => ({}) });
    expect(failed.source).toBe("error");
    expect(failed.table.length).toBeGreaterThan(1);
    db.adPerformance.findMany.mockResolvedValue([]);
    const llm = vi.fn();
    expect((await askPerformance("p1", "why?", { llm })).source).toBe("no-data");
    expect(llm).not.toHaveBeenCalled();
  });
});

describe("stats table", () => {
  it("never exceeds 200 lines", () => {
    const rows = Array.from({ length: 400 }, (_, i) => ({ adName: `b_H${String((i % 35) + 1).padStart(2, "0")}_v:voice${i}`, platform: "meta", impressions: 1000, views3s: 250, thruplays: 0, clicks: 10, spend: 10, conversions: 1 }));
    const t = buildStatsTable(learnElements(rows, elementResolver(), { seed: 1, draws: 200 }));
    expect(t.rows.length).toBe(200);
    expect(t.truncated).toBe(true);
    expect(t.text).toMatch(/truncated at 200/);
  });
  it("uncitedNumbers ignores single digits and thousands separators", () => {
    expect(uncitedNumbers("Spend 1,234.50 on 3 hooks; CTR 1.20% and 99", "x | 1234.50 | 1.20%")).toEqual(["99"]);
  });
  it("imports a conversion-value column for ROAS", () => {
    const { rows, unmatchedHeaders } = rowsFromCsv("Ad name,Impressions,3-second video plays,Link clicks,Amount spent (USD),Purchases conversion value\nX_HookQ,1000,250,10,$20.00,$80.00\n");
    expect(rows[0].revenue).toBe(80);
    expect(unmatchedHeaders).not.toContain("revenue");
    expect(rowsFromCsv("Ad name,Impressions\nX,10\n").rows[0].revenue).toBeNull();
  });
});
