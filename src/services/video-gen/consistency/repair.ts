/**
 * Official-photo repair for keyframes. When the best attempt after the re-rolls still shows a MAJOR product
 * defect (wrong colour, shape, bezel, proportions, a stick, an invented logo), the product in the frame is
 * replaced with the official packshot instead of shipping a wrong product:
 *
 *   1. cut the packshot out (alpha, or flood-fill of a flat studio background — image-ads/cutout)
 *   2. orientation from the box aspect (a landscape packshot is turned for a tablet held in portrait)
 *   3. the product's quad in the frame: silhouette edge lines fitted on all four sides (perspective and
 *      tilt), else the vision box itself (a mild foreshortening keeps the box's aspect, a sloppy box keeps
 *      the packshot's)
 *   4. perspective warp of the packshot into the quad (homography, premultiplied bilinear — no halo)
 *   5. colour and light matched to the surroundings: a damped mean/variance transfer on Lab L (and a/b for
 *      the white balance), plus the low-frequency shading of the original product (the lamp side stays lit)
 *   6. a soft contact shadow, feathered edges, and the original frame's hands/fingers kept in front (skin
 *      pixels connected to skin outside the product)
 *
 * Local sharp + plain pixel math only — no model, no network. `repairKeyframe` then re-scores the result
 * once with the pixel metrics (free) on the placed box.
 */
import sharp from "sharp";
import { productCutout } from "@/services/image-ads/cutout";
import { loadImage, productPixelScore, type BBox, type ImageSource } from "./pixel-metrics";
import { scoreFrame, type ConsistencyScore } from "./score";
import type { ShotType } from "./thresholds";

export type Pt = [number, number];

// ---------- geometry ----------

/** 3×3 homography (row-major, h33 = 1) mapping `from[i]` → `to[i]` for 4 point pairs. */
export function homography(from: Pt[], to: Pt[]): number[] {
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i];
    const [u, v] = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  // Gaussian elimination with partial pivoting on the 8×9 augmented matrix.
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) throw new Error("degenerate quad");
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
    }
  }
  const h = A.map((row, i) => row[8] / row[i]);
  return [...h, 1];
}

export function applyH(H: number[], [x, y]: Pt): Pt {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function polygonArea(q: Pt[]): number {
  let s = 0;
  for (let i = 0; i < q.length; i++) {
    const [x0, y0] = q[i];
    const [x1, y1] = q[(i + 1) % q.length];
    s += x0 * y1 - x1 * y0;
  }
  return Math.abs(s) / 2;
}

function isConvex(q: Pt[]): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(z) < 1e-9) return false;
    if (!sign) sign = Math.sign(z);
    else if (Math.sign(z) !== sign) return false;
  }
  return true;
}

/** Point-in-convex-quad test (any winding). */
function inQuad(q: Pt[], x: number, y: number): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    const z = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (z === 0) continue;
    if (!sign) sign = Math.sign(z);
    else if (Math.sign(z) !== sign) return false;
  }
  return true;
}

/** Scale a quad about its centroid so every edge moves out by about `px`. */
export function growQuad(q: Pt[], px: number): Pt[] {
  const cx = q.reduce((s, p) => s + p[0], 0) / 4;
  const cy = q.reduce((s, p) => s + p[1], 0) / 4;
  const half = Math.min(dist(q[0], q[1]) + dist(q[3], q[2]), dist(q[0], q[3]) + dist(q[1], q[2])) / 4;
  const f = 1 + px / Math.max(1, half);
  return q.map(([x, y]) => [cx + (x - cx) * f, cy + (y - cy) * f]);
}

/** Pixel box [x0, y0, x1, y1] → normalised. */
const norm = (b: [number, number, number, number], W: number, H: number): BBox => [b[0] / W, b[1] / H, b[2] / W, b[3] / H];

function quadBounds(q: Pt[]): [number, number, number, number] {
  return [Math.min(...q.map((p) => p[0])), Math.min(...q.map((p) => p[1])), Math.max(...q.map((p) => p[0])), Math.max(...q.map((p) => p[1]))];
}

