import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { adStudioAdName, adStudioHookOf, hookWinRates, reviewInsight, MIN_IMPRESSIONS } from "./adstudio-results";
import { parseAdName } from "@/services/performance/import";
import { shapeContext, summarizeContext } from "./adstudio-context";

describe("P4: Ad Studio results back into Xark", () => {
  it("ad name carries the hook type, and the performance import reads it back", () => {
    const name = adStudioAdName({ brand: "MIXIK Skin", title: "⚠ The Instant Glow Mist Routine", durationSec: 23.7, hookType: "result", engine: "auto" });
    expect(name).toBe("MIXIKSkin_TheInstantGlowMist_24s_ASResult_EAuto");
    expect(adStudioHookOf(name)).toBe("as:result");
    expect(parseAdName(name).hookStyle).toBe("as:result");
    expect(parseAdName("Brand_Script_20s_HookC").hookStyle).toBe("c"); // LibTV names unchanged
  });
  it("win rate per hook type: Ad Studio names and LibTV styles, too-small samples left out", () => {
    const rates = hookWinRates([
      { hookStyle: "as:result", impressions: 1000, clicks: 30, conversions: 3 },
      { hookStyle: "as:result", impressions: 1000, clicks: 10, conversions: 1 },
      { hookStyle: "q", impressions: 2000, clicks: 20, conversions: 0 },
      { hookStyle: "as:pain", impressions: MIN_IMPRESSIONS - 1, clicks: 50, conversions: 5 },
      { hookStyle: "h09", impressions: 5000, clicks: 500, conversions: 0 },
    ]);
    expect(rates).toEqual([
      { hookType: "result", ads: 2, impressions: 2000, ctr: 0.02, cvr: 0.1 },
      { hookType: "question", ads: 1, impressions: 2000, ctr: 0.01, cvr: 0 },
    ]);
  });
  it("real results move the suggested hook types ahead of research", () => {
    const base = { project: {}, teardowns: [{ hookType: "curiosity_gap", contentAsset: { overallScore: 90 } }] };
    expect(shapeContext(base).suggestedHookTypes[0]).toBe("curiosity");
    const c = shapeContext({ ...base, performance: [{ hookStyle: "as:pain", impressions: 4000, clicks: 80, conversions: 4 }] });
    expect(c.suggestedHookTypes[0]).toBe("pain");
    expect(summarizeContext(c).testedHooks).toBe(1);
  });
  it("review → one Insight per run: strongest, weakest, what to fix next", () => {
    const i = reviewInsight({ id: "r1", hookType: "result", engine: "auto" }, { scores: { hook: 5, sell: 5, offer: 4, audio: 8, fidelity: 7 }, verdict: "Clear demo, weak offer." });
    expect(i).toMatchObject({ category: "adstudio_review", description: "Clear demo, weak offer.", recommendation: "Next video: work on offer (scored 4/10).", evidence: { runId: "r1" } });
    expect(i?.title).toContain("strongest audio 8, fidelity 7");
    expect(reviewInsight({ id: "r2", hookType: "x", engine: "y" }, null)).toBeNull();
  });
  it("wiring: reportDone saves the insight, context loads performance, Deliver lists the videos", () => {
    const q = readFileSync("src/services/video-gen/adstudio-queue.ts", "utf8");
    expect(q).toMatch(/if \(d\.review\) await saveReviewInsight\(r\.projectId, r, d\.review\)/);
    expect(q).toMatch(/scriptIdOf\(storyboardId\)/);
    expect(readFileSync("src/services/video-gen/adstudio-context.ts", "utf8")).toMatch(/prisma\.adPerformance\.findMany/);
    expect(readFileSync("src/app/projects/[projectId]/deliver/page.tsx", "utf8")).toMatch(/prisma\.adStudioRun\.findMany[\s\S]*adStudioAdName\(/);
    expect(readFileSync("src/app/api/projects/[projectId]/studio/adstudio-runs/route.ts", "utf8")).toMatch(/scripts: scriptSources/);
  });
  it("a weak review ranks above a strong one as an insight; the ad name carries the run id", () => {
    const weak = reviewInsight({ id: "a", hookType: "pain", engine: "auto" }, { scores: { hook: 4, sell: 4, offer: 2 } });
    const strong = reviewInsight({ id: "b", hookType: "pain", engine: "auto" }, { scores: { hook: 8, sell: 9, offer: 8 } });
    expect(weak!.importance).toBeGreaterThan(strong!.importance);
    expect(weak!.importance).toBeCloseTo(0.67, 2);
    expect(adStudioAdName({ brand: "MIXIK", title: "Glow", hookType: "pain", engine: "auto", runId: "cmw7achmt0002vritoqg6xh4d" })).toMatch(/_ASPain_EAuto_Rg6xh4d$/);
    expect(readFileSync("src/app/projects/[projectId]/deliver/page.tsx", "utf8")).toMatch(/engine: r\.engine, runId: r\.id \}/);
  });
});

