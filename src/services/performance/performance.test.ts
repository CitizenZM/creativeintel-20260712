import { describe, expect, it } from "vitest";
import { learn, renderLearningBlock } from "./learn";
import { parseAdName, parseCsv, rowsFromCsv } from "./import";

const META = `Reporting starts,Reporting ends,Ad name,Impressions,3-second video plays,ThruPlays,Link clicks,"Amount spent (USD)",Results
2026-10-01,2026-10-07,TCL_TCLQM7LSeriesTV_20s_HookQ,"10,000","2,500",900,120,$50.00,4
2026-10-01,2026-10-07,TCL_TCLQM7LSeriesTV_20s_HookC,"10,000","3,400",1100,180,$50.00,7
2026-10-01,2026-10-07,TCL_TCLQM7LSeriesTV_20s_HookP_4x5,"10,000","2,600",950,125,$50.00,5
,,Total,"30,000",,,,,
`;

describe("CSV import", () => {
  it("parses quoted numbers and detects Meta", () => {
    expect(parseCsv('a,"1,234",c\n')).toEqual([["a", "1,234", "c"]]);
    const { rows, platform, unmatchedHeaders } = rowsFromCsv(META);
    expect(platform).toBe("meta");
    expect(unmatchedHeaders).toEqual([]);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toMatchObject({ hookStyle: "c", format: "9x16", impressions: 10000, views3s: 3400, clicks: 180, spend: 50, conversions: 7 });
    expect(rows[2]).toMatchObject({ hookStyle: "p", format: "4x5" });
  });
  it("detects TikTok and reads 2-second views", () => {
    const { rows, platform } = rowsFromCsv("Ad name\tImpressions\t2-second video views\t6-second video views\tClicks\tCost\nX_HookQ\t5000\t1200\t400\t60\t25\n");
    expect(platform).toBe("tiktok");
    expect(rows[0]).toMatchObject({ hookStyle: "q", views3s: 1200, thruplays: 400, clicks: 60, spend: 25 });
  });
  it("reads hook style and format from our ad names", () => {
    expect(parseAdName("Brand_Script_20s_HookC_15s")).toEqual({ hookStyle: "c", format: "15s" });
    expect(parseAdName("Some other ad")).toEqual({ hookStyle: null, format: null });
  });
});

describe("learn", () => {
  it("calls a significant winner on hook rate and CTR, and orders variants by evidence", () => {
    const l = learn(rowsFromCsv(META).rows);
    expect(l.hookWinner).toMatchObject({ hookStyle: "c" });
    expect(l.ctrWinner).toMatchObject({ hookStyle: "c" });
    expect(l.order[0]).toBe("c");
    expect(renderLearningBlock(l)).toMatch(/contrast hooks stop the scroll best/);
  });
  it("calls no winner on a small sample", () => {
    const l = learn([
      { hookStyle: "q", impressions: 100, views3s: 25, clicks: 1, spend: 1 },
      { hookStyle: "c", impressions: 100, views3s: 30, clicks: 2, spend: 1 },
    ]);
    expect(l.hookWinner).toBeNull();
    expect(renderLearningBlock(l)).toMatch(/No significant winner yet/);
  });
});
