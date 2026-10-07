import { describe, expect, it } from "vitest";
import { chooseBadge, clampWords, deriveCopy, formatDeadline, missingFacts, pctFrom, promoFrom } from "./copy";
import { templateById } from "./templates";

const brief = {
  product: { name: "TCL NXTPAPER 14 Tablet", brand: "TCL", model: "NXTPAPER 14" },
  bigIdea: { proposition: "A full A4 page with zero glare", alternates: ["Reads like paper, all day long"] },
  sellingPoints: [
    { claim: "14.3-inch NXTPAPER display shows a full A4 page", benefit: "Read sheet music without zooming", proofVisual: { shot: "x", overlayText: "Full A4 page" } },
    { claim: "Anti-glare matte screen", benefit: "No reflections by the window", proofVisual: { shot: "x", overlayText: "No glare" } },
    { claim: "10,000 mAh battery lasts all day long for school and work", benefit: "All-day battery", proofVisual: { shot: "x" } },
    { claim: "Ink Paper mode", benefit: "", proofVisual: { shot: "x", overlayText: "One-key Ink Paper" } },
  ],
  competitorGaps: [{ gap: "Glossy tablets glare", evidence: "", ourProof: "" }],
};

describe("pctFrom / chooseBadge", () => {
  it("derives the discount from the compare-at price", () => {
    expect(pctFrom({ price: 349.97, comparePrice: 469.99 })).toBe(26);
    expect(pctFrom({ pct: 30, price: 1, comparePrice: 2 })).toBe(30);
    expect(pctFrom({ price: 500, comparePrice: 400 })).toBeNull();
  });
  it("draws only the badges whose facts exist, in the template's order", () => {
    const promo = { price: 349.97, comparePrice: 469.99, code: "TCL10" };
    expect(chooseBadge(["burst", "strike"], promo)?.kind).toBe("burst");
    expect(chooseBadge(["strike", "burst"], promo)).toMatchObject({ kind: "strike", price: 349.97, comparePrice: 469.99 });
    expect(chooseBadge(["coupon"], promo)).toMatchObject({ kind: "coupon", code: "TCL10" });
    expect(chooseBadge(["coupon"], { pct: 20 })).toBeNull();
    expect(chooseBadge(["burst", "strike", "coupon"], {})).toBeNull();
  });
});

describe("deriveCopy", () => {
  it("takes the headline from the big idea, the sub and bullets from the ranked selling points", () => {
    const c = deriveCopy({ brief, brandName: "TCL", promo: { price: 349.97, comparePrice: 469.99, label: "Black Friday" } });
    expect(c.headline).toBe("A full A4 page with zero glare");
    expect(c.sub).toBe("Full A4 page");
    expect(c.bullets).toEqual(["Full A4 page", "No glare", "10,000 mAh battery lasts all day", "One-key Ink Paper"]);
    expect(c.offerHeadline).toBe("Black Friday");
    expect(c.cta).toBe("Shop now");
    expect(c.afterLabel).toBe("NXTPAPER 14");
    expect(c.rating).toBeNull();
  });
  it("prefers the campaign plan's end card and hook copy", () => {
    const plan = {
      platforms: [
        {
          hookVariants: [{ openingText: "Your tablet, but paper" }],
          endCard: { id: "E04", button: "Grab the deal", headline: "Black Friday deal", data: { pct: 40 } },
        },
      ],
    };
    const c = deriveCopy({ brief, plan, brandName: "TCL", promo: {} });
    expect(c.cta).toBe("Grab the deal");
    expect(c.offerHeadline).toBe("Black Friday deal");
    // The plan's end-card facts back-fill the promo; the badge itself is picked per template.
    expect(promoFrom({}, plan)).toMatchObject({ pct: 40 });
    expect(promoFrom({ pct: 25 }, plan)).toMatchObject({ pct: 25 });
  });
  it("keeps real proof only", () => {
    const c = deriveCopy({ brief, brandName: "TCL", promo: {}, proof: { rating: 4.6, reviewCount: 1240, quote: "Reads like paper." } });
    expect(c.rating).toEqual({ value: 4.6, count: 1240 });
    expect(c.quote).toEqual({ text: "Reads like paper.", author: "Verified buyer" });
  });
});

describe("missingFacts", () => {
  it("skips the testimonial without a rating and the offer card without an offer", () => {
    const c = deriveCopy({ brief, brandName: "TCL", promo: {} });
    expect(missingFacts(templateById("testimonial-rating"), c, {})).toEqual(["rating"]);
    expect(missingFacts(templateById("offer-burst"), c, {})).toEqual(["offer"]);
    expect(missingFacts(templateById("offer-burst"), c, { pct: 20 })).toEqual([]);
    expect(missingFacts(templateById("hero-product"), c, {})).toEqual([]);
  });
});

describe("helpers", () => {
  it("clamps long copy on a word boundary", () => {
    expect(clampWords("Ten thousand mAh battery lasts all day long for school", 6)).toBe("Ten thousand mAh battery lasts all");
  });
  it("formats a deadline", () => {
    expect(formatDeadline("2026-11-30T23:59:00Z")).toBe("Ends Nov 30");
    expect(formatDeadline("not a date")).toBeNull();
  });
});
