import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { productPixelScore, type BBox } from "./pixel-metrics";
import { applyH, compositePackshot, estimateQuad, homography, isSkin, quadFromBox, repairKeyframe, type Pt } from "./repair";
import { deviceImage } from "./test-images";

// sharp + per-pixel work is CPU-bound and the full suite runs files in parallel.
const SLOW = { timeout: 60_000 };

/** The official photo: a dark landscape tablet on a flat studio background. */
const packshot = () => deviceImage({ width: 640, height: 480, bodyW: 0.8, bodyH: 0.6, bezel: 0.04, body: "#1c1c1e", background: "#ffffff" });

const W = 360, H = 640;
/** Product box of the generated frame (portrait tablet held upright). */
const BOX: BBox = [0.25, 0.3, 0.75, 0.3 + (0.5 * W * (0.8 * 640)) / (0.6 * 480) / H];

/**
 * A generated frame with the WRONG product: a white portrait tablet (light-grey screen) on a slate
 * table under warm light, a skin-coloured thumb over its left edge coming in from outside the box.
 */
async function wrongFrame(angle = 0): Promise<Buffer> {
  const [x0, y0, x1, y1] = [BOX[0] * W, BOX[1] * H, BOX[2] * W, BOX[3] * H];
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="100%" height="100%" fill="#555b63"/>
    <g transform="rotate(${angle} ${cx} ${cy})">
      <rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" rx="8" fill="#f4f2ee"/>
      <rect x="${x0 + 16}" y="${y0 + 16}" width="${x1 - x0 - 32}" height="${y1 - y0 - 32}" fill="#dedbd5"/>
    </g>
    <rect x="${x0 - 40}" y="${cy}" width="70" height="44" rx="20" fill="#e2b49a"/>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 95 }).toBuffer();
}

async function pixel(buf: Buffer, x: number, y: number): Promise<number[]> {
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (Math.round(y) * info.width + Math.round(x)) * 3;
  return [data[i], data[i + 1], data[i + 2]];
}

describe("geometry", () => {
  it("homography maps the four corners and interpolates projectively", () => {
    const from: Pt[] = [[10, 10], [110, 20], [100, 220], [5, 200]];
    const to: Pt[] = [[0, 0], [300, 0], [300, 400], [0, 400]];
    const Hm = homography(from, to);
    from.forEach((p, i) => {
      const [u, v] = applyH(Hm, p);
      expect(u).toBeCloseTo(to[i][0], 6);
      expect(v).toBeCloseTo(to[i][1], 6);
    });
  });

  it("fills a box near the packshot's aspect (foreshortening) but keeps the aspect when the box is sloppy", () => {
    const near = quadFromBox([0, 0, 90, 160], 0.6);
    expect(near.quad[2]).toEqual([90, 160]);
    expect(near.foreshorten).toBeCloseTo(0.9375, 3);
    const sloppy = quadFromBox([0, 0, 200, 160], 0.6); // a wide box around a portrait tablet
    const w = sloppy.quad[1][0] - sloppy.quad[0][0];
    expect(w / 160).toBeCloseTo(0.6, 3);
    expect(sloppy.foreshorten).toBe(1);
  });

  it("finds a tilted product's silhouette quad from its edges", async () => {
    const frame = await wrongFrame(5);
    const { data, info } = await sharp(frame).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const gray = new Float32Array(info.width * info.height);
    for (let i = 0; i < gray.length; i++) gray[i] = 0.299 * data[i * 3] + 0.587 * data[i * 3 + 1] + 0.114 * data[i * 3 + 2];
    // The vision box: the rotated tablet's bounds, loosely.
    const quad = estimateQuad(gray, W, H, [BOX[0] * W - 12, BOX[1] * H - 8, BOX[2] * W + 12, BOX[3] * H + 8]);
    expect(quad).not.toBeNull();
    const angle = (Math.atan2(quad![1][1] - quad![0][1], quad![1][0] - quad![0][0]) * 180) / Math.PI;
    expect(angle).toBeGreaterThan(3.5);
    expect(angle).toBeLessThan(6.5);
  }, SLOW.timeout);

  it("skin: warm saturated tones yes; warm-lit white, grey, wood-dark no", () => {
    expect(isSkin(226, 180, 154)).toBe(true);
    expect(isSkin(196, 140, 112)).toBe(true);
    expect(isSkin(240, 230, 215)).toBe(false);
    expect(isSkin(128, 128, 128)).toBe(false);
    expect(isSkin(60, 120, 200)).toBe(false);
  });
});

