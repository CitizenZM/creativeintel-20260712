/**
 * Platform safe box for the v2 edit's readable layers (captions, hook headline, claims, offer pill,
 * end-card layers, fine print, CTA button). The box comes from the platform profile's safe zone
 * (creative/platforms.data.ts, scaled the same way the pre-flight scorer measures it), so TikTok's
 * right rail (x > 940 on 1080 wide) and the bottom UI stay clear. Text renderers wrap to the box
 * width (textCanvas → safeW); anything still too wide or tall is shrunk, then centred in the box.
 *
 * Without a platform the box is the whole frame: the layout is exactly today's (centred on the
 * frame, nothing resized).
 */
import type { PlatformId } from "@/services/creative/types";
import { safeRect } from "../preflight/score";

type Canvas = { w: number; h: number };

export interface LayoutBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** The text-safe box in canvas pixels; `inset` (share of the width) tightens it on every side. */
export function layoutBox(canvas: Canvas, platform?: PlatformId | null, inset = 0): LayoutBox {
  const base = platform ? safeRect(platform, canvas) : { x: 0, y: 0, w: canvas.w, h: canvas.h };
  const d = Math.round(Math.max(0, inset) * canvas.w);
  return { left: base.x + d, right: base.x + base.w - d, top: base.y + d, bottom: base.y + base.h - d };
}

/** The canvas the text renderers see: `safeW` caps every wrap width (absent on the full-frame box). */
export function textCanvas(canvas: Canvas, box: LayoutBox): Canvas & { safeW?: number } {
  const safeW = box.right - box.left;
  return safeW < canvas.w ? { w: canvas.w, h: canvas.h, safeW } : { w: canvas.w, h: canvas.h };
}

/**
 * Where a layer of `size` goes: scale ≤ 1 so it fits the box, horizontal centre of the box (px),
 * and its vertical centre (share of the height) moved inside the box when it would cross an edge.
 */
export function placeLayer(size: { w: number; h: number }, y: number, box: LayoutBox, canvas: Canvas): { scale: number; cx: number; y: number } {
  const bw = box.right - box.left;
  const bh = box.bottom - box.top;
  const scale = Math.min(1, bw / Math.max(1, size.w), bh / Math.max(1, size.h));
  const h = size.h * scale;
  const centre = Math.min(Math.max(y * canvas.h, box.top + h / 2), box.bottom - h / 2);
  const yy = Math.abs(centre - y * canvas.h) < 0.5 ? y : Math.round((centre / canvas.h) * 10000) / 10000;
  return { scale: Math.round(scale * 10000) / 10000, cx: Math.round((box.left + box.right) / 2), y: yy };
}

/** placeLayer on a PNG: the (possibly downscaled) PNG with its centre x and y. */
export async function fitLayerPng(png: Buffer, y: number, box: LayoutBox, canvas: Canvas): Promise<{ png: Buffer; cx: number; y: number }> {
  const sharp = (await import("sharp")).default;
  const m = await sharp(png).metadata();
  const p = placeLayer({ w: m.width ?? 1, h: m.height ?? 1 }, y, box, canvas);
  if (p.scale >= 0.9999) return { png, cx: p.cx, y: p.y };
  const w = Math.max(2, Math.floor((m.width ?? 1) * p.scale));
  return { png: await sharp(png).resize({ width: w }).png().toBuffer(), cx: p.cx, y: p.y };
}

/** Which layers move off which (and which way first) when they share the screen. */
const SEPARATE: { role: string; off: string[]; prefer: "below" | "above"; gapH?: number }[] = [
  // A caption butting a headline (23 px on the live talking-head test) reads as one crammed block: keep ~3% clear.
  { role: "caption", off: ["hook", "claim"], prefer: "below", gapH: 0.03 },
  // Wrapped to the safe width, legal fine print can grow into the CTA button under it.
  { role: "fine", off: ["cta"], prefer: "above" },
];

/**
 * Captions never sit on a hook headline or claim shown at the same time (they move just below it, above
 * when the safe box has no room), and fine print never runs into the CTA button (it moves up). Returns
 * the new vertical centres (share of the height), one per item; everything else keeps its own. Pure.
 */
export function separateCaptions(
  items: { role?: string; y: number; h: number; startSec: number; endSec: number }[],
  canvas: Canvas,
  box: LayoutBox,
  gap = Math.round(canvas.h * 0.012)
): number[] {
  return items.map((it) => {
    const rule = SEPARATE.find((r) => r.role === it.role);
    if (!rule) return it.y;
    let c = it.y * canvas.h;
    const g = rule.gapH ? Math.max(gap, Math.round(canvas.h * rule.gapH)) : gap;
    for (const card of items.filter((i) => rule.off.includes(i.role ?? ""))) {
      if (card.startSec >= it.endSec || card.endSec <= it.startSec) continue;
      const top = card.y * canvas.h - card.h / 2;
      const bottom = card.y * canvas.h + card.h / 2;
      if (c + it.h / 2 + g <= top || c - it.h / 2 - g >= bottom) continue;
      const below = bottom + g + it.h / 2;
      const above = top - g - it.h / 2;
      const fitsBelow = below + it.h / 2 <= box.bottom;
      const fitsAbove = above - it.h / 2 >= box.top;
      c = rule.prefer === "below" ? (fitsBelow || !fitsAbove ? below : above) : fitsAbove || !fitsBelow ? above : below;
    }
    return Math.abs(c - it.y * canvas.h) < 0.5 ? it.y : Math.round((c / canvas.h) * 10000) / 10000;
  });
}