/**
 * The quad from the box alone: the packshot's aspect `aspect` (w/h) placed in the box. A box within ±30 %
 * of that aspect is filled (foreshortening: the product is turned away a little); a box further off was
 * drawn loosely, so the packshot keeps its own proportions, centred.
 */
export function quadFromBox(box: [number, number, number, number], aspect: number): { quad: Pt[]; foreshorten: number } {
  const [x0, y0, x1, y1] = box;
  const bw = x1 - x0, bh = y1 - y0;
  const r = bw / bh;
  let w = bw, h = bh;
  if (Math.abs(Math.log(r / aspect)) > Math.log(1.3)) {
    if (r > aspect) w = bh * aspect;
    else h = bw / aspect;
  }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return {
    quad: [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]],
    foreshorten: Math.round((w / h / aspect) * 1000) / 1000,
  };
}

// ---------- silhouette edge lines ----------

/** Theil–Sen line fit t = a + b·s over (s, t) points; null when too few points agree. */
export function robustLine(pts: Pt[], tol: number): { a: number; b: number; inliers: number } | null {
  if (pts.length < 10) return null;
  const step = Math.max(1, Math.floor(pts.length / 70));
  const sample = pts.filter((_, i) => i % step === 0);
  const slopes: number[] = [];
  for (let i = 0; i < sample.length; i++)
    for (let j = i + 1; j < sample.length; j++) {
      const ds = sample[j][0] - sample[i][0];
      if (Math.abs(ds) >= 3) slopes.push((sample[j][1] - sample[i][1]) / ds);
    }
  if (!slopes.length) return null;
  slopes.sort((p, q) => p - q);
  const b = slopes[Math.floor(slopes.length / 2)];
  const icpt = pts.map(([s, t]) => t - b * s).sort((p, q) => p - q);
  const a = icpt[Math.floor(icpt.length / 2)];
  const inliers = pts.filter(([s, t]) => Math.abs(t - (a + b * s)) <= tol).length;
  return inliers >= Math.max(10, pts.length * 0.5) ? { a, b, inliers } : null;
}

/**
 * Fit the product's four silhouette lines inside (and just around) the box: on every row/column of the
 * middle of each side, the outermost strong gradient. Sides hidden by a hand fall back to the opposite
 * side's direction through the box edge. Null when fewer than one vertical and one horizontal line fit.
 */
