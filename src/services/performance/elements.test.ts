import { describe, expect, it } from "vitest";
import { elementResolver, mergeElements, parseAdElements } from "./elements";
import { parseAdName } from "./import";
import { aggregateByElement, learnElements, metricsOf, rowWeight, type PerfInputRow } from "./attribution";
import { computeBias } from "./bias";

describe("parseAdElements", () => {
  it("reads the extended name with tagged tokens", () => {
    expect(parseAdElements("brand_tiktok_H06-E08-v:aria-9x16-15s_sp2")).toEqual({
      platform: "tiktok",
      hookId: "H06",
      hookFamily: "reveal",
      endCardId: "E08",
      voice: "aria",
      aspect: "9x16",
      durationSec: 15,
      sellingPointId: "sp2",
    });
  });
  it("accepts any order, case and separators", () => {
    expect(parseAdElements("Acme_15s-e2-voice=Adam_h13_4X5_reels")).toMatchObject({ hookId: "H13", hookFamily: "claim", endCardId: "E02", voice: "adam", aspect: "4x5", durationSec: 15, platform: "instagram_reels" });
    expect(parseAdElements("Acme_meta_feed_HookH31_9:16_E12")).toMatchObject({ platform: "meta_feed", hookId: "H31", endCardId: "E12", aspect: "9x16" });
  });
  it("keeps old names working (legacy hook style, script length, cut-down)", () => {
    expect(parseAdElements("TCL_TCLQM7LSeriesTV_20s_HookC")).toEqual({ hookStyle: "c", durationSec: 20, aspect: "9x16" });
    expect(parseAdElements("Brand_Script_20s_HookC_15s")).toMatchObject({ hookStyle: "c", durationSec: 15 });
    expect(parseAdElements("Brand_Script_HookP_4x5")).toMatchObject({ hookStyle: "p", aspect: "4x5" });
    // The legacy parser is unchanged.
    expect(parseAdName("Brand_Script_20s_HookC_15s")).toEqual({ hookStyle: "c", format: "15s" });
  });
  it("ignores out-of-range ids and unrelated names", () => {
    expect(parseAdElements("Summer sale ad")).toEqual({});
    expect(parseAdElements("brand_H36_E13_H00")).toEqual({});
    expect(parseAdElements("Hero_TikTokViral_Ad")).toEqual({});
  });
  it("mapping fills gaps; name tokens win", () => {
    expect(mergeElements({ hookId: "H06" }, { hookId: "H01", endCardId: "E04", voice: "Aria" })).toEqual({ hookId: "H06", hookFamily: "reveal", endCardId: "E04", voice: "aria" });
    const resolve = elementResolver([{ adName: "Acme_Script_20s_HookQ", hookId: "H10", endCardId: "E06" }]);
    expect(resolve({ adName: "acme_script_20s_hookq_copy 2", platform: "meta" })).toMatchObject({ hookId: "H10", endCardId: "E06", hookStyle: "q", platform: "meta" });
    expect(resolve({ adName: "Other", platform: "tiktok" })).toEqual({ platform: "tiktok" });
  });
});

const row = (adName: string, impressions: number, views3s: number, clicks: number, extra: Partial<PerfInputRow> = {}): PerfInputRow => ({
  adName,
  platform: "meta",
  impressions,
  views3s,
  thruplays: 0,
  clicks,
  spend: impressions / 100,
  conversions: Math.round(clicks / 20),
  ...extra,
});

const ROWS: PerfInputRow[] = [
  row("b_meta_H06-E04-9x16-15s", 20000, 7000, 300, { revenue: 600 }),
  row("b_meta_H06-E06-9x16-15s", 20000, 6900, 260, { revenue: 500 }),
  row("b_meta_H01-E04-9x16-15s", 20000, 4800, 180, { revenue: 300 }),
  row("b_meta_H01-E06-9x16-15s", 20000, 5000, 170, { revenue: 280 }),
  row("b_meta_H13-E04-4x5-15s", 300, 60, 2),
];

describe("attribution", () => {
  it("derives every metric", () => {
    const m = metricsOf({ ads: 1, impressions: 10000, views3s: 2500, thruplays: 900, clicks: 120, spend: 50, conversions: 4, revenue: 200 });
    expect(m).toEqual({ hookRate: 0.25, holdRate: 0.09, ctr: 0.012, cpc: 50 / 120, cpm: 5, cvr: 4 / 120, cpa: 12.5, roas: 4 });
    expect(metricsOf({ ads: 0, impressions: 0, views3s: 0, thruplays: 0, clicks: 0, spend: 0, conversions: 0, revenue: 0 })).toMatchObject({ hookRate: null, cpa: null, roas: null });
  });
  it("aggregates per element level and decays old rows", () => {
    const agg = aggregateByElement(ROWS, elementResolver());
    expect(agg.hookId.get("H06")).toMatchObject({ ads: 2, impressions: 40000, views3s: 13900 });
    expect(agg.endCardId.get("E04")!.ads).toBe(3);
    expect(agg.hookFamily.get("reveal")!.ads).toBe(4);
    const now = new Date("2026-10-31");
    expect(rowWeight({ dateTo: new Date("2026-10-10") }, { now, halfLifeDays: 21 })).toBeCloseTo(0.5, 6);
    expect(rowWeight({}, { now, halfLifeDays: 21 })).toBe(1);
  });
  it("calls a hook winner with P(best), guards the small arm, keeps holdRate off without data", () => {
    const l = learnElements(ROWS, elementResolver(), { seed: 5 });
    const hooks = l.dims.find((d) => d.dim === "hookId")!;
    expect(hooks.levels.map((x) => x.level)).toEqual(["H06", "H01", "H13"]);
    const hr = hooks.tests.hookRate!;
    expect(hr.status).toBe("winner");
    expect(hr.winner!.level).toBe("H06");
    expect(hr.arms.find((a) => a.level === "H13")!.eligible).toBe(false);
    expect(hooks.tests.holdRate).toBeUndefined();
    expect(learnElements(ROWS, elementResolver(), { seed: 5 })).toEqual(l);
  });
});

describe("performance bias", () => {
  it("rewards the winning hook, penalises the loser, stays bounded", () => {
    const { bias } = computeBias(ROWS, elementResolver(), { seed: 9, maxWeight: 3 });
    expect(bias.H06).toBeGreaterThan(0);
    expect(bias.H01).toBeLessThan(0);
    expect(bias.H13).toBeUndefined();
    for (const v of Object.values(bias)) expect(Math.abs(v!)).toBeLessThanOrEqual(3);
    expect(computeBias(ROWS, elementResolver(), { seed: 9 })).toEqual(computeBias(ROWS, elementResolver(), { seed: 9 }));
  });
  it("decays with data age and is empty without data", () => {
    const dated = ROWS.map((r) => ({ ...r, dateTo: new Date("2026-06-01") }));
    const fresh = computeBias(dated, elementResolver(), { seed: 9, now: new Date("2026-06-02") }).bias;
    const stale = computeBias(dated, elementResolver(), { seed: 9, now: new Date("2026-10-01") }).bias;
    expect(Math.abs(stale.H06 ?? 0)).toBeLessThan(Math.abs(fresh.H06!));
    expect(computeBias([], elementResolver(), {}).bias).toEqual({});
  });
});
