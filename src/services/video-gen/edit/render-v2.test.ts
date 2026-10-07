import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { SAFE_BOX } from "@/services/creative/library";
import { brightnessAt, compareFilter, compareLabelSlots, fxFilter, musicMood, openerTrim, overlayX } from "./render-v2";
import { planEdit, type PlanInputSegment } from "./edit-plan";
import { layerFilter } from "./endcard-render";
import { comparisonLabelPng } from "./text-layers";

describe("musicMood", () => {
  it("picks the seasonal bed for holiday / gift copy", () => {
    expect(musicMood([{ text: "WANT A NEW YEAR GIFT?", voiceover: null }])).toBe("holiday");
    expect(musicMood([{ text: "4K at 144Hz", voiceover: "Silky motion for gaming" }])).toBe("pop");
  });
});

const seg = (n: number, segment: string, kind: "clip" | "still" = "clip"): PlanInputSegment => ({ kind, url: `u${n}`, from: 0, length: 2, frameNumber: n, segment, text: null });
const plan = planEdit([seg(1, "HOOK"), seg(2, "BODY"), seg(3, "BODY"), seg(4, "BODY"), seg(5, "CTA", "still"), seg(6, "CTA", "still")]);

describe("fxFilter — first frame and the CTA's last second", () => {
  it("never fades up from black: frame 1 is at full brightness", () => {
    expect(brightnessAt(plan, 0)).toBe(0);
    expect(brightnessAt(plan, 1 / 30)).toBe(0);
    expect(fxFilter(plan, { w: 1080, h: 1920 })).not.toMatch(/-0\.\d+\*exp\(-t/);
  });
  it("never darkens the CTA's last second", () => {
    for (let t = plan.durationSec - 1; t <= plan.durationSec; t += 1 / 30) expect(brightnessAt(plan, t)).toBeGreaterThanOrEqual(0);
  });
  it("keeps the drop flash", () => {
    expect(brightnessAt(plan, plan.dropSec)).toBeGreaterThan(0.2);
  });
});

describe("openerTrim", () => {
  it("keeps the opener when frame 1 is already bright", () => {
    expect(openerTrim([{ offset: 0, luma: 0.42 }, { offset: 0.1, luma: 0.5 }])).toBe(0);
  });
  it("trims 0.1–0.3 s into a dark opener to the first bright-enough frame, else the brightest", () => {
    expect(openerTrim([{ offset: 0, luma: 0.03 }, { offset: 0.1, luma: 0.12 }, { offset: 0.2, luma: 0.34 }, { offset: 0.3, luma: 0.4 }])).toBe(0.2);
    expect(openerTrim([{ offset: 0, luma: 0.03 }, { offset: 0.1, luma: 0.12 }, { offset: 0.2, luma: 0.18 }, { offset: 0.3, luma: 0.15 }])).toBe(0.2);
    expect(openerTrim([{ offset: 0, luma: 0.05 }, { offset: 0.1, luma: 0.04 }, { offset: 0.2, luma: 0.04 }, { offset: 0.3, luma: 0.05 }])).toBe(0);
  });
});

describe("overlay x in the safe box", () => {
  it("centres on the frame by default and on the safe box when given", () => {
    expect(overlayX(undefined)).toBe("(W-w)/2");
    expect(overlayX(502)).toBe("502-w/2");
    const f = layerFilter(7, "pop", 0.4, 12, 15, "[a]", "[b]", 502).join(";");
    expect(f).toContain("overlay=x=502-w/2");
    expect(layerFilter(7, "none", 0.4, 12, 15, "[a]", "[b]").join(";")).toContain("overlay=x=(W-w)/2");
  });
});

describe("comparison labels sit inside the safe box", () => {
  it("each label inside its half and inside y 288–1220 / x 240–840 on 9:16", async () => {
    const canvas = { w: 1080, h: 1920 };
    const slot = compareLabelSlots(canvas);
    for (const [text, ours] of [["NXTPAPER 14", true], ["GLOSSY TABLET", false], ["A VERY LONG COMPETITOR LABEL HERE", false]] as const) {
      const { width = 0, height = 0 } = await sharp(await comparisonLabelPng(text, canvas, undefined, ours)).metadata();
      const top = (ours ? slot.oursTop : slot.otherTop) * canvas.h;
      expect(top).toBeGreaterThanOrEqual(SAFE_BOX.top);
      expect(top + height).toBeLessThanOrEqual(ours ? SAFE_BOX.bottom : canvas.h / 2);
      if (ours) expect(top).toBeGreaterThanOrEqual(canvas.h / 2);
      expect((canvas.w - width) / 2).toBeGreaterThanOrEqual(SAFE_BOX.bodyBand.x0);
    }
    const f = compareFilter("[0:v]null[v]", canvas);
    expect(f).toContain(`y=H*${slot.otherTop}[l1]`);
    expect(f).toContain(`y=H*${slot.oursTop},format=yuv420p[v]`);
  }, 60_000);
});
