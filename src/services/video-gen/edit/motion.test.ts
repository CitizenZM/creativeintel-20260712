import { describe, expect, it } from "vitest";
import { bestWindow } from "./motion";

describe("bestWindow", () => {
  it("finds the most dynamic second, keeps the earliest on ties, falls back without motion", () => {
    // 10 fps, 4 s clip: idle first 2 s, action in 2.5–3.5 s
    const s = Array.from({ length: 40 }, (_, i) => (i >= 25 && i < 35 ? 0.2 : 0.01));
    expect(bestWindow(s, 10, 1, 4)).toBe(2.5);
    expect(bestWindow(Array(40).fill(0.05), 10, 1, 4)).toBe(0);
    expect(bestWindow(Array(40).fill(0), 10, 1, 4, 1.5)).toBe(1.5);
    expect(bestWindow([0.3, 0.3], 10, 1, 4, 0.7)).toBe(0.7);
  });
});

import { productReframe, reframeTrack, REFRAME } from "./motion";

describe("productReframe", () => {
  const v = 9 / 16;
  it("leaves a centred, big product alone (zoom stays at the shot's own)", () => {
    const r = productReframe([0.2, 0.25, 0.8, 0.75], { canvasAspect: v });
    expect(r.zoom).toBe(1);
    expect(r.out.x).toBeCloseTo(0.5, 2);
    expect(r.productH).toBeCloseTo(0.5, 2);
  });

  it("pushes in on a small product in the lower-right corner until it sits centred at ≥ 35 % of the height", () => {
    // the first live run, 12.5 s: a blank tablet in the lower right
    const r = productReframe([0.6, 0.6, 0.9, 0.88], { canvasAspect: v });
    expect(r.productH).toBeGreaterThanOrEqual(REFRAME.minHeight - 1e-6);
    expect(Math.abs(r.out.x - 0.5)).toBeLessThanOrEqual(REFRAME.tolerance + 1e-6);
    expect(Math.abs(r.out.y - 0.5)).toBeLessThanOrEqual(REFRAME.tolerance + 1e-6);
    expect(r.zoom).toBeLessThanOrEqual(REFRAME.maxZoom);
  });

  it("never zooms past the cap or crops the product", () => {
    const tiny = productReframe([0.95, 0.95, 0.99, 0.99], { canvasAspect: v });
    expect(tiny.zoom).toBe(REFRAME.maxZoom);
    const huge = productReframe([0.05, 0.05, 0.95, 0.95], { canvasAspect: v, baseZoom: 1.3 });
    expect(huge.productH).toBeLessThanOrEqual(REFRAME.maxHeight + 1e-6);
    expect(huge.zoom).toBeGreaterThanOrEqual(1);
  });

  it("works for a landscape source in a vertical canvas (more horizontal room)", () => {
    const r = productReframe([0.7, 0.3, 0.9, 0.7], { canvasAspect: v, srcAspect: 16 / 9 });
    expect(Math.abs(r.out.x - 0.5)).toBeLessThanOrEqual(REFRAME.tolerance + 1e-6);
  });
});

describe("reframeTrack", () => {
  it("holds one zoom across the clip and moves the crop from the start box to the end box", () => {
    const t = reframeTrack({ start: [0.55, 0.55, 0.85, 0.85], end: [0.15, 0.5, 0.45, 0.8] }, { canvasAspect: 9 / 16 })!;
    expect(t.from.cx).toBeGreaterThan(t.to.cx);
    const a = productReframe([0.55, 0.55, 0.85, 0.85], { canvasAspect: 9 / 16 });
    expect(t.zoom).toBeGreaterThanOrEqual(a.zoom - 1e-9);
  });
  it("is null without a usable box, or when the check says the product is absent", () => {
    expect(reframeTrack(null, { canvasAspect: 1 })).toBeNull();
    expect(reframeTrack({ start: null, end: null }, { canvasAspect: 1 })).toBeNull();
    expect(reframeTrack({ start: [0.1, 0.1, 0.4, 0.4], present: false }, { canvasAspect: 1 })).toBeNull();
  });
});
