import { describe, expect, it } from "vitest";
import type { PlatformPlan } from "./campaign-plan.types";
import { directPlanStoryboard, scaffoldLockedFrames } from "./plan-to-storyboard";

const plan = {
  platform: "tiktok",
  label: "TikTok",
  durationSec: 15,
  aspect: "9:16",
  audience: "",
  styleNotes: "",
  pacing: "",
  voice: "",
  captionStyle: "",
  musicMood: "holiday",
  hookVariants: [{ hookId: "H06", name: "Gift reveal", family: "reveal", durationSec: 2, openingVisual: "Hands tear red gift wrap to reveal the tablet", openingText: "Want a New Year gift?", openingVO: "Want a New Year gift?" }],
  endCard: { id: "E02", name: "Offer badge", button: "Claim Coupon", headline: "Black Friday", data: { pct: 20 } },
  endCardAlternates: [],
  beats: [],
  scripts: [
    {
      hookId: "H06",
      title: "Gift reveal",
      beats: [
        { t0: 0, t1: 2, purpose: "hook", visual: "Hands tear red gift wrap to reveal the tablet", onScreenText: "Want a New Year gift?", vo: "Want a New Year gift?" },
        { t0: 2, t1: 3, purpose: "pitch", visual: "The tablet held up to camera", onScreenText: "20% OFF Black Friday", vo: "Twenty percent off this Black Friday." },
        { t0: 3, t1: 7, purpose: "proof", sellingPointId: "sp1", visual: "Close-up of the matte screen in bright sunlight, no glare", vo: "A matte screen that reads like paper." },
        { t0: 7, t1: 10, purpose: "benefit", visual: "A mother sketches on the tablet with the stylus at the kitchen table", vo: "Draw, read, take notes." },
        { t0: 10, t1: 14, purpose: "offer", visual: "Product hero on an oak table with ribbon", onScreenText: "Ends Sunday" },
        { t0: 14, t1: 15, purpose: "cta", visual: "Logo and button", onScreenText: "Claim Coupon" },
      ],
    },
  ],
} as unknown as PlatformPlan;

describe("scaffoldLockedFrames", () => {
  const frames = scaffoldLockedFrames({ plan, productName: "NXTPAPER 14", cast: "a Latino mother in her 30s with shoulder-length dark hair, rust cardigan" });

  it("maps every beat to a timed locked frame covering the whole ad", () => {
    expect(frames.map((f) => [f.startSec, f.endSec])).toEqual([[0, 2], [2, 3], [3, 7], [7, 10], [10, 14], [14, 15]]);
    expect(frames.map((f) => f.segment)).toEqual(["HOOK", "HOOK", "BODY", "BODY", "BODY", "CTA"]);
    expect(frames.every((f, i) => f.frameNumber === i + 1)).toBe(true);
  });

  it("routes refs by subject: people + product → cast+product, product only → product", () => {
    expect(frames[0].locked.refs).toBe("cast+product"); // hands
    expect(frames[2].locked.refs).toBe("product");
    expect(frames[3].locked.refs).toBe("cast+product");
    expect(frames[0].locked.castLock).toContain("Latino mother");
    expect(frames.filter((f) => f.locked.castLock)).toHaveLength(1);
  });

  it("zooms land on the product, the CTA frame carries the end card and every clip is first+last anchored", () => {
    expect(frames[2].locked.zoomHit).toEqual({ x: 0.5, y: 0.5 });
    expect(frames[5].locked.endCard).toEqual({ id: "E02", data: { pct: 20, button: "Claim Coupon", headline: "Black Friday" } });
    expect(frames.every((f) => f.locked.anchorEnd === true && f.locked.engine === "veo")).toBe(true);
    expect(frames[1].textOverlay).toBe("20% OFF Black Friday");
    expect(frames[1].voiceover).toBe("Twenty percent off this Black Friday.");
  });

  it("falls back to usable prompts without a model", () => {
    expect(frames[2].imagePrompt).toMatch(/matte screen/);
    expect(frames[2].imagePrompt).toMatch(/NXTPAPER 14 from image 1/);
    expect(frames[2].videoPrompt).toMatch(/push-in/i);
  });
});

describe("directPlanStoryboard", () => {
  it("applies the model's prompts per frame and keeps timing/locks", async () => {
    const out = await directPlanStoryboard(
      { plan, productName: "NXTPAPER 14" },
      { llm: async () => ({ frames: [{ i: 3, imagePrompt: "Macro of the matte tablet in noon sun", videoPrompt: "Slow push-in toward the screen.", endState: "Screen fills the frame" }] }) }
    );
    expect(out.source).toBe("llm");
    expect(out.frames[2].imagePrompt).toBe("Macro of the matte tablet in noon sun");
    expect(out.frames[2].locked.endState).toBe("Screen fills the frame");
    expect(out.frames[2].startSec).toBe(3);
  });

  it("keeps the scaffold when the model fails", async () => {
    const out = await directPlanStoryboard({ plan, productName: "NXTPAPER 14" }, { llm: async () => { throw new Error("down"); } });
    expect(out.source).toBe("fallback");
    expect(out.frames).toHaveLength(6);
  });
});
