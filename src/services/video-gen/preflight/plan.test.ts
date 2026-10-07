import { describe, expect, it } from "vitest";
import { defaultPlatform, planFromEdit, planFromStoryboard } from "./plan";

const fr = (n: number, t0: number, t1: number, seg: string, extra: Record<string, unknown> = {}, locked: Record<string, unknown> = {}) => ({ frameNumber: n, startSec: t0, endSec: t1, segment: seg, textOverlay: "", voiceover: "", ...extra, locked: { engine: "kling", refs: "none", ...locked } });

describe("planFromStoryboard", () => {
  const frames = [
    fr(1, 0, 1, "HOOK", { textOverlay: "BLACK FRIDAY", voiceover: "Unwrap {NXTPAPER 14|Next Paper Fourteen} —" }, { engine: "kling" }),
    fr(2, 1, 2, "HOOK", { textOverlay: "NXTPAPER 14" }, { engine: "veo", refs: "product" }),
    fr(3, 2, 3.5, "BODY", { textOverlay: "NO GLARE" }, { engine: "local", localImage: "x.jpg", zoomHit: { x: 0.5, y: 0.4 } }),
    fr(4, 3.5, 5, "BODY", {}, { engine: "kling", refs: "cast" }),
    fr(5, 12, 15, "CTA", { textOverlay: "SHOP AT TCL.COM", voiceover: "Black Friday at TCL.com." }, { engine: "local" }),
  ];
  it("reads text, voiceover (first spoken alternative), product shots and the CTA from a locked script", () => {
    const p = planFromStoryboard(frames, { goal: "promo", brandName: "TCL" });
    expect(p.texts[0]).toEqual({ text: "BLACK FRIDAY", startSec: 0, endSec: 1, role: "hook" });
    expect(p.voiceover[0].text).toBe("Unwrap NXTPAPER 14 —");
    expect(p.productShots).toEqual([
      { startSec: 1, endSec: 2 },
      { startSec: 2, endSec: 3.5 },
      { startSec: 12, endSec: 15 },
    ]);
    expect(p.ctaSec).toBe(12);
    expect(p.texts.at(-1)!.role).toBe("cta");
    expect(p.layers).toBeNull();
  });
});

describe("planFromEdit", () => {
  it("maps the edit plan's cards, shots and CTA", () => {
    const plan = {
      durationSec: 15,
      ctaSec: 12,
      cards: [
        { text: "BLACK FRIDAY", startSec: 0, endSec: 1.2, role: "hook" as const },
        { text: "6,000 NITS", startSec: 4, endSec: 5, role: "claim" as const },
      ],
      shots: [
        { startSec: 0, endSec: 1, segment: "HOOK" as const, kind: "clip" as const, zoomHit: null },
        { startSec: 4, endSec: 5, segment: "BODY" as const, kind: "clip" as const, zoomHit: { x: 0.5, y: 0.3 } },
        { startSec: 12, endSec: 15, segment: "CTA" as const, kind: "still" as const, zoomHit: null },
      ],
      ctaButton: { text: "Shop now", startSec: 14 },
    };
    const p = planFromEdit(plan, [{ startSec: 0, endSec: 2, voiceover: "Black Friday:" }], { captionCoverage: 0.95, goal: "promo" });
    expect(p.texts.map((t) => t.role)).toEqual(["hook", "claim", "cta"]);
    expect(p.productShots).toEqual([
      { startSec: 4, endSec: 5 },
      { startSec: 12, endSec: 15 },
    ]);
    expect(p.voiceover).toEqual([{ text: "Black Friday:", startSec: 0, endSec: 2 }]);
    expect(p.captionCoverage).toBe(0.95);
  });
});

describe("defaultPlatform", () => {
  it("maps the master's aspect to its home placement", () => {
    expect(defaultPlatform("9:16")).toBe("tiktok");
    expect(defaultPlatform("4:5")).toBe("meta_feed");
    expect(defaultPlatform("16:9")).toBe("youtube_instream_skippable");
  });
});
