import { describe, expect, it } from "vitest";
import { parseAdName } from "@/services/performance/import";
import {
  batchAdName,
  claimableVariants,
  buildBatchMatrix,
  coverageOf,
  estimateBatchCost,
  fullFactorial,
  pairwiseDesign,
  renderParamsFor,
  voiceSlug,
  type BatchSource,
} from "./batch-matrix";
import type { PlatformPlan } from "./campaign-plan.types";

/** Every pair of levels (factor a level x, factor b level y) appears in some row. */
function allPairsCovered(rows: number[][], counts: number[]): boolean {
  for (let a = 0; a < counts.length; a++)
    for (let b = a + 1; b < counts.length; b++)
      for (let x = 0; x < counts[a]; x++)
        for (let y = 0; y < counts[b]; y++) if (!rows.some((r) => r[a] === x && r[b] === y)) return false;
  return true;
}

describe("pairwiseDesign", () => {
  it.each([
    [[2, 2, 2]],
    [[3, 3, 3, 3]],
    [[3, 2, 4, 2, 2, 3, 4]],
    [[5, 1, 3, 2]],
    [[2, 7]],
    [[4, 4, 4, 4, 4]],
  ])("covers every pair for levels %j", (counts) => {
    const rows = pairwiseDesign(counts);
    expect(allPairsCovered(rows, counts)).toBe(true);
    for (const r of rows) {
      expect(r).toHaveLength(counts.length);
      r.forEach((v, i) => expect(v >= 0 && v < counts[i]).toBe(true));
    }
  });

  it("is far smaller than the full factorial and never below the two largest factors' product", () => {
    const counts = [3, 3, 3, 3];
    const rows = pairwiseDesign(counts);
    expect(rows.length).toBeGreaterThanOrEqual(9);
    expect(rows.length).toBeLessThanOrEqual(12); // full factorial is 81; the optimum is 9
    const big = pairwiseDesign([3, 2, 4, 2, 2, 3, 4]);
    expect(big.length).toBeLessThan(40); // full factorial 4,608
  });

  it("is deterministic", () => {
    expect(pairwiseDesign([3, 2, 4, 2, 3])).toEqual(pairwiseDesign([3, 2, 4, 2, 3]));
  });

  it("handles 0 and 1 factors", () => {
    expect(pairwiseDesign([])).toEqual([[]]);
    expect(pairwiseDesign([3])).toEqual([[0], [1], [2]]);
  });
});

describe("fullFactorial / coverageOf", () => {
  it("enumerates in mixed radix order and reports coverage", () => {
    const rows = fullFactorial([2, 3]);
    expect(rows).toEqual([[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]]);
    expect(coverageOf(rows, [2, 3])).toEqual({ pairsTotal: 6, pairsCovered: 6, levelsTotal: 5, levelsCovered: 5 });
    expect(coverageOf([[0, 0]], [2, 3])).toMatchObject({ pairsCovered: 1, levelsCovered: 2 });
  });
});

