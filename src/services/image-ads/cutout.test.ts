import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { alphaBBox, borderStats, floodMask, productCutout } from "./cutout";

/** w×h RGB raw: a flat background with a solid square in the middle. */
function scene(w: number, h: number, bg: number[], fg: number[], sq: { x: number; y: number; s: number }) {
  const buf = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const inside = x >= sq.x && x < sq.x + sq.s && y >= sq.y && y < sq.y + sq.s;
      const c = inside ? fg : bg;
      buf.set(c, (y * w + x) * 3);
    }
  return buf;
}

describe("borderStats", () => {
  it("finds a flat white studio background", () => {
    const raw = scene(40, 30, [250, 250, 250], [20, 20, 20], { x: 10, y: 10, s: 10 });
    const s = borderStats(raw, 40, 30, 3);
    expect(s.flat).toBe(true);
    expect(s.color[0]).toBeGreaterThan(240);
  });
  it("rejects a busy photo border", () => {
    const raw = Buffer.alloc(40 * 30 * 3);
    for (let i = 0; i < raw.length; i++) raw[i] = (i * 7919) % 256;
    expect(borderStats(raw, 40, 30, 3).flat).toBe(false);
  });
});

describe("floodMask", () => {
  it("clears the background connected to the border and keeps the product, even where it matches the background", () => {
    // A dark product with a white "screen" inside: the inner white must survive (not connected to the border).
    const w = 30, h = 30;
    const raw = scene(w, h, [255, 255, 255], [10, 10, 10], { x: 5, y: 5, s: 20 });
    for (let y = 10; y < 20; y++) for (let x = 10; x < 20; x++) raw.set([255, 255, 255], (y * w + x) * 3);
    const m = floodMask(raw, w, h, 3, [255, 255, 255], 30);
    expect(m[0]).toBe(0); // corner: background
    expect(m[7 * w + 7]).toBe(255); // product body
    expect(m[15 * w + 15]).toBe(255); // enclosed white screen kept
  });
});

describe("alphaBBox", () => {
  it("bounds the opaque pixels", () => {
    const w = 20, h = 10;
    const raw = Buffer.alloc(w * h * 4);
    for (let y = 2; y < 6; y++) for (let x = 5; x < 9; x++) raw[(y * w + x) * 4 + 3] = 255;
    expect(alphaBBox(raw, w, h, 4)).toEqual({ x: 5, y: 2, w: 4, h: 4 });
  });
});

describe("productCutout", () => {
  it("trims a transparent packshot", async () => {
    const png = await sharp({ create: { width: 100, height: 80, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: { create: { width: 30, height: 20, channels: 4, background: { r: 200, g: 0, b: 0, alpha: 1 } } }, left: 40, top: 30 }])
      .png()
      .toBuffer();
    const r = await productCutout(png);
    expect(r.method).toBe("alpha");
    const m = await sharp(r.png).metadata();
    expect([m.width, m.height]).toEqual([30, 20]);
  });
  it("removes a flat white background", async () => {
    const raw = scene(60, 40, [252, 252, 252], [30, 60, 200], { x: 20, y: 10, s: 20 });
    const jpg = await sharp(raw, { raw: { width: 60, height: 40, channels: 3 } }).png().toBuffer();
    const r = await productCutout(jpg);
    expect(r.method).toBe("flood");
    const m = await sharp(r.png).metadata();
    expect(m.hasAlpha).toBe(true);
    expect(m.width).toBeLessThanOrEqual(24);
  });
  it("leaves a busy photo as is", async () => {
    const raw = Buffer.alloc(40 * 30 * 3);
    for (let i = 0; i < raw.length; i++) raw[i] = (i * 7919) % 256;
    const png = await sharp(raw, { raw: { width: 40, height: 30, channels: 3 } }).png().toBuffer();
    expect((await productCutout(png)).method).toBe("none");
  });
});