describe("compositePackshot", () => {
  it("replaces the wrong-coloured product with the turned packshot, keeps the thumb and the rest of the frame", async () => {
    const frame = await wrongFrame();
    const out = await compositePackshot(frame, await packshot(), BOX);
    expect(out.width).toBe(W);
    expect(out.height).toBe(H);
    expect(out.rotated).toBe(true);
    expect(out.orientation).toBe("portrait");
    expect(out.cutout).toBe("flood");
    expect(out.handPixels).toBeGreaterThan(50);
    // The body is dark now (it was white): a point on the right bezel.
    const [x1, cy] = [BOX[2] * W, ((BOX[1] + BOX[3]) / 2) * H];
    const bez = await pixel(out.image, x1 - 5, cy - 60);
    expect(Math.max(...bez)).toBeLessThan(110);
    // The thumb stays in front of it, still skin-coloured.
    const thumb = await pixel(out.image, BOX[0] * W + 14, cy + 22);
    expect(isSkin(thumb[0], thumb[1], thumb[2])).toBe(true);
    // Far from the product the frame is untouched.
    const far = await pixel(out.image, 20, 20);
    const orig = await pixel(frame, 20, 20);
    far.forEach((v, i) => expect(Math.abs(v - orig[i])).toBeLessThan(6));
    // No light halo: just outside the right edge, nothing brighter than the wood around it.
    const rim = await pixel(out.image, x1 + 4, cy - 60);
    expect(Math.max(...rim)).toBeLessThan(150);
  }, SLOW.timeout);

  it("refuses a busy lifestyle photo (no clean cutout)", async () => {
    const busy = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 0, g: 0, b: 0 }, noise: { type: "gaussian", mean: 128, sigma: 60 } } }).png().toBuffer();
    await expect(compositePackshot(await wrongFrame(), busy, BOX)).rejects.toThrow(/cutout/);
  }, SLOW.timeout);
});

describe("repairKeyframe", () => {
  it("re-scores the repair with the pixel metrics only, better than the generated frame on the same box", async () => {
    const frame = await wrongFrame();
    const pack = await packshot();
    const before = await productPixelScore(frame, BOX, [{ image: pack }]);
    const out = await repairKeyframe({ frame, packshots: [pack], bbox: BOX, reason: "colour wrong: white body instead of dark", shot: "Hands hold the tablet" });
    expect(out).not.toBeNull();
    expect(out!.record).toMatchObject({ method: "packshot-composite", reason: "colour wrong: white body instead of dark", accepted: true, packshot: 0 });
    expect(out!.result.reviewed).toBe(true);
    expect(out!.record.colour!).toBeGreaterThan(before!.histogram.score + 0.2);
    expect(out!.record.pixel!).toBeGreaterThanOrEqual(out!.record.before!);
  }, SLOW.timeout);

  it("tries the next packshot when the best-matching one cannot be cut out, null when none can", async () => {
    const busy = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 0, g: 0, b: 0 }, noise: { type: "gaussian", mean: 128, sigma: 60 } } }).png().toBuffer();
    const frame = await wrongFrame();
    const out = await repairKeyframe({ frame, packshots: [await packshot(), busy], refIndex: 1, bbox: BOX, reason: "colour wrong", shot: "s" });
    expect(out?.record.packshot).toBe(0);
    expect(await repairKeyframe({ frame, packshots: [busy], bbox: BOX, reason: "colour wrong", shot: "s" })).toBeNull();
  }, SLOW.timeout);
});