describe("batchAdName / parseAdName", () => {
  const base = { brand: "TCL", title: "QM7 L series TV", aspect: "4:5" as const, voice: "en-US-AndrewMultilingualNeural", endCard: "E04", music: "pop", cta: "Shop now" };

  it("encodes hook, end card, aspect, voice, mood, CTA and duration and parses back", () => {
    const name = batchAdName({ ...base, durationSec: 15, hook: "H09" });
    expect(name).toBe("TCL_QM7LSeriesTV_15s_HookH09_E04_4x5_VAndrewMultilingual_MPop_CShopNow");
    expect(parseAdName(name)).toEqual({
      hookStyle: "h09",
      format: "4x5",
      hookId: "H09",
      endCard: "E04",
      aspect: "4x5",
      durationSec: 15,
      voice: "AndrewMultilingual",
      music: "pop",
      cta: "ShopNow",
    });
  });

  it("keeps the q/c/p hook style readable for the learning loop", () => {
    const name = batchAdName({ ...base, aspect: "9:16", durationSec: 30, hook: "c" });
    expect(name).toContain("_HookC_E04_9x16_");
    expect(parseAdName(name)).toMatchObject({ hookStyle: "c", hookId: null, format: "9x16", durationSec: 30 });
  });

  it("still reads the old naming", () => {
    expect(parseAdName("Brand_Script_20s_HookC_15s")).toEqual({ hookStyle: "c", format: "15s" });
    expect(parseAdName("TCL_Tv_20s_HookP_4x5")).toEqual({ hookStyle: "p", format: "4x5" });
    expect(parseAdName("Brand_Script_20s_HookQ")).toEqual({ hookStyle: "q", format: "9x16" });
    expect(parseAdName("Some other ad")).toEqual({ hookStyle: null, format: null });
  });

  it("stays under the stored ad-name length", () => {
    const long = batchAdName({ ...base, brand: "A very long brand name indeed", title: "An extremely long product script title that goes on", durationSec: 6, hook: "H35", cta: "Get it before the weekend sale ends tonight" });
    expect(long.length).toBeLessThan(160);
    expect(parseAdName(long).hookId).toBe("H35");
  });

  it("voiceSlug strips locale and Neural", () => {
    expect(voiceSlug("en-US-JennyNeural")).toBe("Jenny");
    expect(voiceSlug("en-GB-RyanNeural")).toBe("Ryan");
  });
});

const runSource: BatchSource = {
  kind: "run",
  brand: "TCL",
  title: "QM7 TV",
  masterAspect: "9:16",
  masterDurationSec: 20,
  masterHookStyle: "q",
  masterHookId: "H10",
  endCardId: "E04",
  endCardButton: "Shop now",
  hookTexts: { H10: "Brighter than the sun" },
};

describe("buildBatchMatrix", () => {
  it("builds a pairwise matrix with unique names, free re-edits and generation flags", () => {
    const m = buildBatchMatrix({
      source: runSource,
      dims: { hooks: ["q", "c", "H10", "H20"], endCards: ["E04", "E01"], voices: ["en-US-AndrewMultilingualNeural", "en-US-JennyNeural"], aspects: ["9:16", "4:5", "1:1"], durations: [15, 10] },
      design: "pairwise",
      maxVariants: 50,
      now: "2026-10-06T00:00:00.000Z",
    });
    expect(m.design).toBe("pairwise");
    expect(m.coverage.pairsCovered).toBe(m.coverage.pairsTotal);
    expect(m.variants.length).toBeLessThan(4 * 2 * 2 * 3 * 2);
    expect(new Set(m.variants.map((v) => v.name)).size).toBe(m.variants.length);
    for (const v of m.variants) {
      if (v.hook === "H20") {
        expect(v.needsGeneration).toBe(true);
        expect(v.status).toBe("needs_generation");
      } else {
        expect(v.needsGeneration).toBe(false);
        expect(v.status).toBe("planned");
      }
    }
    const master = m.variants.find((v) => v.hook === "H10")!;
    expect(master.hookKind).toBe("master");
    expect(master.hookText).toBe("Brighter than the sun");
    expect(m.id).toMatch(/^b[0-9a-z]+$/);
  });

  it("drops durations longer than the master and end cards the re-edit can't render", () => {
    const m = buildBatchMatrix({ source: runSource, dims: { durations: [6, 15, 30], endCards: ["E04", "E06"] }, design: "full", maxVariants: 20 });
    expect(m.levels.durations).toEqual([6, 15]);
    expect(m.levels.endCards).toEqual(["E04"]);
    expect(m.notes.join(" ")).toMatch(/30 s/);
    expect(m.notes.join(" ")).toMatch(/E06/);
  });

  it("full factorial respects the cap and keeps pairwise coverage first", () => {
    const m = buildBatchMatrix({ source: runSource, dims: { hooks: ["q", "c", "p"], aspects: ["9:16", "4:5", "1:1"], durations: [10, 15] }, design: "full", maxVariants: 10 });
    expect(m.variants).toHaveLength(10);
    expect(m.coverage.pairsCovered).toBe(m.coverage.pairsTotal);
    const all = buildBatchMatrix({ source: runSource, dims: { hooks: ["q", "c", "p"], aspects: ["9:16", "4:5"] }, design: "full", maxVariants: 50 });
    expect(all.variants).toHaveLength(6);
  });

  it("truncates a pairwise design to maxVariants and says so", () => {
    const m = buildBatchMatrix({ source: runSource, dims: { hooks: ["q", "c", "p"], aspects: ["9:16", "4:5", "1:1"], durations: [10, 15, 20] }, design: "pairwise", maxVariants: 4 });
    expect(m.variants).toHaveLength(4);
    expect(m.coverage.pairsCovered).toBeLessThan(m.coverage.pairsTotal);
    expect(m.notes.join(" ")).toMatch(/maxVariants/);
  });

  it("defaults dimensions from a campaign-plan platform", () => {
    const plan = {
      platform: "tiktok",
      label: "TikTok",
      durationSec: 15,
      aspect: "9:16",
      musicMood: "upbeat holiday pop",
      voice: "energetic",
      hookVariants: [
        { hookId: "H08", openingText: "Wait for it" },
        { hookId: "H17", openingText: "I tried it" },
      ],
      endCard: { id: "E12", name: "Creator close", button: "Tap to shop" },
      endCardAlternates: [{ id: "E09", name: "Tap-below", button: "Tap Shop Now below" }],
    } as unknown as PlatformPlan;
    const m = buildBatchMatrix({ source: { kind: "plan", brand: "TCL", title: "QM7", plan }, dims: {}, design: "pairwise", maxVariants: 20 });
    expect(m.levels.hooks).toEqual(["H08", "H17"]);
    expect(m.levels.endCards).toEqual(["E12", "E09"]);
    expect(m.levels.ctas).toEqual(["Tap to shop"]);
    expect(m.levels.musicMoods).toEqual(["holiday"]);
    // A plan has no rendered master yet: every hook is a new clip.
    expect(m.variants.every((v) => v.needsGeneration)).toBe(true);
  });
});

