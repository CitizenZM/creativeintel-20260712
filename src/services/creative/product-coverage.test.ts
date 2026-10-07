import { describe, expect, it } from "vitest";
import { hasProductFraming, PRODUCT_FRAMING_MIN, validateProductCoverage, type CoverageFrame } from "./product-coverage";

const P = "NXTPAPER 14";
const f = (n: number, t0: number, t1: number, refs: CoverageFrame["locked"]["refs"], imagePrompt: string, segment = "BODY"): CoverageFrame => ({
  frameNumber: n,
  startSec: t0,
  endSec: t1,
  segment,
  imagePrompt,
  videoPrompt: "Natural, unhurried movement.",
  locked: { engine: "veo", refs },
});
const framed = (s: string) => `${s} The ${P} from image 1 is the main subject, centered, filling at least 40% of the frame.`;

describe("validateProductCoverage", () => {
  it("passes a storyboard that shows the product early, often and as the CTA hero", () => {
    const frames = [
      f(1, 0, 2, "cast+product", `Hands unwrap the ${P} from image 1.`, "HOOK"),
      f(2, 2, 6, "product", framed(`Close-up of the ${P} from image 1 in sunlight.`)),
      f(3, 6, 8, "cast", "A woman laughs on the sofa."),
      f(4, 8, 10, "product", framed(`Hero shot of the ${P} from image 1 on an oak table.`), "CTA"),
    ];
    const out = validateProductCoverage(frames, { productName: P });
    expect(out.issues).toEqual([]);
    expect(out.coverage).toBeCloseTo(0.8);
    expect(out.firstProductSec).toBe(0);
    expect(out.appearances).toBe(3);
  });

  it("flags a late first appearance and fixes frame 1 to carry the product", () => {
    const frames = [f(1, 0, 2, "cast", "A woman wakes up.", "HOOK"), f(2, 2, 4, "product", framed(`The ${P} from image 1 on a desk.`)), f(3, 4, 5, "product", framed(`Hero shot of the ${P} from image 1.`), "CTA")];
    const out = validateProductCoverage(frames, { productName: P });
    expect(out.issues.find((i) => i.code === "late_first_product")).toMatchObject({ fixed: true, frameNumber: 1 });
    expect(out.frames[0].locked.refs).toBe("cast+product");
    expect(out.frames[0].imagePrompt).toMatch(/NXTPAPER 14 from image 1/);
    expect(out.firstProductSec).toBe(0);
    // the input is not mutated
    expect(frames[0].locked.refs).toBe("cast");
  });

  it("raises coverage to ≥ 60 % by adding the product to the longest product-less frames", () => {
    const frames = [
      f(1, 0, 1, "product", framed(`The ${P} from image 1.`), "HOOK"),
      f(2, 1, 5, "cast", "Kids play in the garden."),
      f(3, 5, 9, "none", "A sunset over the city."),
      f(4, 9, 10, "product", framed(`Hero shot of the ${P} from image 1.`), "CTA"),
    ];
    const out = validateProductCoverage(frames, { productName: P });
    expect(out.issues.find((i) => i.code === "low_coverage")).toMatchObject({ fixed: true });
    expect(out.coverage).toBeGreaterThanOrEqual(0.6);
    expect(out.frames[1].locked.refs).toBe("cast+product");
  });

  it("requires at least two appearances", () => {
    const frames = [f(1, 0, 8, "product", framed(`Hero shot of the ${P} from image 1.`), "CTA")];
    const out = validateProductCoverage(frames, { productName: P });
    expect(out.issues.find((i) => i.code === "too_few_appearances")).toMatchObject({ fixed: false });
  });

  it("turns a CTA frame that is not a product hero into one", () => {
    const frames = [f(1, 0, 4, "product", framed(`The ${P} from image 1.`), "HOOK"), f(2, 4, 6, "cast+product", `A family waves goodbye holding the ${P} from image 1.`, "CTA")];
    const out = validateProductCoverage(frames, { productName: P });
    expect(out.issues.find((i) => i.code === "cta_not_hero")).toMatchObject({ fixed: true, frameNumber: 2 });
    expect(out.frames[1].locked.refs).toBe("product");
    expect(out.frames[1].imagePrompt).toMatch(/^Hero shot of the NXTPAPER 14 from image 1/);
    expect(hasProductFraming(out.frames[1].imagePrompt ?? "")).toBe(true);
  });

  it("rewrites product-shot prompts so the product is the centred main subject at ≥ 40 % of the frame, and keeps the camera on it", () => {
    const frames = [f(1, 0, 2, "product", `The ${P} from image 1 leans against a lamp in the corner.`, "HOOK"), f(2, 2, 4, "product", framed(`Hero shot of the ${P} from image 1.`), "CTA")];
    const out = validateProductCoverage(frames, { productName: P });
    expect(out.issues.find((i) => i.code === "weak_product_framing")).toMatchObject({ fixed: true, frameNumber: 1 });
    expect(hasProductFraming(out.frames[0].imagePrompt ?? "")).toBe(true);
    expect(out.frames[0].videoPrompt).toMatch(/centered and fully in frame/);
    expect(PRODUCT_FRAMING_MIN).toBe(0.4);
  });

  it("reports without fixing when fix=false", () => {
    const frames = [f(1, 0, 2, "cast", "A woman wakes up.", "HOOK"), f(2, 2, 4, "product", `The ${P} from image 1.`, "CTA")];
    const out = validateProductCoverage(frames, { productName: P, fix: false });
    expect(out.issues.every((i) => !i.fixed)).toBe(true);
    expect(out.frames[0].locked.refs).toBe("cast");
  });

  it("is idempotent: a fixed storyboard validates clean and is not rewritten again", () => {
    const frames = [f(1, 0, 2, "cast", "A woman wakes up.", "HOOK"), f(2, 2, 6, "product", `The ${P} from image 1 on a lamp.`), f(3, 6, 8, "cast+product", `Waving with the ${P} from image 1.`, "CTA")];
    const once = validateProductCoverage(frames, { productName: P });
    const twice = validateProductCoverage(once.frames, { productName: P });
    expect(twice.issues).toEqual([]);
    expect(twice.frames.map((x) => [x.imagePrompt, x.videoPrompt])).toEqual(once.frames.map((x) => [x.imagePrompt, x.videoPrompt]));
  });

  it("never rewrites a presenter talk frame (its prompts are the lip-synced line), but counts it when it holds the product", () => {
    const talk = (n: number, t0: number, t1: number, holds: boolean): CoverageFrame => ({
      ...f(n, t0, t1, holds ? "cast+product" : "cast", holds ? `The person from image 1 holds the ${P} from image 2.` : "The person from image 1 talks to camera.", "HOOK"),
      locked: { engine: "veo", refs: holds ? "cast+product" : "cast", talk: { line: "Okay, I did not expect this.", persona: "p1" } },
    });
    const frames = [talk(1, 0, 2, false), f(2, 2, 3, "cast", "A woman laughs."), talk(3, 3, 6, true), f(4, 6, 8, "product", framed(`Hero shot of the ${P} from image 1.`), "CTA")];
    const out = validateProductCoverage(frames, { productName: P });
    expect(out.frames[0]).toEqual(frames[0]);
    expect(out.frames[2].imagePrompt).toBe(frames[2].imagePrompt);
    expect(out.issues.find((i) => i.code === "late_first_product")).toMatchObject({ frameNumber: 1, fixed: false });
    expect(out.appearances).toBeGreaterThanOrEqual(2);
  });

  it("detects framing wording", () => {
    expect(hasProductFraming("the tablet is the main subject, centred, filling 45% of the frame")).toBe(true);
    expect(hasProductFraming("the tablet, centered")).toBe(false);
  });
});
