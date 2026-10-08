import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { fitLayerPng, layoutBox, placeLayer, separateCaptions, textCanvas } from "./safe-layout";

const c = { w: 1080, h: 1920 };

describe("layoutBox", () => {
  it("is the whole frame without a platform (today's layout)", () => {
    expect(layoutBox(c)).toEqual({ left: 0, right: 1080, top: 0, bottom: 1920 });
  });
  it("keeps TikTok's right rail out (x ≤ 940 on 1080 wide)", () => {
    expect(layoutBox(c, "tiktok")).toEqual({ left: 64, right: 940, top: 160, bottom: 1440 });
  });
  it("scales the profile's safe zone to a smaller canvas and applies a tighter inset", () => {
    const b = layoutBox({ w: 540, h: 960 }, "tiktok", 0.02);
    expect(b.left).toBe(32 + 11);
    expect(b.right).toBe(470 - 11);
  });
});

describe("placeLayer", () => {
  const box = layoutBox(c, "tiktok");
  it("centres a layer in the safe box and shrinks one that is too wide", () => {
    const p = placeLayer({ w: 929, h: 200 }, 0.6, box, c);
    expect(p.scale).toBeCloseTo(876 / 929, 3);
    expect(p.cx).toBe(502);
    const w = 929 * p.scale;
    expect(p.cx - w / 2).toBeGreaterThanOrEqual(box.left - 0.5);
    expect(p.cx + w / 2).toBeLessThanOrEqual(box.right + 0.5);
  });
  it("leaves a fitting layer at its size and slot", () => {
    expect(placeLayer({ w: 600, h: 100 }, 0.5, box, c)).toEqual({ scale: 1, cx: 502, y: 0.5 });
  });
  it("moves a layer that would cross the bottom edge back inside", () => {
    const p = placeLayer({ w: 600, h: 300 }, 0.74, box, c);
    expect(p.y * c.h + 150).toBeLessThanOrEqual(box.bottom + 0.5);
  });
  it("is a no-op on the full-frame box (default behaviour unchanged)", () => {
    expect(placeLayer({ w: 929, h: 120 }, 0.6, layoutBox(c), c)).toEqual({ scale: 1, cx: 540, y: 0.6 });
  });
});

describe("textCanvas / fitLayerPng", () => {
  it("carries the safe width for the text renderers", () => {
    expect(textCanvas(c, layoutBox(c, "tiktok"))).toEqual({ w: 1080, h: 1920, safeW: 876 });
    expect(textCanvas(c, layoutBox(c))).toEqual({ w: 1080, h: 1920 });
  });
  it("resizes an oversized PNG to fit", async () => {
    const png = await sharp({ create: { width: 1000, height: 100, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
    const out = await fitLayerPng(png, 0.5, layoutBox(c, "tiktok"), c);
    const m = await sharp(out.png).metadata();
    expect(m.width).toBeLessThanOrEqual(876);
    expect(out.cx).toBe(502);
  });
});

describe("separateCaptions", () => {
  const box = layoutBox(c, "tiktok");
  it("moves a caption that would sit on a hook headline shown at the same time below it", () => {
    const out = separateCaptions(
      [
        { role: "hook", y: 0.52, h: 330, startSec: 0, endSec: 2 },
        { role: "caption", y: 0.6, h: 110, startSec: 0.2, endSec: 0.9 },
        { role: "caption", y: 0.6, h: 110, startSec: 2.5, endSec: 3 },
      ],
      c,
      box
    );
    const hookBottom = 0.52 * 1920 + 165;
    expect(out[1] * 1920 - 55).toBeGreaterThanOrEqual(hookBottom);
    expect(out[1] * 1920 + 55).toBeLessThanOrEqual(box.bottom);
    expect(out[2]).toBe(0.6);
    expect(out[0]).toBe(0.52);
  });
  it("puts it above the card when there is no room below", () => {
    const out = separateCaptions([{ role: "claim", y: 0.68, h: 200, startSec: 0, endSec: 2 }, { role: "caption", y: 0.7, h: 110, startSec: 0, endSec: 1 }], c, box);
    expect(out[1] * 1920 + 55).toBeLessThanOrEqual(0.68 * 1920 - 100);
  });
  it("lifts wrapped fine print off the CTA button", () => {
    const out = separateCaptions([{ role: "fine", y: 0.555, h: 120, startSec: 12, endSec: 15 }, { role: "cta", y: 0.603, h: 90, startSec: 14, endSec: 15 }], c, box);
    expect(out[0] * 1920 + 60).toBeLessThanOrEqual(0.603 * 1920 - 45);
    expect(out[1]).toBe(0.603);
  });
});

describe("caption clearance under a headline", () => {
  it("keeps ~3% of the frame clear between a headline and the caption below it", async () => {
    const { separateCaptions } = await import("./safe-layout");
    const canvas = { w: 1080, h: 1920 };
    const box = { left: 64, right: 940, top: 288, bottom: 1220 } as never;
    const [, cap] = separateCaptions(
      [
        { role: "claim", y: 0.5, h: 160, startSec: 0, endSec: 2 },
        { role: "caption", y: 0.55, h: 120, startSec: 0, endSec: 2 },
      ],
      canvas,
      box
    );
    const headlineBottom = 0.5 * 1920 + 80;
    const captionTop = cap * 1920 - 60;
    expect(captionTop - headlineBottom).toBeGreaterThanOrEqual(Math.round(1920 * 0.03) - 1);
  });
});
