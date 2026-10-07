/**
 * Smart segment selection: the hook gets the most dynamic second of each clip.
 * Motion is ffmpeg's per-frame scene-change score on a small decode; the
 * window with the most movement wins (a generated clip often idles at its
 * start while the model "warms up", and that is exactly what the hook must not show).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";

const run = promisify(execFile);

/** Per-frame motion scores (0..1) for the first `maxSec` seconds of a clip. */
export async function motionScores(file: string, maxSec = 10): Promise<{ fps: number; scores: number[] }> {
  if (!ffmpegPath) return { fps: 30, scores: [] };
  const { stderr } = await run(
    ffmpegPath,
    ["-hide_banner", "-nostats", "-t", String(maxSec), "-i", file, "-vf", "fps=15,scale=160:-2,select='gte(scene,0)',metadata=print", "-an", "-f", "null", "-"],
    { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 }
  ).catch((e: { stderr?: string }) => ({ stderr: e.stderr ?? "" }));
  const scores = [...String(stderr).matchAll(/lavfi\.scene_score=([\d.]+)/g)].map((m) => Number(m[1]));
  return { fps: 15, scores };
}

/**
 * Start (seconds) of the `windowSec` window with the most motion, inside the
 * clip. Ties keep the earliest start; with no motion data, `fallback`.
 */
export function bestWindow(scores: number[], fps: number, windowSec: number, clipSec: number, fallback = 0): number {
  const w = Math.max(1, Math.round(windowSec * fps));
  const usable = Math.min(scores.length, Math.floor(clipSec * fps));
  if (usable < w) return fallback;
  let sum = 0;
  for (let i = 0; i < w; i++) sum += scores[i];
  let best = sum;
  let bestStart = 0;
  for (let i = w; i < usable; i++) {
    sum += scores[i] - scores[i - w];
    if (sum > best + 1e-9) {
      best = sum;
      bestStart = i - w + 1;
    }
  }
  return best <= 1e-6 ? fallback : Math.round((bestStart / fps) * 1000) / 1000;
}

// ─── Product reframe ──────────────────────────────────────────────────────────

type BBox = [number, number, number, number];

/**
 * The reframe rule (first live run: at 12.5 s the tablet sat small in the lower-right corner and the
 * edit's punch-in cropped it away): the product sits centred (± tolerance) and fills at least
 * `minHeight` of the frame height, never more than `maxHeight`, within `maxZoom`.
 */
export const REFRAME = { minHeight: 0.35, maxHeight: 0.9, maxZoom: 1.8, tolerance: 0.06 };

export interface Reframe {
  zoom: number;
  /** Crop centre in source fractions (clamped so the crop stays inside the source). */
  cx: number;
  cy: number;
  /** Product centre in the output frame (0–1). */
  out: { x: number; y: number };
  /** Product height as a share of the output frame. */
  productH: number;
}

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

/** Visible share of the source (width, height) at zoom 1 when it covers the canvas. */
function visible(srcAspect: number, canvasAspect: number): { vx: number; vy: number } {
  return srcAspect > canvasAspect ? { vx: canvasAspect / srcAspect, vy: 1 } : { vx: 1, vy: srcAspect / canvasAspect };
}

function frameAt(box: BBox, z: number, vis: { vx: number; vy: number }): Reframe {
  const vx = vis.vx / z;
  const vy = vis.vy / z;
  const bx = (box[0] + box[2]) / 2;
  const by = (box[1] + box[3]) / 2;
  const x0 = clamp(bx - vx / 2, 0, 1 - vx);
  const y0 = clamp(by - vy / 2, 0, 1 - vy);
  return { zoom: z, cx: x0 + vx / 2, cy: y0 + vy / 2, out: { x: (bx - x0) / vx, y: (by - y0) / vy }, productH: (box[3] - box[1]) / vy };
}

/**
 * Zoom and crop centre that put the product (box in source fractions) centred at ≥ 35 % of the frame
 * height. Starts from the shot's own zoom (a punch-in stays a punch-in, now on the product) and only
 * zooms further when the size or the centring needs it; a product that would overflow pulls back.
 */
export function productReframe(box: BBox, opts: { canvasAspect: number; srcAspect?: number; baseZoom?: number }): Reframe {
  const vis = visible(opts.srcAspect ?? opts.canvasAspect, opts.canvasAspect);
  const bh = Math.max(1e-3, box[3] - box[1]);
  const bw = Math.max(1e-3, box[2] - box[0]);
  // Largest zoom that still shows the whole product (with a margin).
  const fit = Math.max(1, Math.min(REFRAME.maxZoom, (REFRAME.maxHeight * vis.vy) / bh, (0.95 * vis.vx) / bw));
  const base = clamp(opts.baseZoom ?? 1, 1, fit);
  const ok = (r: Reframe) => r.productH >= REFRAME.minHeight - 1e-9 && Math.abs(r.out.x - 0.5) <= REFRAME.tolerance + 1e-9 && Math.abs(r.out.y - 0.5) <= REFRAME.tolerance + 1e-9;
  for (let z = base; z <= fit + 1e-9; z += 0.01) {
    const r = frameAt(box, Math.round(z * 100) / 100, vis);
    if (ok(r)) return r;
  }
  return frameAt(box, Math.round(fit * 100) / 100, vis);
}

/** A clip's reframe: one zoom for the whole shot (no zoom pumping), the crop moving from the start keyframe's box to the end's. */
export function reframeTrack(
  box: { start: BBox | null; end?: BBox | null; present?: boolean | null } | null | undefined,
  opts: { canvasAspect: number; srcAspect?: number; baseZoom?: number }
): { zoom: number; from: Reframe; to: Reframe } | null {
  if (!box || box.present === false) return null;
  const a = box.start ?? box.end ?? null;
  const b = box.end ?? box.start ?? null;
  if (!a || !b) return null;
  const vis = visible(opts.srcAspect ?? opts.canvasAspect, opts.canvasAspect);
  const za = productReframe(a, opts).zoom;
  const zb = productReframe(b, opts).zoom;
  const fit = (bx: BBox) => Math.max(1, Math.min(REFRAME.maxZoom, (REFRAME.maxHeight * vis.vy) / Math.max(1e-3, bx[3] - bx[1]), (0.95 * vis.vx) / Math.max(1e-3, bx[2] - bx[0])));
  const zoom = Math.round(Math.min(Math.max(za, zb), fit(a), fit(b)) * 100) / 100;
  return { zoom, from: frameAt(a, zoom, vis), to: frameAt(b, zoom, vis) };
}
