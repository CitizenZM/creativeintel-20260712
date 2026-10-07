import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import {
  bezelWidth,
  compareProductPixels,
  cropBox,
  frameSimilarity,
  loadImage,
  normalizeContrast,
  prepareFrameCrop,
  prepareRefCrop,
  productPixelScore,
  ssim,
} from "./pixel-metrics";
import { deviceBox, deviceImage, type DeviceOpts } from "./test-images";

// sharp + ffmpeg work is CPU-bound and the full suite runs files in parallel.
vi.setConfig({ testTimeout: 60_000 });

const THIN: DeviceOpts = { bezel: 0.025 };
const crop = async (o: DeviceOpts) => prepareFrameCrop(await deviceImage(o, "jpeg"), deviceBox(o));
const ref = async () => prepareRefCrop(await deviceImage(THIN));

describe("pixel metrics on synthetic products", () => {
  it("scores the same product ~1 (JPEG round-trip, different resolution)", async () => {
    const r = await ref();
    const same = await compareProductPixels(await crop(THIN), r);
    const bigger = await compareProductPixels(await crop({ ...THIN, width: 1000, height: 750 }), r);
    expect(same.score).toBeGreaterThan(0.97);
    expect(bigger.score).toBeGreaterThan(0.97);
    expect(same.aspect.score).toBeCloseTo(1, 2);
    expect(same.structure.ssim).toBeGreaterThan(0.95);
    expect(same.structure.bezelScore).toBeGreaterThan(0.9);
  });

  it("drops the aspect score for a stretched body (the 'stick' class)", async () => {
    const m = await compareProductPixels(await crop({ ...THIN, bodyW: 0.9, bodyH: 0.35 }), await ref());
    expect(m.aspect.deviation).toBeGreaterThan(0.6);
    expect(m.aspect.score).toBeLessThan(0.2);
    expect(m.score).toBeLessThan(0.7);
  });

  it("scores a thick bezel lower on structure and measures the bezel width", async () => {
    const r = await ref();
    const thin = await compareProductPixels(await crop({ bezel: 0.015 }), r);
    const thick = await compareProductPixels(await crop({ bezel: 0.1 }), r);
    expect(thick.structure.score).toBeLessThan(thin.structure.score - 0.3);
    expect(thick.score).toBeLessThan(thin.score - 0.15);
    expect(thick.structure.bezelFrame!).toBeGreaterThan(0.07);
    expect(thick.structure.bezelFrame!).toBeLessThan(0.13);
    expect(thick.structure.bezelRef!).toBeLessThan(0.035);
    expect(thick.structure.bezelScore!).toBeLessThan(0.3);
  });

  it("raises the histogram distance on a colour shift, keeping the structure", async () => {
    const r = await ref();
    const same = await compareProductPixels(await crop(THIN), r);
    const shifted = await compareProductPixels(await crop({ ...THIN, sky: "#d94f3d", ground: "#9a3e8f", sun: "#30f2e0" }), r);
    expect(shifted.histogram.distance).toBeGreaterThan(same.histogram.distance + 0.4);
    expect(shifted.structure.edgeSsim).toBeGreaterThan(0.85);
    expect(shifted.aspect.score).toBeCloseTo(1, 2);
  });

  it("is orientation-invariant on the aspect ratio (a tablet held in portrait)", async () => {
    const land = await deviceImage(THIN);
    const portrait = await sharp(land).rotate(90).png().toBuffer();
    const m = await compareProductPixels({ tight: await cropBox(portrait, [0.2, 0.15, 0.8, 0.85]) }, { tight: await cropBox(land, deviceBox(THIN)) });
    expect(m.aspect.rotated).toBe(true);
    expect(m.aspect.score).toBeGreaterThan(0.95);
    expect(m.score).toBeGreaterThan(0.9);
  });

  it("productPixelScore picks the best-matching reference of a golden set", async () => {
    const frame = await deviceImage({ bezel: 0.1 });
    const best = await productPixelScore(frame, deviceBox({ bezel: 0.1 }), [{ image: await deviceImage(THIN) }, { image: await deviceImage({ bezel: 0.1 }) }]);
    expect(best!.refIndex).toBe(1);
    expect(best!.score).toBeGreaterThan(0.95);
  });

  it("SSIM is 1 for identical and lower for different images; bezelWidth null without an inner edge", () => {
    const n = 32;
    const a = normalizeContrast(Float64Array.from({ length: n * n }, (_, i) => (i % n) * 8));
    const b = normalizeContrast(Float64Array.from({ length: n * n }, (_, i) => Math.floor(i / n) * 8));
    expect(ssim(a, a, n, n)).toBeCloseTo(1, 5);
    expect(ssim(a, b, n, n)).toBeLessThan(0.5);
    expect(bezelWidth(new Float64Array(64 * 64).fill(128), 64, 64)).toBeNull();
  });

  it("loads data URLs and compares whole frames", async () => {
    const png = await deviceImage(THIN);
    const url = `data:image/png;base64,${png.toString("base64")}`;
    expect((await loadImage(url)).equals(png)).toBe(true);
    expect(await frameSimilarity(url, png)).toBeGreaterThan(0.99);
    expect(await frameSimilarity(png, await deviceImage({ ...THIN, bodyW: 0.4, bodyH: 0.8 }))).toBeLessThan(0.75);
  });
});