export function estimateQuad(gray: Float32Array, W: number, H: number, box: [number, number, number, number]): Pt[] | null {
  const [x0, y0, x1, y1] = box;
  const bw = x1 - x0, bh = y1 - y0;
  if (bw < 24 || bh < 24) return null;
  const at = (x: number, y: number) => gray[Math.max(0, Math.min(H - 1, y)) * W + Math.max(0, Math.min(W - 1, x))];
  const gxAt = (x: number, y: number) => at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
  const gyAt = (x: number, y: number) => at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
  const MIN_G = 48;

  /** Scan from `from` towards `to` (pixel positions along the scan axis), return the first strong local peak. */
  const scan = (g: (p: number) => number, from: number, to: number): number | null => {
    const dir = Math.sign(to - from) || 1;
    const vals: number[] = [];
    for (let p = from; dir > 0 ? p <= to : p >= to; p += dir) vals.push(Math.abs(g(p)));
    const max = Math.max(...vals);
    if (max < MIN_G) return null;
    for (let i = 0; i < vals.length; i++) {
      if (vals[i] >= 0.5 * max && vals[i] >= (vals[i - 1] ?? 0) && vals[i] >= (vals[i + 1] ?? 0)) return from + dir * i;
    }
    return null;
  };
  const tol = Math.max(2, 0.008 * Math.min(bw, bh));
  const vertical = (outer: number, inner: number) => {
    const pts: Pt[] = [];
    for (let y = Math.round(y0 + 0.12 * bh); y <= y1 - 0.12 * bh; y += 2) {
      const x = scan((p) => gxAt(p, y), Math.round(outer), Math.round(inner));
      if (x !== null) pts.push([y, x]);
    }
    return robustLine(pts, tol); // x = a + b·y
  };
  const horizontal = (outer: number, inner: number) => {
    const pts: Pt[] = [];
    for (let x = Math.round(x0 + 0.12 * bw); x <= x1 - 0.12 * bw; x += 2) {
      const y = scan((p) => gyAt(x, p), Math.round(outer), Math.round(inner));
      if (y !== null) pts.push([x, y]);
    }
    return robustLine(pts, tol); // y = a + b·x
  };
  let left = vertical(x0 - 0.1 * bw, x0 + 0.22 * bw);
  let right = vertical(x1 + 0.1 * bw, x1 - 0.22 * bw);
  let top = horizontal(y0 - 0.1 * bh, y0 + 0.22 * bh);
  let bottom = horizontal(y1 + 0.1 * bh, y1 - 0.22 * bh);
  // Opposite sides of a hand-held slab are near-parallel; a pair that disagrees has caught an inner edge.
  if (left && right && Math.abs(left.b - right.b) > 0.12) (left.inliers >= right.inliers ? (right = null) : (left = null));
  if (top && bottom && Math.abs(top.b - bottom.b) > 0.12) (top.inliers >= bottom.inliers ? (bottom = null) : (top = null));
  if (!(left || right) || !(top || bottom)) return null;
  // A hidden side: the opposite side's direction through the box edge.
  const midY = (y0 + y1) / 2, midX = (x0 + x1) / 2;
  if (!left) left = { a: x0 - right!.b * midY, b: right!.b, inliers: 0 };
  if (!right) right = { a: x1 - left.b * midY, b: left.b, inliers: 0 };
  if (!top) top = { a: y0 - bottom!.b * midX, b: bottom!.b, inliers: 0 };
  if (!bottom) bottom = { a: y1 - top.b * midX, b: top.b, inliers: 0 };
  const meet = (v: { a: number; b: number }, h: { a: number; b: number }): Pt => {
    const x = (v.a + v.b * h.a) / (1 - v.b * h.b);
    return [x, h.a + h.b * x];
  };
  const quad = [meet(left, top), meet(right, top), meet(right, bottom), meet(left, bottom)];
  // Sanity: convex, corners near the box, area close to the box's.
  const slack = 0.14;
  const near = quad.every(([x, y]) => x >= x0 - slack * bw && x <= x1 + slack * bw && y >= y0 - slack * bh && y <= y1 + slack * bh);
  const areaRatio = polygonArea(quad) / (bw * bh);
  if (!isConvex(quad) || !near || areaRatio < 0.55 || areaRatio > 1.2) return null;
  return quad;
}

// ---------- colour ----------

const srgbToLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linToSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const fLab = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
const fLabInv = (t: number) => (t > 0.206893 ? t ** 3 : (t - 16 / 116) / 7.787);

