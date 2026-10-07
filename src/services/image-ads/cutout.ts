/**
 * Product cutout for the layouts: a transparent packshot is trimmed to its pixels; a packshot on a
 * flat studio background (white, grey, black) has the background flood-filled away from the border
 * (so a white screen inside a black TV survives, unlike a global threshold) and the edge feathered;
 * anything busier is used as a rectangular photo. Local sharp only.
 */
import sharp from "sharp";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Bounding box of pixels with alpha above `thr` (RGBA raw), or null when fully transparent. */
export function alphaBBox(raw: Buffer | Uint8Array, w: number, h: number, channels = 4, thr = 8): Box | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (raw[(y * w + x) * channels + channels - 1] > thr) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Mean colour of the 2-px border and whether it's flat enough to be a studio background. */
export function borderStats(raw: Buffer | Uint8Array, w: number, h: number, channels: number): { color: [number, number, number]; flat: boolean } {
  const px: number[][] = [];
  const take = (x: number, y: number) => {
    const i = (y * w + x) * channels;
    px.push([raw[i], raw[i + 1], raw[i + 2]]);
  };
  for (let x = 0; x < w; x++) for (const y of [0, 1, h - 2, h - 1]) take(x, y);
  for (let y = 2; y < h - 2; y++) for (const x of [0, 1, w - 2, w - 1]) take(x, y);
  const mean = [0, 1, 2].map((c) => px.reduce((n, p) => n + p[c], 0) / px.length) as [number, number, number];
  const near = px.filter((p) => Math.hypot(p[0] - mean[0], p[1] - mean[1], p[2] - mean[2]) < 30).length / px.length;
  return { color: mean, flat: near >= 0.9 };
}

/** 0 where the pixel is background reachable from the border (within `tol` of `bg`), 255 elsewhere. */
export function floodMask(raw: Buffer | Uint8Array, w: number, h: number, channels: number, bg: number[], tol: number): Uint8Array {
  const mask = new Uint8Array(w * h).fill(255);
  const isBg = (i: number) => {
    const o = i * channels;
    return Math.hypot(raw[o] - bg[0], raw[o + 1] - bg[1], raw[o + 2] - bg[2]) <= tol;
  };
  const stack = new Int32Array(w * h);
  let sp = 0;
  const push = (i: number) => {
    if (mask[i] === 255 && isBg(i)) {
      mask[i] = 0;
      stack[sp++] = i;
    }
  };
  for (let x = 0; x < w; x++) push(x), push((h - 1) * w + x);
  for (let y = 0; y < h; y++) push(y * w), push(y * w + w - 1);
  while (sp > 0) {
    const i = stack[--sp];
    const x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < w * (h - 1)) push(i + w);
  }
  return mask;
}

/** Share of the 1-px border that is (nearly) transparent, RGBA raw. */
export function transparentBorderShare(raw: Buffer | Uint8Array, w: number, h: number): number {
  let n = 0;
  let clear = 0;
  const at = (x: number, y: number) => {
    n++;
    if (raw[(y * w + x) * 4 + 3] < 16) clear++;
  };
  for (let x = 0; x < w; x++) at(x, 0), at(x, h - 1);
  for (let y = 1; y < h - 1; y++) at(0, y), at(w - 1, y);
  return clear / Math.max(1, n);
}

export interface Cutout {
  png: Buffer;
  method: "alpha" | "flood" | "none";
  width: number;
  height: number;
}

const MAX_SIDE = 1600;

export async function productCutout(input: Buffer): Promise<Cutout> {
  const base = sharp(input).rotate().resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true });
  const meta = await sharp(input).metadata();
  if (meta.hasAlpha) {
    const { data, info } = await base.clone().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const bb = alphaBBox(data, info.width, info.height, 4);
    if (bb && transparentBorderShare(data, info.width, info.height) >= 0.6) {
      const png = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).extract({ left: bb.x, top: bb.y, width: bb.w, height: bb.h }).png().toBuffer();
      return { png, method: "alpha", width: bb.w, height: bb.h };
    }
  }
  const { data, info } = await base.clone().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const border = borderStats(data, w, h, 3);
  if (border.flat) {
    const mask = floodMask(data, w, h, 3, border.color, 34);
    const feathered = await sharp(Buffer.from(mask), { raw: { width: w, height: h, channels: 1 } }).blur(0.8).extractChannel(0).raw().toBuffer();
    const rgba = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      rgba[i * 4] = data[i * 3];
      rgba[i * 4 + 1] = data[i * 3 + 1];
      rgba[i * 4 + 2] = data[i * 3 + 2];
      rgba[i * 4 + 3] = feathered[i];
    }
    const bb = alphaBBox(rgba, w, h, 4, 24);
    if (bb && bb.w * bb.h < w * h * 0.98) {
      const png = await sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).extract({ left: bb.x, top: bb.y, width: bb.w, height: bb.h }).png().toBuffer();
      return { png, method: "flood", width: bb.w, height: bb.h };
    }
  }
  const png = await sharp(data, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
  return { png, method: "none", width: w, height: h };
}