describe("estimateBatchCost", () => {
  it("re-edits cost ~$0 and each new hook clip is charged once (OpenRouter cents → $)", () => {
    const m = buildBatchMatrix({ source: runSource, dims: { hooks: ["q", "H20", "H22"], aspects: ["9:16", "4:5"] }, design: "full", maxVariants: 20 });
    const cost = estimateBatchCost(m.variants, { imageModel: "Seedream 5 Flash (OpenRouter)", videoModel: "Veo 3.1 Lite 720p (OpenRouter)", hookSec: 3 });
    expect(cost.reEditVariants).toBe(2);
    expect(cost.needsGenerationVariants).toBe(4);
    expect(cost.newHookClips).toBe(2);
    // 1 keyframe (2¢) + one 4 s Veo clip (12¢) per new hook = 14¢ → $0.14 each.
    expect(cost.perHookClipUsd).toBeCloseTo(0.14, 6);
    expect(cost.totalUsd).toBeCloseTo(0.28, 6);
    expect(cost.perVariant.filter((p) => p.usd > 0)).toHaveLength(2);
  });

  it("free engines cost nothing; LibTV is reported in credits", () => {
    const m = buildBatchMatrix({ source: runSource, dims: { hooks: ["H20"] }, design: "full", maxVariants: 5 });
    expect(estimateBatchCost(m.variants, { imageModel: "GLM CogView-3-Flash", videoModel: "GLM CogVideoX-Flash", hookSec: 3 }).totalUsd).toBe(0);
    const libtv = estimateBatchCost(m.variants, { imageModel: "Seedream 4.0", videoModel: "Hailuo 2.3 Fast", hookSec: 3 });
    expect(libtv.unit).toBe("libtv-credits");
    expect(libtv.totalCredits).toBeGreaterThan(0);
    expect(libtv.totalUsd).toBeNull();
  });
});