/** sRGB 0–255 → CIE Lab (D65). */
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const R = srgbToLin(r / 255), G = srgbToLin(g / 255), B = srgbToLin(b / 255);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const fx = fLab(X), fy = fLab(Y), fz = fLab(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function labToRgb(L: number, a: number, b: number): [number, number, number] {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const X = fLabInv(fx) * 0.95047, Y = fLabInv(fy), Z = fLabInv(fz) * 1.08883;
  const R = 3.2406 * X - 1.5372 * Y - 0.4986 * Z;
  const G = -0.9689 * X + 1.8758 * Y + 0.0415 * Z;
  const B = 0.0557 * X - 0.204 * Y + 1.057 * Z;
  const to = (c: number) => Math.max(0, Math.min(255, Math.round(255 * linToSrgb(Math.max(0, Math.min(1, c))))));
  return [to(R), to(G), to(B)];
}

/** Skin tone (YCbCr box, warm, saturated enough not to be a warm-lit white or grey surface) — hands holding the product. */
export function isSkin(r: number, g: number, b: number): boolean {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  return y > 45 && y < 248 && cb >= 77 && cb <= 127 && cr >= 137 && cr <= 175 && r >= g && g >= b - 4 && r - b >= 28 && (max - min) / max >= 0.2;
}

/** Binary 3×3 dilation (`grow` true) or erosion, `n` times. */
function morph(m: Uint8Array, w: number, h: number, n: number, grow: boolean): Uint8Array {
  let cur = m;
  for (let k = 0; k < n; k++) {
    const next = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let v = grow ? 0 : 1;
        for (let dy = -1; dy <= 1 && v === (grow ? 0 : 1); dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            const s = xx < 0 || yy < 0 || xx >= w || yy >= h ? (grow ? 0 : 1) : cur[yy * w + xx];
            if (grow ? s : !s) {
              v = grow ? 1 : 0;
              break;
            }
          }
        next[y * w + x] = v;
      }
    cur = next;
  }
  return cur;
}

async function blurPlane(plane: Float32Array, w: number, h: number, sigma: number, scale = 255): Promise<Float32Array> {
  if (sigma < 0.3) return plane;
  const u8 = Buffer.alloc(w * h);
  for (let i = 0; i < u8.length; i++) u8[i] = Math.max(0, Math.min(255, Math.round((plane[i] / scale) * 255)));
  const out = await sharp(u8, { raw: { width: w, height: h, channels: 1 } }).blur(Math.max(0.3, sigma)).extractChannel(0).raw().toBuffer();
  return Float32Array.from(out, (v) => (v / 255) * scale);
}

// ---------- composite ----------

export interface CompositeOptions {
  /** Contact shadow opacity (0 = none). */
  shadow?: number;
  /** Strength of the colour/light transfer toward the surroundings (0–1). */
  colourMatch?: number;
  /** Keep the original frame's hands/fingers in front of the product. */
  keepHands?: boolean;
  /** Use the box only (skip the edge-line quad). */
  boxOnly?: boolean;
}

export interface CompositeResult {
  image: Buffer;
  width: number;
  height: number;
  /** Where the packshot was placed: quad corners (tl, tr, br, bl, 0–1) and their bounding box. */
  quad: Pt[];
  bbox: BBox;
  orientation: "portrait" | "landscape";
  rotated: boolean;
  fit: "edges" | "box";
  foreshorten: number;
  cutout: "alpha" | "flood" | "none";
  handPixels: number;
}

/**
 * Put the packshot into the frame where `bbox` (normalised, from the vision model) says the product is.
 * Throws when the packshot has no clean cutout (a lifestyle photo would paste a rectangle).
 */
