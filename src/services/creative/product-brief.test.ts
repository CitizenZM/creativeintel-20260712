import { describe, expect, it } from "vitest";
import { CATEGORY_PACKS } from "./category-packs.data";
import { buildBriefPrompts, classifyProduct, finalizeBrief, rankSellingPoints, stratifyReviews, stripComplianceTraps, TO_CREATIVE_CATEGORY } from "./product-brief";

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
  const points = () =>
    [
      sp("a", { scores: { buyerImportance: 1, evidenceStrength: 1, differentiation: 1, visualizability: 1, emotionalPull: 1 } }),
      sp("b", { compliance: { claimType: "health_safety", riskLevel: "blocked", safeWording: "" } }),
      sp("c", { proofVisual: { device: "other", shot: "  ", durationSec: 2 } }),
      sp("d", { compliance: { claimType: "performance", riskLevel: "high", safeWording: "x" }, sourceEvidence: [{ type: "review", quote: "y" }] }),
      sp("e"),
    ] as never;

  it("strict: recomputes priority from sub-scores, drops blocked and unfilmable claims, discounts unsubstantiated high risk", () => {
    const ranked = rankSellingPoints(points(), 8, { strictCompliance: true });
    expect(ranked.map((p) => p.id)).toEqual(["a", "e", "d"]);
    expect(ranked[0]).toMatchObject({ priority: 1, priorityScore: 1 });
    expect(ranked[2].priorityScore).toBeCloseTo(ranked[1].priorityScore * 0.6, 3);
  });

  it("default: ranks on persuasion only — keeps 'blocked' claims, no risk discount; unfilmable still dropped", () => {
    const ranked = rankSellingPoints(points());
    expect(ranked.map((p) => p.id).sort()).toEqual(["a", "b", "d", "e"]);
    expect(ranked[0].id).toBe("a");
    const e = ranked.find((p) => p.id === "e")!;
    const d = ranked.find((p) => p.id === "d")!;
    expect(d.priorityScore).toBeCloseTo(e.priorityScore, 3);
  });
});

describe("finalizeBrief", () => {
  const raw = () => ({
    category: "other",
    bigIdea: { proposition: "Bright enough for noon" },
    sellingPoints: [sp("sp1"), sp("sp2", { compliance: { claimType: "comparative", riskLevel: "blocked", safeWording: "" } })],
    beatMap: { durationSec: 15, beats: [{ t: "0-3", purpose: "hook", sellingPointId: "sp1", visual: "glare split" }, { t: "3-6", purpose: "proof", sellingPointId: "sp2", visual: "x" }] },
  });

  it("strict: accepts a partial model answer, keeps the guessed category when the model says other, and prunes beats of dropped points", () => {
    const b = finalizeBrief(raw(), "tv", { strictCompliance: true });
    expect(b.category).toBe("tv");
    expect(b.sellingPoints.map((p) => p.id)).toEqual(["sp1"]);
    expect(b.beatMap.beats.map((x) => x.sellingPointId)).toEqual(["sp1"]);
    expect(b.keywords).toEqual([]);
  });

  it("default: keeps every filmable point and its beats; parses briefs with no compliance fields", () => {
    const b = finalizeBrief(raw(), "tv");
    expect(b.sellingPoints.map((p) => p.id).sort()).toEqual(["sp1", "sp2"]);
    expect(b.beatMap.beats.map((x) => x.sellingPointId)).toEqual(["sp1", "sp2"]);
    const bare = finalizeBrief({ category: "tv", sellingPoints: [{ id: "x", claim: "3,000 nits", benefit: "bright at noon", proofVisual: { shot: "sun-glare split" } }] });
    expect(bare.sellingPoints).toHaveLength(1);
    expect(bare.complianceNotes).toEqual([]);
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

  it("default prompt spends no tokens on compliance; strict restores the legal layer", () => {
    const input = { title: "Levoit Core 300 True HEPA Air Purifier" };
    const open = buildBriefPrompts(input).system;
    expect(open).not.toMatch(/Compliance traps|CROSS-CATEGORY|riskLevel|safeWording|FIFRA/);
    expect(open).toMatch(/Sell hard/);
    const strict = buildBriefPrompts(input, { strictCompliance: true }).system;
    expect(strict).toMatch(/Compliance traps/);
    expect(strict).toMatch(/CROSS-CATEGORY RULES/);
    expect(strict).toMatch(/safeWording/);
    expect(open.length).toBeLessThan(strict.length * 0.7);
    for (const [k, pack] of Object.entries(CATEGORY_PACKS)) {
      if (k === "compliance_all") continue;
      const s = stripComplianceTraps(pack);
      expect(s).not.toMatch(/Compliance traps/);
      expect(s).toMatch(/Drivers/);
    }
  });
});
