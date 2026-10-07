/** Template boxes (safe-rect fractions) → pixel boxes on a format. Pure. */
import type { AdFormat, ColorToken, ImageRole, Layout, Panel, Rect, Role, TextRole } from "./types";

export const TEXT_ROLES: TextRole[] = ["logo", "headline", "sub", "badge", "cta", "bullets", "rating", "quote", "tag", "deadline"];
export const IMAGE_ROLES: ImageRole[] = ["product", "before", "after"];
const ORDER: Role[] = [...IMAGE_ROLES, ...TEXT_ROLES];

export interface PlacedBox extends Rect {
  role: Role;
}

export function toPixels(r: Rect, f: AdFormat): Rect {
  return { x: f.safe.x + r.x * f.safe.w, y: f.safe.y + r.y * f.safe.h, w: r.w * f.safe.w, h: r.h * f.safe.h };
}

/** Every role box of a layout in pixels, imagery first (drawn underneath). */
export function resolveLayout(layout: Layout, f: AdFormat): PlacedBox[] {
  return ORDER.filter((role) => layout[role]).map((role) => ({ role, ...toPixels(layout[role] as Rect, f) }));
}

/** Decorative panels; an edge at the safe rect's border bleeds to the canvas edge. */
export function resolvePanels(panels: Panel[] | undefined, f: AdFormat): (Rect & { color: ColorToken; radius: number })[] {
  return (panels ?? []).map((p) => {
    const r = toPixels(p.box, f);
    const x0 = p.box.x <= 0 ? 0 : r.x;
    const y0 = p.box.y <= 0 ? 0 : r.y;
    const x1 = p.box.x + p.box.w >= 1 ? f.w : r.x + r.w;
    const y1 = p.box.y + p.box.h >= 1 ? f.h : r.y + r.h;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, color: p.color, radius: p.radius ?? 0 };
  });
}

/** Strict overlap (touching edges don't count). */
export function overlaps(a: Rect, b: Rect): boolean {
  const eps = 0.5;
  return a.x + eps < b.x + b.w && b.x + eps < a.x + a.w && a.y + eps < b.y + b.h && b.y + eps < a.y + a.h;
}

export const round = (r: Rect): Rect => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.max(1, Math.floor(r.w)), h: Math.max(1, Math.floor(r.h)) });