export async function compositePackshot(frameBuf: Buffer, packshotBuf: Buffer, bbox: BBox, o: CompositeOptions = {}): Promise<CompositeResult> {
  const { data: frame, info } = await sharp(frameBuf, { failOn: "none" }).rotate().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const box: [number, number, number, number] = [
    Math.max(0, Math.min(bbox[0], bbox[2])) * W,
    Math.max(0, Math.min(bbox[1], bbox[3])) * H,
    Math.min(1, Math.max(bbox[0], bbox[2])) * W,
    Math.min(1, Math.max(bbox[1], bbox[3])) * H,
  ];
  const bw = box[2] - box[0], bh = box[3] - box[1];
  if (bw < 16 || bh < 16) throw new Error("product box too small to repair");

  const cut = await productCutout(packshotBuf);
  if (cut.method === "none") throw new Error("packshot has no clean cutout (not a studio photo)");
  // Orientation from the box: a landscape packshot is turned for a tablet held upright, and vice versa.
  const boxPortrait = bh > bw * 1.08, boxLandscape = bw > bh * 1.08;
  const cutPortrait = cut.height > cut.width * 1.08, cutLandscape = cut.width > cut.height * 1.08;
  const rotated = (boxPortrait && cutLandscape) || (boxLandscape && cutPortrait);
  const aspect = rotated ? cut.height / cut.width : cut.width / cut.height;

  // The product's quad: silhouette edge lines, else the box.
  const gray = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) gray[i] = 0.299 * frame[i * 3] + 0.587 * frame[i * 3 + 1] + 0.114 * frame[i * 3 + 2];
  let quad = o.boxOnly ? null : estimateQuad(gray, W, H, box);
  let fit: CompositeResult["fit"] = "edges";
  let foreshorten = 1;
  if (quad) {
    const qa = (dist(quad[0], quad[1]) + dist(quad[3], quad[2])) / (dist(quad[0], quad[3]) + dist(quad[1], quad[2]));
    foreshorten = Math.round((qa / aspect) * 1000) / 1000;
    // Edges that imply a very different product shape caught something else (a screen, a second device).
    if (Math.abs(Math.log(foreshorten)) > Math.log(1.45)) quad = null;
  }
  if (!quad) {
    const q = quadFromBox(box, aspect);
    quad = q.quad;
    foreshorten = q.foreshorten;
    fit = "box";
  }
  // Grow a little so the old product's anti-aliased rim is covered.
  quad = growQuad(quad, Math.max(2, 0.009 * Math.min(bw, bh)));

  // Source image: the cutout turned and sized near the destination (bilinear from there stays sharp, no aliasing).
  const qw = Math.max(dist(quad[0], quad[1]), dist(quad[3], quad[2]));
  const qh = Math.max(dist(quad[0], quad[3]), dist(quad[1], quad[2]));
  const sw = Math.max(8, Math.round(qw * 1.25)), sh = Math.max(8, Math.round(qh * 1.25));
  let src = sharp(cut.png).ensureAlpha();
  if (rotated) src = sharp(await src.rotate(90).png().toBuffer());
  const { data: srcRaw } = await src.resize(sw, sh, { fit: "fill", kernel: "lanczos3" }).raw().toBuffer({ resolveWithObject: true });
  // Premultiplied source: interpolating straight alpha drags the transparent pixels' colour into the rim (halo).
  const pre = new Float32Array(sw * sh * 4);
  for (let i = 0; i < sw * sh; i++) {
    const a = srcRaw[i * 4 + 3] / 255;
    pre[i * 4] = srcRaw[i * 4] * a;
    pre[i * 4 + 1] = srcRaw[i * 4 + 1] * a;
    pre[i * 4 + 2] = srcRaw[i * 4 + 2] * a;
    pre[i * 4 + 3] = a;
  }
  const Hm = homography(quad, [[0, 0], [sw, 0], [sw, sh], [0, sh]]);

  // Work region: the quad's bounds plus room for the shadow and the hands.
  const qb = quadBounds(quad);
  const pad = Math.round(0.12 * Math.max(bw, bh));
  const rx0 = Math.max(0, Math.floor(qb[0]) - pad), ry0 = Math.max(0, Math.floor(qb[1]) - pad);
  const rx1 = Math.min(W, Math.ceil(qb[2]) + pad), ry1 = Math.min(H, Math.ceil(qb[3]) + pad);
  const rw = rx1 - rx0, rh = ry1 - ry0;
  const prod = new Float32Array(rw * rh * 3);
  let alpha: Float32Array<ArrayBufferLike> = new Float32Array(rw * rh);
  for (let y = 0; y < rh; y++)
    for (let x = 0; x < rw; x++) {
      const fx = rx0 + x + 0.5, fy = ry0 + y + 0.5;
      if (!inQuad(quad, fx, fy)) continue;
      const [u, v] = applyH(Hm, [fx, fy]);
      const sx = u - 0.5, sy = v - 0.5;
      const ix = Math.floor(sx), iy = Math.floor(sy);
      const tx = sx - ix, ty = sy - iy;
      let r = 0, g = 0, b = 0, a = 0;
      for (const [dx, dy, wgt] of [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)], [0, 1, (1 - tx) * ty], [1, 1, tx * ty]] as const) {
        const px = Math.max(0, Math.min(sw - 1, ix + dx)), py = Math.max(0, Math.min(sh - 1, iy + dy));
        const k = (py * sw + px) * 4;
        r += pre[k] * wgt;
        g += pre[k + 1] * wgt;
        b += pre[k + 2] * wgt;
        a += pre[k + 3] * wgt;
      }
      const i = y * rw + x;
      alpha[i] = a;
      if (a > 1e-4) {
        prod[i * 3] = r / a;
        prod[i * 3 + 1] = g / a;
        prod[i * 3 + 2] = b / a;
      }
    }

  // Feather: a 1-px erosion (drops the cutout's last fringe) then a soft blur.
  const short = Math.min(bw, bh);
  const eroded = new Float32Array(rw * rh);
  for (let y = 0; y < rh; y++)
    for (let x = 0; x < rw; x++) {
      let m = 1;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          m = Math.min(m, xx < 0 || yy < 0 || xx >= rw || yy >= rh ? 0 : alpha[yy * rw + xx]);
        }
      eroded[y * rw + x] = m;
    }
  alpha = await blurPlane(eroded, rw, rh, Math.max(0.6, 0.0025 * short), 1);

  // Colour and light: damped mean/variance transfer on Lab L, a/b white balance, original shading.
  const k = o.colourMatch ?? 0.35;
  const orig = (x: number, y: number) => ((ry0 + y) * W + rx0 + x) * 3;
  const ring = { n: 0, L: 0, L2: 0, a: 0, b: 0 };
  const prodS = { n: 0, L: 0, L2: 0, a: 0, b: 0 };
  const lab = new Float32Array(rw * rh * 3);
  const origL = new Float32Array(rw * rh);
  for (let y = 0; y < rh; y++)
    for (let x = 0; x < rw; x++) {
      const i = y * rw + x;
      const o3 = orig(x, y);
      const [Lo, ao, bo] = rgbToLab(frame[o3], frame[o3 + 1], frame[o3 + 2]);
      origL[i] = Lo;
      if (alpha[i] < 0.02) {
        ring.n++, (ring.L += Lo), (ring.L2 += Lo * Lo), (ring.a += ao), (ring.b += bo);
      }
      if (alpha[i] > 0.01) {
        const [L, a, b] = rgbToLab(prod[i * 3], prod[i * 3 + 1], prod[i * 3 + 2]);
        lab[i * 3] = L;
        lab[i * 3 + 1] = a;
        lab[i * 3 + 2] = b;
        if (alpha[i] > 0.5) prodS.n++, (prodS.L += L), (prodS.L2 += L * L), (prodS.a += a), (prodS.b += b);
      }
    }
  const stats = (s: typeof ring) => {
    const n = Math.max(1, s.n);
    const m = s.L / n;
    return { L: m, sd: Math.sqrt(Math.max(1, s.L2 / n - m * m)), a: s.a / n, b: s.b / n };
  };
  const rs = stats(ring), ps = stats(prodS);
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const meanL = ps.L + clamp(k * (rs.L - ps.L), -12, 12);
  const gain = clamp((rs.sd / ps.sd) ** k, 0.8, 1.2);
  const da = clamp(k * (rs.a - ps.a), -6, 6), db = clamp(k * (rs.b - ps.b), -8, 8);
  // Low-frequency shading of the original product (the side facing the lamp stays brighter).
  const inside = new Float32Array(rw * rh);
  const lw = new Float32Array(rw * rh);
  let insideSum = 0, insideN = 0;
  for (let i = 0; i < rw * rh; i++)
    if (alpha[i] > 0.5) {
      inside[i] = 1;
      lw[i] = origL[i];
      insideSum += origL[i];
      insideN++;
    }
  const sig = Math.max(2, 0.2 * short);
  const [numB, denB] = await Promise.all([blurPlane(lw, rw, rh, sig, 100), blurPlane(inside, rw, rh, sig, 1)]);
  const insideMean = insideSum / Math.max(1, insideN);
  for (let i = 0; i < rw * rh; i++) {
    if (alpha[i] <= 0.01) continue;
    const local = denB[i] > 0.05 ? numB[i] / denB[i] : insideMean;
    const shade = clamp(local / Math.max(1, insideMean), 0.7, 1.3) ** 0.5;
    const L = clamp(((lab[i * 3] - ps.L) * gain + meanL) * shade, 0, 100);
    const [r, g, b] = labToRgb(L, lab[i * 3 + 1] + da, lab[i * 3 + 2] + db);
    prod[i * 3] = r;
    prod[i * 3 + 1] = g;
    prod[i * 3 + 2] = b;
  }

  // Contact shadow: the product's alpha, blurred and nudged down, darkens what is behind it.
  const shadowOpacity = o.shadow ?? 0.32;
  const shift = Math.round(0.02 * short);
  const shadowSrc = new Float32Array(rw * rh);
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) if (y - shift >= 0) shadowSrc[y * rw + x] = alpha[(y - shift) * rw + x];
  const shadow = shadowOpacity > 0 ? await blurPlane(shadowSrc, rw, rh, Math.max(1, 0.03 * short), 1) : new Float32Array(rw * rh);

  // Hands in front: skin pixels inside the product connected to skin outside it (fingers come from outside).
  const hands = new Uint8Array(rw * rh);
  let handPixels = 0;
  if (o.keepHands !== false) {
    const skin = new Uint8Array(rw * rh);
    for (let i = 0; i < rw * rh; i++) {
      const o3 = orig(i % rw, Math.floor(i / rw));
      skin[i] = isSkin(frame[o3], frame[o3 + 1], frame[o3 + 2]) ? 1 : 0;
    }
    const stack: number[] = [];
    for (let i = 0; i < rw * rh; i++) if (skin[i] && alpha[i] < 0.05) (hands[i] = 1), stack.push(i);
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % rw;
      for (const j of [x > 0 ? i - 1 : -1, x < rw - 1 ? i + 1 : -1, i - rw, i + rw]) {
        if (j >= 0 && j < rw * rh && !hands[j] && skin[j]) (hands[j] = 1), stack.push(j);
      }
    }
    // Close the mask (fills speckle inside fingers, smooths the outline), then count what covers the product.
    const n = Math.max(1, Math.round(0.004 * short));
    hands.set(morph(morph(hands, rw, rh, n, true), rw, rh, n, false));
    // Smooth the outline: blur and re-threshold (a finger edge is a smooth curve, not skin-classifier noise).
    const smooth = await blurPlane(Float32Array.from(hands), rw, rh, Math.max(1, 0.006 * short), 1);
    for (let i = 0; i < rw * rh; i++) {
      hands[i] = smooth[i] >= 0.5 ? 1 : 0;
      if (hands[i] && alpha[i] > 0.05) handPixels++;
    }
  }
  const handSoft = handPixels ? await blurPlane(Float32Array.from(hands), rw, rh, Math.max(0.8, 0.003 * short), 1) : null;

  const out = Buffer.from(frame);
  for (let y = 0; y < rh; y++)
    for (let x = 0; x < rw; x++) {
      const i = y * rw + x;
      const o3 = orig(x, y);
      const a = alpha[i];
      const s = shadowOpacity * shadow[i] * (1 - a);
      const keep = handSoft ? handSoft[i] : 0;
      for (let c = 0; c < 3; c++) {
        const base = frame[o3 + c];
        const bg = base * (1 - s);
        const v = a > 0 ? bg * (1 - a) + prod[i * 3 + c] * a : bg;
        out[o3 + c] = Math.max(0, Math.min(255, Math.round(v * (1 - keep) + base * keep)));
      }
    }
  const image = await sharp(out, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer();
  const nb = quadBounds(quad);
  return {
    image,
    width: W,
    height: H,
    quad: quad.map(([x, y]) => [Math.round((x / W) * 1e4) / 1e4, Math.round((y / H) * 1e4) / 1e4]),
    bbox: norm([Math.max(0, nb[0]), Math.max(0, nb[1]), Math.min(W, nb[2]), Math.min(H, nb[3])], W, H),
    orientation: boxPortrait ? "portrait" : "landscape",
    rotated,
    fit,
    foreshorten,
    cutout: cut.method,
    handPixels,
  };
}

