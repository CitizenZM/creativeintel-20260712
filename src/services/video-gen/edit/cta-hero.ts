/**
 * CTA hero from the official packshot. The first live run's CTA showed the tablet half out of frame
 * with a blank white screen behind the end card: a generated clip is a poor hero. When the CTA
 * frame's keyframe check (consistency bbox) says the product is missing, off-centre or small, the
 * edit swaps the CTA clip for a local still — the official packshot, cut out of its studio
 * background, big and centred over a blurred, darkened copy of the last shot — and the still gets
 * the edit's slow push-in like every still (render-v2 shotFilter).
 */
import sharp from "sharp";
import type { BBox, ProductBox } from "./edit-plan";

/** The product reads as the hero when centred (±0.15 across, 0.3–0.7 down) and ≥ 35 % of the frame height. */
export const HERO_RULE = { maxOffX: 0.15, minY: 0.3, maxY: 0.7, minHeight: 0.35 };

/**
 * Where the packshot sits on the hero still (centre y and height as shares of the frame): on 9:16
 * under the end card's badge (y ≈ 0.40) and behind its button (y ≈ 0.60).
 */
export const HERO_LAYOUT = { vertical: { y: 0.66, height: 0.42, maxWidth: 0.78 }, other: { y: 0.58, height: 0.58, maxWidth: 0.5 } };

export type HeroReason = "unreviewed" | "hero" | "no product" | "off-centre" | "small";

function judge(b: BBox): HeroReason {
  const cx = (b[0] + b[2]) / 2;
  const cy = (b[1] + b[3]) / 2;
  if (Math.abs(cx - 0.5) > HERO_RULE.maxOffX || cy < HERO_RULE.minY || cy > HERO_RULE.maxY) return "off-centre";
  if (b[3] - b[1] < HERO_RULE.minHeight) return "small";
  return "hero";
}

/** Swap the CTA clip for the packshot hero? Judged on the start and the end keyframe of the CTA clip. */
export function ctaHeroDecision(box: ProductBox | null | undefined): { use: boolean; reason: HeroReason } {
  if (!box) return { use: false, reason: "unreviewed" };
  if (box.present === false) return { use: true, reason: "no product" };
  // No box: "present" without a box is still no usable product; an unknown verdict is left alone.
  if (!box.start && !box.end) return box.present === true ? { use: true, reason: "no product" } : { use: false, reason: "unreviewed" };
  for (const b of [box.start, box.end]) {
    if (!b) continue;
    const r = judge(b);
    if (r !== "hero") return { use: true, reason: r };
  }
  return { use: false, reason: "hero" };
}

/**
 * The packshot without its studio background: an existing alpha channel is kept; otherwise the
 * near-white pixels connected to the image border become transparent (flood fill, so a white screen
 * or label inside the product stays), the edge is feathered, and the result is trimmed.
 */
export async function cutOutPackshot(packshot: Buffer): Promise<Buffer> {
  const img = sharp(packshot, { failOn: "none" }).rotate();
  const meta = await img.metadata();
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  let transparent = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) transparent++;
  if (!(meta.hasAlpha && transparent > w * h * 0.02)) {
    const white = (p: number) => data[p * 4] >= 232 && data[p * 4 + 1] >= 232 && data[p * 4 + 2] >= 232;
    const seen = new Uint8Array(w * h);
    const stack: number[] = [];
    const seed = (p: number) => {
      if (!seen[p] && white(p)) {
        seen[p] = 1;
        stack.push(p);
      }
    };
    for (let x = 0; x < w; x++) (seed(x), seed((h - 1) * w + x));
    for (let y = 0; y < h; y++) (seed(y * w), seed(y * w + w - 1));
    while (stack.length) {
      const p = stack.pop()!;
      data[p * 4 + 3] = 0;
      const x = p % w;
      if (x > 0) seed(p - 1);
      if (x < w - 1) seed(p + 1);
      if (p >= w) seed(p - w);
      if (p < w * (h - 1)) seed(p + w);
    }
  }
  // Feather the edge: an edge pixel (opaque, next to a transparent one) gets half alpha.
  const a0 = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) a0[p] = data[p * 4 + 3];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (!a0[p]) continue;
      const edge = (x > 0 && !a0[p - 1]) || (x < w - 1 && !a0[p + 1]) || (y > 0 && !a0[p - w]) || (y < h - 1 && !a0[p + w]);
      if (edge) data[p * 4 + 3] = Math.round(a0[p] / 2);
    }
  return sharp(data, { raw: { width: w, height: h, channels: 4 } }).trim({ threshold: 1 }).png().toBuffer();
}

/** The hero still: canvas-sized JPEG of the packshot over the blurred, darkened last shot, with a soft contact shadow. */
export async function composeCtaHero(input: { packshot: Buffer; background: Buffer; canvas: { w: number; h: number } }): Promise<Buffer> {
  const { w, h } = input.canvas;
  const layout = h / w > 1.5 ? HERO_LAYOUT.vertical : HERO_LAYOUT.other;
  const bg = await sharp(input.background, { failOn: "none" })
    .rotate()
    .resize(w, h, { fit: "cover" })
    .blur(Math.max(4, Math.round(Math.min(w, h) * 0.03)))
    .modulate({ brightness: 0.78, saturation: 0.85 })
    .toBuffer();
  const cut = await cutOutPackshot(input.packshot);
  const fg = await sharp(cut)
    .resize({ width: Math.round(w * layout.maxWidth), height: Math.round(h * layout.height), fit: "inside" })
    .png()
    .toBuffer();
  const m = await sharp(fg).metadata();
  const pw = m.width ?? 1;
  const ph = m.height ?? 1;
  const left = Math.round((w - pw) / 2);
  const top = Math.round(h * layout.y - ph / 2);
  // Contact shadow: a dark ellipse under the product, heavily blurred.
  const sw = Math.round(pw * 1.1);
  const sh = Math.max(4, Math.round(ph * 0.08));
  const shadow = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${sw + 40}" height="${sh + 40}"><ellipse cx="${(sw + 40) / 2}" cy="${(sh + 40) / 2}" rx="${sw / 2}" ry="${sh / 2}" fill="black" fill-opacity="0.45"/></svg>`))
    .blur(8)
    .png()
    .toBuffer();
  return sharp(bg)
    .composite([
      { input: shadow, left: Math.max(0, Math.round((w - sw - 40) / 2)), top: Math.max(0, Math.min(h - sh - 40, top + ph - Math.round(sh / 2) - 20)) },
      { input: fg, left: Math.max(0, left), top: Math.max(0, top) },
    ])
    .jpeg({ quality: 92 })
    .toBuffer();
}
