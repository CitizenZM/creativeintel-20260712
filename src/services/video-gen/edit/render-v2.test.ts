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

import { shotFilter, shotReframe } from "./render-v2";
import type { Shot } from "./edit-plan";

describe("product reframe in the shot filter", () => {
  const canvas = { w: 1080, h: 1920 };
  const shot = (extra: Partial<Shot> = {}): Shot => ({
    index: 0, kind: "clip", url: "u", srcFrom: 0.5, startSec: 0, endSec: 1, frames: 30, zoom: 1.2, anchorY: 0.4, motion: "none", frameNumber: 1, segment: "BODY", speed: 1, ...extra,
  });

  it("without a product box the punch-in stays centred as before", () => {
    const f = shotFilter(shot(), canvas);
    expect(f).toContain("crop=1080:1920:(iw-1080)/2:(ih-1920)*0.4");
    expect(shotReframe(shot(), canvas)).toBeNull();
  });

  it("centres the crop on the product and moves it from the start box to the end box over the frame's source window", () => {
    const s = shot({ productBox: { start: [0.6, 0.6, 0.9, 0.88], end: [0.55, 0.5, 0.85, 0.8], present: true }, frameSrc: { from: 0, span: 2 } });
    const r = shotReframe(s, canvas)!;
    expect(r.zoom).toBeGreaterThan(1.2);
    const f = shotFilter(s, canvas);
    expect(f).toContain(`scale=${Math.round((1080 * r.zoom) / 2) * 2}:`);
    expect(f).toMatch(/crop=1080:1920:x='min\(max\(\([\d.]+\+-?[\d.]+\*clip\(\(0\.500\+t\*1\.000\)\/2\.000,0,1\)\)\*iw-1080\/2,0\),iw-1080\)'/);
  });

  it("lands a zoom hit on the product where the reframe put it", () => {
    const s = shot({ productBox: { start: [0.6, 0.6, 0.9, 0.88], present: true }, zoomHit: { x: 0.75, y: 0.74 } });
    const f = shotFilter(s, canvas);
    const r = shotReframe(s, canvas)!;
    expect(f).toContain(`zoompan=z=`);
    expect(f).toContain(`x='min(max(${Math.min(1, Math.max(0, r.from.out.x))}*iw-iw/zoom/2`);
  });

  it("ignores a box the check marked absent", () => {
    expect(shotReframe(shot({ productBox: { start: [0.1, 0.1, 0.3, 0.3], present: false } }), canvas)).toBeNull();
  });
});

import { zoomHitFilter } from "./render-v2";

describe("zoomHitFilter", () => {
  it("pushes in toward its target with zoompan (scale(eval=frame)+crop always cropped the top-left corner)", () => {
    const f = zoomHitFilter("[zh]", { x: 0.57, y: 0.5 }, { w: 1080, h: 1920 });
    expect(f).toMatch(/^\[zh\]zoompan=z='\(1\+0\.6\*/);
    expect(f).toContain("x='min(max(0.57*iw-iw/zoom/2,0),iw-iw/zoom)'");
    expect(f).toContain("y='min(max(0.5*ih-ih/zoom/2,0),ih-ih/zoom)'");
    expect(f).toContain("s=1080x1920");
    expect(f).not.toContain("eval=frame");
  });
});