// ---------- the repair step ----------

export interface RepairRecord {
  method: "packshot-composite";
  reason: string;
  /** Pixel-only re-score of the repaired frame. */
  score: number;
  /** The generated frame's product pixel score on the same box (the repair must not be worse). */
  before: number | null;
  /** Used instead of the generated frame: its pixel score is no worse than before. */
  accepted: boolean;
  pass: boolean;
  pixel: number | null;
  aspect: number | null;
  colour: number | null;
  bezel: number | null;
  fit: CompositeResult["fit"];
  orientation: CompositeResult["orientation"];
  rotated: boolean;
  foreshorten: number;
  handPixels: number;
  quad: Pt[];
  packshot: number;
  /** The generated frame that was repaired. */
  fromUrl?: string;
  url?: string;
}

export interface RepairInput {
  frame: ImageSource;
  /** Official product photos (the shot's product references); `refIndex` (best pixel match) is tried first. */
  packshots: ImageSource[];
  refIndex?: number;
  bbox: BBox;
  reason: string;
  shot: string;
  shotType?: ShotType;
  options?: CompositeOptions;
}

/**
 * Repair one keyframe and re-score it once with the free pixel metrics on the placed box (and the generated
 * frame on the same box, for `accepted`: the pixel metrics see the hands as occlusion in both). Never throws:
 * null when no packshot gives a clean cutout or the composite fails (the best attempt then ships as before).
 */
