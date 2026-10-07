import { describe, expect, it } from "vitest";
import { buildBriefPrompts, classifyProduct, finalizeBrief, rankSellingPoints, stratifyReviews, TO_CREATIVE_CATEGORY } from "./product-brief";

const sp = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  claim: `claim ${id}`,
  advantage: "",
  benefit: `benefit ${id}`,
  proofVisual: { device: "split_screen", shot: `shot ${id}`, durationSec: 3 },
  sourceEvidence: [{ type: "spec", quote: "x" }],
  evidenceStrength: "measured_spec",
  driver: "",
  awarenessStage: "product_aware",
  competitorUsage: false,
  uniqueness: 0.5,
  scores: { buyerImportance: 0.5, evidenceStrength: 0.8, differentiation: 0.5, visualizability: 0.5, emotionalPull: 0.5 },
  priority: 9,
  compliance: { claimType: "objective_spec", riskLevel: "low", safeWording: "" },
  ...over,
});

describe("classifyProduct", () => {
  it("routes the brands in the book to their category packs", () => {
    expect(classifyProduct("TCL QM8L Series SQD-Mini LED 4K TV")).toBe("tv");
    expect(classifyProduct("TCL NXTPAPER 14 tablet with T-Pen stylus")).toBe("tablet_laptop");
    expect(classifyProduct("Levoit Core 300 True HEPA Air Purifier")).toBe("home_air_cleaning");
    expect(classifyProduct("COSORI Pro Air Fryer 5.8 QT")).toBe("kitchen_appliance");
    expect(classifyProduct("Insta360 X4 8K 360 action camera")).toBe("camera_creator");
    expect(classifyProduct("Ottocast wireless CarPlay adapter")).toBe("auto_accessories");
    expect(classifyProduct("Gold vermeil pendant necklace")).toBe("fashion_jewelry");
    expect(TO_CREATIVE_CATEGORY.tv).toBe("electronics");
  });
});

describe("rankSellingPoints", () => {
  it("recomputes priority from sub-scores, drops blocked and unfilmable claims, discounts unsubstantiated high risk", () => {
    const ranked = rankSellingPoints([
      sp("a", { scores: { buyerImportance: 1, evidenceStrength: 1, differentiation: 1, visualizability: 1, emotionalPull: 1 } }),
      sp("b", { compliance: { claimType: "health_safety", riskLevel: "blocked", safeWording: "" } }),
      sp("c", { proofVisual: { device: "other", shot: "  ", durationSec: 2 } }),
      sp("d", { compliance: { claimType: "performance", riskLevel: "high", safeWording: "x" }, sourceEvidence: [{ type: "review", quote: "y" }] }),
      sp("e"),
    ] as never);
    expect(ranked.map((p) => p.id)).toEqual(["a", "e", "d"]);
    expect(ranked[0]).toMatchObject({ priority: 1, priorityScore: 1 });
    expect(ranked[2].priorityScore).toBeCloseTo(ranked[1].priorityScore * 0.6, 3);
  });
});

describe("finalizeBrief", () => {
  it("accepts a partial model answer, keeps the guessed category when the model says other, and prunes beats of dropped points", () => {
    const b = finalizeBrief(
      {
        category: "other",
        bigIdea: { proposition: "Bright enough for noon" },
        sellingPoints: [sp("sp1"), sp("sp2", { compliance: { claimType: "comparative", riskLevel: "blocked", safeWording: "" } })],
        beatMap: { durationSec: 15, beats: [{ t: "0-3", purpose: "hook", sellingPointId: "sp1", visual: "glare split" }, { t: "3-6", purpose: "proof", sellingPointId: "sp2", visual: "x" }] },
      },
      "tv"
    );
    expect(b.category).toBe("tv");
    expect(b.sellingPoints.map((p) => p.id)).toEqual(["sp1"]);
    expect(b.beatMap.beats.map((x) => x.sellingPointId)).toEqual(["sp1"]);
    expect(b.keywords).toEqual([]);
  });
});

describe("buildBriefPrompts", () => {
  it("injects only the matching category pack and stratified reviews", () => {
    const { system, user, guessedCategory } = buildBriefPrompts({
      title: "Levoit Core 300 True HEPA Air Purifier",
      reviews: [
        ...Array.from({ length: 40 }, () => ({ stars: 5, text: "love it" })),
        { stars: 1, text: "loud on high" },
        { stars: 3, text: "ok filter cost" },
      ],
    });
    expect(guessedCategory).toBe("home_air_cleaning");
    expect(system).toMatch(/HEPA/);
    expect(system).not.toMatch(/2\.1 Consumer electronics — TVs/);
    expect(user).toContain("loud on high");
    expect(stratifyReviews([{ stars: 5, text: "a" }, { stars: 2, text: "b" }]).map((r) => r.stars)).toEqual([5, 2]);
  });
});
