/**
 * Free, local pixel metrics (sharp only — no model, no network) that compare the
 * product as it appears in a generated frame (its bounding-box crop) with the
 * official product photo. They catch the geometry failures a vision model
 * shrugs off: a stretched or squashed body, a tablet whose side reads as a thin
 * stick, a thick bezel instead of a hair-thin one, a colour shift.
 *
 *   aspect      orientation-invariant long/short ratio of the crop vs the reference
 *   hash        dHash + pHash Hamming distance (64-bit each)
 *   histogram   joint RGB histogram, Bhattacharyya coefficient
 *   structure   SSIM on a contrast-normalised grayscale crop, SSIM of the Sobel
 *               edge maps, edge-density similarity, and the bezel width measured
 *               from the silhouette edge inward on all four sides
 *
 * All scores are 0–1 (1 = identical). `productPixelScore` blends them.
 */
import sharp from "sharp";

/** Normalised [x0, y0, x1, y1], 0–1 of the image. */
export type BBox = [number, number, number, number];

export type ImageSource = Buffer | string;

/** A Buffer as-is; a data: URL decoded; http(s) fetched; anything else read as a file path. */
export async function loadImage(src: ImageSource): Promise<Buffer> {
  if (Buffer.isBuffer(src)) return src;
  if (src.startsWith("data:")) return Buffer.from(src.slice(src.indexOf(",") + 1), "base64");
  if (/^https?:\/\//.test(src)) {
    const res = await fetch(src, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`image download ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  const { readFile } = await import("node:fs/promises");
  return readFile(src);
}

/** Flatten transparency onto white, so an RGBA packshot and a JPEG frame compare alike. */
function flat(buf: Buffer) {
  return sharp(buf, { failOn: "none" }).rotate().flatten({ background: "#ffffff" });
}

export function clampBox(b: BBox): BBox | null {
  const x0 = Math.max(0, Math.min(1, Math.min(b[0], b[2])));
  const x1 = Math.max(0, Math.min(1, Math.max(b[0], b[2])));
  const y0 = Math.max(0, Math.min(1, Math.min(b[1], b[3])));
  const y1 = Math.max(0, Math.min(1, Math.max(b[1], b[3])));
  return x1 - x0 < 0.01 || y1 - y0 < 0.01 ? null : [x0, y0, x1, y1];
}

/** Crop a normalised box out of an image (PNG buffer). */
export async function cropBox(buf: Buffer, box: BBox): Promise<Buffer> {
  const b = clampBox(box);
  if (!b) throw new Error("empty bounding box");
  const png = await flat(buf).png().toBuffer();
  const { width = 1, height = 1 } = await sharp(png).metadata();
  const left = Math.floor(b[0] * width);
  const top = Math.floor(b[1] * height);
  const w = Math.max(4, Math.min(width - left, Math.round((b[2] - b[0]) * width)));
  const h = Math.max(4, Math.min(height - top, Math.round((b[3] - b[1]) * height)));
  return sharp(png).extract({ left, top, width: w, height: h }).png().toBuffer();
}

/**
 * The product in a packshot: trims the plain studio background. Falls back to
 * the whole image when there is nothing to trim (a lifestyle reference).
 */
export async function trimToSubject(buf: Buffer, threshold = 18): Promise<Buffer> {
  const png = await flat(buf).png().toBuffer();
  try {
    const out = await sharp(png).trim({ threshold }).png().toBuffer();
    const m = await sharp(out).metadata();
    return (m.width ?? 0) >= 8 && (m.height ?? 0) >= 8 ? out : png;
  } catch {
    return png;
  }
}

async function size(buf: Buffer): Promise<{ w: number; h: number }> {
  const m = await sharp(buf).metadata();
  return { w: m.width ?? 1, h: m.height ?? 1 };
}

async function gray(buf: Buffer, w: number, h: number, angle = 0): Promise<Float64Array> {
  let img = flat(buf);
  if (angle) img = sharp(await img.png().toBuffer()).rotate(angle);
  const raw = await img.resize(w, h, { fit: "fill" }).grayscale().raw().toBuffer();
  return Float64Array.from(raw);
}

async function rgb(buf: Buffer, n: number, angle = 0): Promise<Buffer> {
  let img = flat(buf);
  if (angle) img = sharp(await img.png().toBuffer()).rotate(angle);
  return img.resize(n, n, { fit: "fill" }).removeAlpha().raw().toBuffer();
}

/** Zero-mean, fixed-contrast grayscale: lighting and exposure stop mattering, layout does not. */
export function normalizeContrast(a: Float64Array): Float64Array {
  let mean = 0;
  for (const v of a) mean += v;
  mean /= a.length;
  let varSum = 0;
  for (const v of a) varSum += (v - mean) ** 2;
  const std = Math.sqrt(varSum / a.length) || 1;
  return a.map((v) => Math.max(0, Math.min(255, 128 + (50 * (v - mean)) / std)));
}

/** Mean SSIM over 8×8 windows (stride 4) of two equally sized single-channel images. */
export function ssim(a: Float64Array, b: Float64Array, w: number, h: number, win = 8, stride = 4): number {
  const C1 = (0.01 * 255) ** 2;
  const C2 = (0.03 * 255) ** 2;
  let total = 0;
  let count = 0;
  for (let y = 0; y + win <= h; y += stride) {
    for (let x = 0; x + win <= w; x += stride) {
      let ma = 0, mb = 0;
      for (let j = 0; j < win; j++) for (let i = 0; i < win; i++) {
        const k = (y + j) * w + x + i;
        ma += a[k];
        mb += b[k];
      }
      const n = win * win;
      ma /= n;
      mb /= n;
      let va = 0, vb = 0, cov = 0;
      for (let j = 0; j < win; j++) for (let i = 0; i < win; i++) {
        const k = (y + j) * w + x + i;
        const da = a[k] - ma;
        const db = b[k] - mb;
        va += da * da;
        vb += db * db;
        cov += da * db;
      }
      va /= n - 1;
      vb /= n - 1;
      cov /= n - 1;
      total += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
      count++;
    }
  }
  return count ? total / count : 0;
}

/** Sobel gradient magnitude. */
export function sobel(a: Float64Array, w: number, h: number): Float64Array {
  const out = new Float64Array(w * h);
  const at = (x: number, y: number) => a[Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
      const gy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
      out[y * w + x] = Math.hypot(gx, gy);
    }
  }
  return out;
}

/** A 64-bit perceptual hash as 64 bits (0/1). */
export type Hash64 = Uint8Array;

export function hamming(a: Hash64, b: Hash64): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

/** 64-bit difference hash (9×8 grayscale, left > right). */
export async function dHash(buf: Buffer, angle = 0): Promise<Hash64> {
  const g = await gray(buf, 9, 8, angle);
  const h = new Uint8Array(64);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) h[y * 8 + x] = g[y * 9 + x] > g[y * 9 + x + 1] ? 1 : 0;
  return h;
}

/** 64-bit perceptual hash (32×32 DCT, low 8×8 band above its median, DC excluded). */
export async function pHash(buf: Buffer, angle = 0): Promise<Hash64> {
  const N = 32;
  const g = await gray(buf, N, N, angle);
  // Separable DCT-II, only the low 8×8 band: rows first, then columns.
  const cos = Array.from({ length: 8 }, (_, k) => Float64Array.from({ length: N }, (_, n) => Math.cos(((2 * n + 1) * k * Math.PI) / (2 * N))));
  const rows = new Float64Array(N * 8);
  for (let y = 0; y < N; y++) for (let u = 0; u < 8; u++) {
    let s = 0;
    for (let x = 0; x < N; x++) s += g[y * N + x] * cos[u][x];
    rows[y * 8 + u] = s;
  }
  const coef: number[] = [];
  for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) {
    let s = 0;
    for (let y = 0; y < N; y++) s += rows[y * 8 + u] * cos[v][y];
    coef.push(s);
  }
  const ac = coef.slice(1);
  const median = [...ac].sort((p, q) => p - q)[Math.floor(ac.length / 2)];
  return Uint8Array.from(coef, (c) => (c > median ? 1 : 0));
}

/** Joint RGB histogram (8 bins per channel), normalised. */
export function histogram(raw: Buffer, bins = 8): Float64Array {
  const hist = new Float64Array(bins ** 3);
  const step = 256 / bins;
  const px = raw.length / 3;
  for (let i = 0; i < raw.length; i += 3) {
    hist[Math.floor(raw[i] / step) * bins * bins + Math.floor(raw[i + 1] / step) * bins + Math.floor(raw[i + 2] / step)] += 1 / px;
  }
  return hist;
}

/** Bhattacharyya coefficient of two normalised histograms (1 = identical, 0 = disjoint). */
export function bhattacharyya(p: Float64Array, q: Float64Array): number {
  let bc = 0;
  for (let i = 0; i < p.length; i++) bc += Math.sqrt(p[i] * q[i]);
  return Math.min(1, bc);
}

/**
 * Bezel width as a fraction of the device's short side, measured on a crop
 * padded with `margin` (fraction of the device size per side) of surrounding
 * background, so the silhouette edge is always inside. On each side: the
 * edge-energy profile from the border inward; the first strong peak is the
 * silhouette, the next one the bezel's inner edge. Median of the sides; null
 * when no inner edge shows (dark screen, no frame at all).
 */
export function bezelWidth(g: Float64Array, w: number, h: number, margin = 0.08, maxFrac = 0.22): number | null {
  const mag = sobel(g, w, h);
  const short = Math.min(w, h) / (1 + 2 * margin);
  const depth = Math.min(Math.floor(Math.min(w, h) / 2) - 1, Math.round(Math.min(w, h) * margin + short * maxFrac));
  const widths: number[] = [];
  const sides: ((d: number, t: number) => number)[] = [
    (d, t) => mag[d * w + t], // top: row d, column t
    (d, t) => mag[(h - 1 - d) * w + t], // bottom
    (d, t) => mag[t * w + d], // left: column d, row t
    (d, t) => mag[t * w + (w - 1 - d)], // right
  ];
  sides.forEach((at, si) => {
    const len = si < 2 ? w : h;
    const from = Math.floor(len * 0.3);
    const to = Math.ceil(len * 0.7);
    const prof: number[] = [];
    for (let d = 1; d < depth; d++) {
      let s = 0;
      for (let t = from; t < to; t++) s += at(d, t);
      prof.push(s / (to - from));
    }
    const max = Math.max(...prof);
    if (max <= 1e-6) return;
    const isPeak = (i: number) => prof[i] >= (prof[i - 1] ?? 0) && prof[i] >= (prof[i + 1] ?? 0);
    let p1 = -1;
    for (let i = 0; i < prof.length; i++) if (prof[i] >= 0.4 * max && isPeak(i)) { p1 = i; break; }
    if (p1 < 0) return;
    // Walk down the silhouette edge's own falloff, then find the bezel's inner edge.
    let i = p1 + 1;
    while (i < prof.length && prof[i] <= prof[i - 1]) i++;
    for (; i < prof.length; i++) {
      if (prof[i] >= 0.25 * prof[p1] && isPeak(i)) {
        widths.push((i - p1) / short);
        return;
      }
    }
  });
  if (widths.length < 2) return null;
  widths.sort((a, b) => a - b);
  return widths[Math.floor(widths.length / 2)];
}

/** Product crops ready to compare: tight (layout, hashes, colour) and padded (bezel). */
export interface PreparedCrop {
  tight: Buffer;
  /** The same crop with `margin` of its surroundings on every side. */
  padded?: Buffer;
  margin?: number;
}

export const BEZEL_MARGIN = 0.08;

/** Expand a normalised box by `m` of its own size per side (clamped to the image). */
export function expandBox(b: BBox, m: number): BBox {
  const w = b[2] - b[0];
  const h = b[3] - b[1];
  return [Math.max(0, b[0] - w * m), Math.max(0, b[1] - h * m), Math.min(1, b[2] + w * m), Math.min(1, b[3] + h * m)];
}

/** A frame's product crop: the box, plus a padded version for the bezel. */
export async function prepareFrameCrop(frame: Buffer, bbox: BBox): Promise<PreparedCrop> {
  const b = clampBox(bbox);
  if (!b) throw new Error("empty bounding box");
  const e = expandBox(b, BEZEL_MARGIN);
  // A box at the image border cannot be padded evenly: skip the bezel there.
  const even = Math.abs(b[0] - e[0] - (e[2] - b[2])) < 1e-6 && Math.abs(b[1] - e[1] - (e[3] - b[3])) < 1e-6;
  return { tight: await cropBox(frame, b), padded: even ? await cropBox(frame, e) : undefined, margin: BEZEL_MARGIN };
}

/** A reference's product: trimmed studio background (or its box), padded with that background. */
export async function prepareRefCrop(ref: Buffer, bbox?: BBox | null): Promise<PreparedCrop> {
  if (bbox) return prepareFrameCrop(ref, bbox);
  const png = await flat(ref).png().toBuffer();
  const tight = await trimToSubject(png);
  const { w, h } = await size(tight);
  const { data } = await sharp(png).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
  const background = { r: data[0], g: data[1], b: data[2], alpha: 1 };
  const px = (n: number) => Math.max(1, Math.round(n * BEZEL_MARGIN));
  const padded = await sharp(tight).extend({ top: px(h), bottom: px(h), left: px(w), right: px(w), background }).png().toBuffer();
  return { tight, padded, margin: BEZEL_MARGIN };
}

export interface PixelMetrics {
  aspect: { frame: number; ref: number; deviation: number; rotated: boolean; score: number };
  hash: { dHashDistance: number; pHashDistance: number; score: number };
  histogram: { bhattacharyya: number; distance: number; score: number };
  structure: {
    ssim: number;
    edgeSsim: number;
    edgeDensityFrame: number;
    edgeDensityRef: number;
    bezelFrame: number | null;
    bezelRef: number | null;
    bezelScore: number | null;
    score: number;
  };
  /** Blended 0–1 product pixel score. */
  score: number;
}

export interface PixelWeights {
  aspect: number;
  hash: number;
  histogram: number;
  structure: number;
}

/** Geometry dominates: colour and hashes move with whatever is on the product's screen. */
export const DEFAULT_PIXEL_WEIGHTS: PixelWeights = { aspect: 0.25, hash: 0.1, histogram: 0.1, structure: 0.55 };

const S = 64; // structure resolution
const B = 192; // bezel resolution

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function edgeDensity(mag: Float64Array, threshold = 120): number {
  let n = 0;
  for (const v of mag) if (v > threshold) n++;
  return n / mag.length;
}

/**
 * Compare a product crop from a frame with the (trimmed) product reference.
 * Orientation-invariant: a tablet held in portrait is turned to match a
 * landscape reference before the layout is compared.
 */
export async function compareProductPixels(
  frame: Buffer | PreparedCrop,
  ref: Buffer | PreparedCrop,
  weights: PixelWeights = DEFAULT_PIXEL_WEIGHTS
): Promise<PixelMetrics> {
  const fPrep: PreparedCrop = Buffer.isBuffer(frame) ? { tight: frame } : frame;
  const rPrep: PreparedCrop = Buffer.isBuffer(ref) ? { tight: ref } : ref;
  const frameCrop = fPrep.tight;
  const refCrop = rPrep.tight;
  const fs = await size(frameCrop);
  const rs = await size(refCrop);
  const fLand = fs.w >= fs.h;
  const rLand = rs.w >= rs.h;
  const rotated = fLand !== rLand && Math.max(fs.w, fs.h) / Math.min(fs.w, fs.h) > 1.08;
  const fAspect = Math.max(fs.w, fs.h) / Math.min(fs.w, fs.h);
  const rAspect = Math.max(rs.w, rs.h) / Math.min(rs.w, rs.h);
  const deviation = Math.abs(Math.log(fAspect / rAspect));
  // ln(2): twice as elongated (or half) scores 0.
  const aspectScore = clamp01(1 - deviation / Math.LN2);

  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  // Turned the other way: try both quarter turns, keep the better layout match.
  const at = async (angle: number): Promise<PixelMetrics> => {
    const [fd, rd, fp, rp] = await Promise.all([dHash(frameCrop, angle), dHash(refCrop), pHash(frameCrop, angle), pHash(refCrop)]);
    const dDist = hamming(fd, rd);
    const pDist = hamming(fp, rp);
    // Unrelated images sit near 32 of 64 bits.
    const hashScore = clamp01(1 - (dDist + pDist) / 2 / 32);

    const [fRgb, rRgb] = await Promise.all([rgb(frameCrop, 64, angle), rgb(refCrop, 64)]);
    const bc = bhattacharyya(histogram(fRgb), histogram(rRgb));

    const [fg, rg] = await Promise.all([gray(frameCrop, S, S, angle), gray(refCrop, S, S)]);
    const fn = normalizeContrast(fg);
    const rn = normalizeContrast(rg);
    const ssimGray = ssim(fn, rn, S, S);
    const fe = sobel(fn, S, S);
    const re = sobel(rn, S, S);
    const emax = Math.max(1, ...fe, ...re);
    const edgeSsim = ssim(fe.map((v) => (255 * v) / emax), re.map((v) => (255 * v) / emax), S, S);
    const dF = edgeDensity(fe);
    const dR = edgeDensity(re);
    const densitySim = Math.max(dF, dR) > 0 ? Math.min(dF, dR) / Math.max(dF, dR) : 1;

    // Bezel on the aspect-true padded crop (stretching to a square would distort the width).
    const dims = (s: { w: number; h: number }) => (s.w >= s.h ? [B, Math.max(16, Math.round((B * s.h) / s.w))] : [Math.max(16, Math.round((B * s.w) / s.h)), B]);
    const bezelOf = async (p: PreparedCrop, rot: number): Promise<number | null> => {
      if (!p.padded) return null;
      const s0 = await size(p.padded);
      const [bw, bh] = dims(rot ? { w: s0.h, h: s0.w } : s0);
      return bezelWidth(normalizeContrast(await gray(p.padded, bw, bh, rot)), bw, bh, p.margin ?? BEZEL_MARGIN);
    };
    const [bezelF, bezelR] = await Promise.all([bezelOf(fPrep, angle), bezelOf(rPrep, 0)]);
    // Widths in % of the short side; +1 % keeps two hair-thin bezels from looking far apart.
    const bezelScore =
      bezelF !== null && bezelR !== null ? clamp01(Math.exp(-1.5 * Math.abs(Math.log((bezelF * 100 + 1) / (bezelR * 100 + 1))))) : null;

    const parts: [number, number][] = [
      [clamp01(ssimGray), 0.35],
      [clamp01(edgeSsim), 0.35],
      [densitySim, 0.1],
      ...(bezelScore !== null ? ([[bezelScore, 0.2]] as [number, number][]) : []),
    ];
    const structureScore = parts.reduce((s, [v, wt]) => s + v * wt, 0) / parts.reduce((s, [, wt]) => s + wt, 0);

    const total = weights.aspect + weights.hash + weights.histogram + weights.structure;
    const score =
      (weights.aspect * aspectScore + weights.hash * hashScore + weights.histogram * bc + weights.structure * structureScore) / (total || 1);
    return {
      aspect: { frame: r3(fAspect), ref: r3(rAspect), deviation: r3(deviation), rotated, score: r3(aspectScore) },
      hash: { dHashDistance: dDist, pHashDistance: pDist, score: r3(hashScore) },
      histogram: { bhattacharyya: r3(bc), distance: r3(Math.sqrt(1 - bc)), score: r3(bc) },
      structure: {
        ssim: r3(ssimGray),
        edgeSsim: r3(edgeSsim),
        edgeDensityFrame: r3(dF),
        edgeDensityRef: r3(dR),
        bezelFrame: bezelF === null ? null : r3(bezelF),
        bezelRef: bezelR === null ? null : r3(bezelR),
        bezelScore: bezelScore === null ? null : r3(bezelScore),
        score: r3(structureScore),
      },
      score: r3(score),
    };
  };
  if (!rotated) return at(0);
  const [cw, ccw] = await Promise.all([at(90), at(270)]);
  return cw.score >= ccw.score ? cw : ccw;
}

/**
 * Product pixel score of a frame against one or more product references (a
 * golden set of views): the product crop vs each trimmed reference, best match
 * wins. `refBox` crops the reference instead of trimming its background.
 */
export async function productPixelScore(
  frame: ImageSource,
  bbox: BBox,
  refs: { image: ImageSource; bbox?: BBox | null }[],
  weights?: PixelWeights
): Promise<(PixelMetrics & { refIndex: number }) | null> {
  if (!refs.length) return null;
  const crop = await prepareFrameCrop(await loadImage(frame), bbox);
  let best: (PixelMetrics & { refIndex: number }) | null = null;
  for (const [i, r] of refs.entries()) {
    const refCrop = await prepareRefCrop(await loadImage(r.image), r.bbox);
    const m = await compareProductPixels(crop, refCrop, weights);
    if (!best || m.score > best.score) best = { ...m, refIndex: i };
  }
  return best;
}

/**
 * Whole-frame similarity (boundary anchoring: clip frame 0 vs its start
 * keyframe, last frame vs the end keyframe). Contrast-normalised SSIM + edges.
 */
export async function frameSimilarity(a: ImageSource, b: ImageSource): Promise<number> {
  const [ab, bb] = await Promise.all([loadImage(a), loadImage(b)]);
  const [ag, bg] = await Promise.all([gray(ab, S, S), gray(bb, S, S)]);
  const an = normalizeContrast(ag);
  const bn = normalizeContrast(bg);
  const ae = sobel(an, S, S);
  const be = sobel(bn, S, S);
  const emax = Math.max(1, ...ae, ...be);
  const v = 0.6 * clamp01(ssim(an, bn, S, S)) + 0.4 * clamp01(ssim(ae.map((x) => (255 * x) / emax), be.map((x) => (255 * x) / emax), S, S));
  return Math.round(v * 1000) / 1000;
}