export async function repairKeyframe(input: RepairInput): Promise<{ image: Buffer; result: ConsistencyScore; record: RepairRecord } | null> {
  try {
    const frame = await loadImage(input.frame);
    const order = input.packshots.map((_, i) => i);
    const first = input.refIndex !== undefined && input.refIndex < order.length ? input.refIndex : 0;
    order.sort((a, b) => (a === first ? -1 : b === first ? 1 : a - b));
    for (const i of order) {
      const packshot = await loadImage(input.packshots[i]).catch(() => null);
      if (!packshot) continue;
      let comp: CompositeResult;
      try {
        comp = await compositePackshot(frame, packshot, input.bbox, input.options);
      } catch (err) {
        console.warn(`[consistency] repair with packshot ${i} skipped:`, err instanceof Error ? err.message.slice(0, 120) : err);
        continue;
      }
      const result = await scoreFrame(
        comp.image,
        { product: [{ image: packshot }] },
        { shot: input.shot, shotType: input.shotType, productBbox: comp.bbox, deps: { vision: async () => null } }
      );
      const px = result.product?.pixel ?? null;
      const before = await productPixelScore(frame, comp.bbox, [{ image: packshot }]).then((m) => m?.score ?? null).catch(() => null);
      return {
        image: comp.image,
        result,
        record: {
          method: "packshot-composite",
          reason: input.reason,
          score: result.score,
          before,
          accepted: !px || before === null || px.score >= before,
          pass: result.pass,
          pixel: px?.score ?? null,
          aspect: px?.aspect.score ?? null,
          colour: px?.histogram.score ?? null,
          bezel: px?.structure.bezelScore ?? null,
          fit: comp.fit,
          orientation: comp.orientation,
          rotated: comp.rotated,
          foreshorten: comp.foreshorten,
          handPixels: comp.handPixels,
          quad: comp.quad,
          packshot: i,
        },
      };
    }
    return null;
  } catch (err) {
    console.warn("[consistency] keyframe repair failed:", err instanceof Error ? err.message.slice(0, 160) : err);
    return null;
  }
}
