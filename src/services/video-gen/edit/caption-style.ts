/**
 * Caption looks for the v2 edit:
 *   kinetic  the default — 2–3 upper-case words at a time, the spoken word in the brand highlight
 *   native   creator-native (TikTok / Reels / Shorts): white bold sentence-case text with a black stroke,
 *            word-by-word highlight in the platform's yellow, at most 2 lines, centred on y 0.62 and kept
 *            inside the strict safe box (on 1080×1920: y 288–1220, x 65–940 — TikTok's right rail)
 * The native look is picked automatically when the platform profile's caption style says native/creator.
 */
export type CaptionStyle = "native" | "kinetic";

export const NATIVE_CAPTION = {
  /** Platform accent for the active word (TikTok's caption yellow). */
  accent: "#FFE500",
  yCenter: 0.62,
  /** On the 1080×1920 reference canvas. */
  safe: { x0: 65, x1: 940, y0: 288, y1: 1220 },
  maxLines: 2,
} as const;

/** Native captions when the platform profile's caption brief says native / creator captions. */
export function captionStyleFor(platformCaptionStyle: string | null | undefined): CaptionStyle {
  return /\b(native|creator)\b/i.test(platformCaptionStyle ?? "") ? "native" : "kinetic";
}

/** The safe box scaled to the canvas: TikTok's strict box on vertical canvases, a 6 % / 10 % inset otherwise. */
export function nativeSafeBox(canvas: { w: number; h: number }): { x0: number; x1: number; y0: number; y1: number } {
  if (canvas.h / canvas.w > 1.5) {
    const sx = canvas.w / 1080;
    const sy = canvas.h / 1920;
    const s = NATIVE_CAPTION.safe;
    return { x0: Math.round(s.x0 * sx), x1: Math.round(s.x1 * sx), y0: Math.round(s.y0 * sy), y1: Math.round(s.y1 * sy) };
  }
  return { x0: Math.round(canvas.w * 0.06), x1: Math.round(canvas.w * 0.94), y0: Math.round(canvas.h * 0.1), y1: Math.round(canvas.h * 0.9) };
}

/** Top-left of a w×h caption: centred in the box horizontally, on y 0.62 vertically, clamped inside the box. */
export function nativeCaptionBox(canvas: { w: number; h: number }, w: number, h: number): { x: number; y: number } {
  const b = nativeSafeBox(canvas);
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  return {
    x: Math.round(clamp((b.x0 + b.x1) / 2 - w / 2, b.x0, b.x1 - w)),
    y: Math.round(clamp(NATIVE_CAPTION.yCenter * canvas.h - h / 2, b.y0, b.y1 - h)),
  };
}