describe("renderParamsFor", () => {
  const frames = [
    { frameNumber: 1, startSec: 0, endSec: 2, segment: "HOOK" },
    { frameNumber: 2, startSec: 2, endSec: 18, segment: "BODY" },
    { frameNumber: 3, startSec: 18, endSec: 20, segment: "CTA", endCard: { id: "E04", data: { price: 499, comparePrice: 699 } } },
  ];

  it("maps a variant to the re-edit inputs (aspect, cutdown, voice, mood, end card + button)", () => {
    const m = buildBatchMatrix({ source: runSource, dims: { hooks: ["c"], endCards: ["E01"], ctas: ["Get yours"], aspects: ["4:5"], durations: [15], voices: ["en-US-JennyNeural"], musicMoods: ["holiday"] }, design: "full", maxVariants: 5 });
    const p = renderParamsFor(m.variants[0], { masterAspect: "9:16", masterDurationSec: 20, masterHookStyle: "q" }, frames);
    expect(p).toMatchObject({ hookStyle: "c", outputAspect: "4:5", cutdownSec: 15, voice: "en-US-JennyNeural", musicMood: "holiday", ctaText: "Get yours" });
    const end = p.frames.find((f) => f.endCard)!;
    expect(end.endCard).toEqual({ id: "E01", data: { price: 499, comparePrice: 699, button: "Get yours" } });
    expect(frames[2].endCard!.id).toBe("E04"); // input untouched
  });

  it("the master's own aspect/length means no re-layout and no cutdown; the master hook keeps its style", () => {
    const m = buildBatchMatrix({ source: runSource, dims: { hooks: ["H10"], aspects: ["9:16"], durations: [20] }, design: "full", maxVariants: 5 });
    const p = renderParamsFor(m.variants[0], { masterAspect: "9:16", masterDurationSec: 20, masterHookStyle: "q" }, frames);
    expect(p.outputAspect).toBeUndefined();
    expect(p.cutdownSec).toBeUndefined();
    expect(p.hookStyle).toBe("q");
    expect(p.hookText).toBe("Brighter than the sun");
  });

  it("puts the end card on the last CTA frame when the master had none", () => {
    const plain = frames.map((f) => ({ ...f, endCard: undefined }));
    const m = buildBatchMatrix({ source: { ...runSource, endCardId: null }, dims: { endCards: ["E09"] }, design: "full", maxVariants: 5 });
    const p = renderParamsFor(m.variants[0], { masterAspect: "9:16", masterDurationSec: 20, masterHookStyle: "q" }, plain);
    expect((p.frames[2] as { endCard?: { id: string } }).endCard?.id).toBe("E09");
  });

  it("refuses a variant that needs a new hook clip", () => {
    const m = buildBatchMatrix({ source: runSource, dims: { hooks: ["H20"] }, design: "full", maxVariants: 5 });
    expect(() => renderParamsFor(m.variants[0], { masterAspect: "9:16", masterDurationSec: 20, masterHookStyle: "q" }, frames)).toThrow(/new hook clip/);
  });
});

describe("claimableVariants", () => {
  it("picks planned and stale pending re-edits only, in order, up to the limit", () => {
    const m = buildBatchMatrix({ source: runSource, dims: { hooks: ["q", "c", "H20"], aspects: ["9:16", "4:5"] }, design: "full", maxVariants: 20 });
    const now = Date.parse("2026-10-06T12:00:00Z");
    const vs = m.variants.map((v) => ({ ...v }));
    const free = vs.filter((v) => !v.needsGeneration);
    free[0].status = "rendered";
    free[1].status = "pending";
    free[1].pendingAt = "2026-10-06T11:59:00Z"; // fresh claim
    free[2].status = "pending";
    free[2].pendingAt = "2026-10-06T11:00:00Z"; // stale claim
    expect(claimableVariants(vs, 10, now).map((v) => v.id)).toEqual([free[2].id, free[3].id]);
    expect(claimableVariants(vs, 1, now)).toHaveLength(1);
    expect(claimableVariants(vs, 10, now).some((v) => v.needsGeneration)).toBe(false);
  });
});
