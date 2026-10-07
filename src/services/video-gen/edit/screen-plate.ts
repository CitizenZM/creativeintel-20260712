/**
 * Screen plates — real, readable content on the screens of AI-generated devices.
 *
 * Video models cannot draw a crisp Van Gogh on a frame TV, sheet music on a
 * tablet or a sharp HDR picture: the screen content comes out mushy, wrong or
 * fake-looking. So the director keeps the screen a plain colour in the video
 * prompt (pure green #00FF00 best, or black). The edit engine then puts the
 * real content images onto the screen, following the screen as it moves.
 *
 *   plate = {
 *     contents: [{ path: "sunflowers.jpg", fromSec: 0 }, { url: "https://…/score.png", fromSec: 2, transition: "fade" }],
 *     firstLast: [quadAtClipStart, quadAtClipEnd],   // or track: [{ t, quad }, …], or detect: "key" | "vision"
 *     key: "#00FF00",                                // the screen was generated as a green key
 *   }
 *
 * Quad = the screen's four inner (glass) corners TL, TR, BR, BL, normalised 0–1 of the frame, in the
 * source clip's own time (t = seconds from the clip's first frame, before any trim or speed change).
 *
 * Where the track comes from:
 *   track      exact keys from the locked script (piecewise-linear between keys)
 *   firstLast  the planner states the corners on the first and last keyframe → linear in between
 *   detect     "key": free local detection of the key-coloured screen on frames sampled every 0.5 s
 *              (detectKeyedQuad); "vision": a vision model reads the corners on the first and last
 *              frame (detectScreenQuad), then a free local edge snap places them exactly on the bezel
 * How it is composited (screenPlateFilter, one ffmpeg graph):
 *   content timeline (cut / fade / wipe at fromSec, xfade) → faint glare → feathered alpha edge →
 *   perspective warp onto the quad (sense=destination, eval=frame, corners piecewise-linear in time)
 *   overlay: the warped content is laid over the clip
 *   key:     the clip's key colour is made transparent and the warped content sits underneath, so a hand
 *            or a finger passing in front of the screen stays in front (default for chroma keys)
 * render-v2 applies plates to the source clips before the edit (applyScreenPlates), so reframing,
 * punch-ins, speed ramps, text and end cards all sit on top of the composited footage.
 */
import { execFile } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { z } from "zod";

const run = promisify(execFile);

export type Point = [number, number];
/** TL, TR, BR, BL — normalised 0–1 of the frame. */
export type Quad = [Point, Point, Point, Point];
export type PlateTransition = "cut" | "fade" | "wipe";

export interface PlateContent {
  url?: string;
  path?: string;
  /** Clip time (s) at which this content is fully on screen. The first content always starts at 0. */
  fromSec: number;
  /** How it replaces the previous content (default cut). */
  transition?: PlateTransition;
}

export interface TrackKey {
  t: number;
  quad: Quad;
}

export interface ScreenPlate {
  contents: PlateContent[];
  /** Explicit keys in clip time. */
  track?: TrackKey[];
  /** The screen corners on the clip's first and last frame (linear in between). */
  firstLast?: [Quad, Quad];
  /** No track given: find it on the clip's own frames. */
  detect?: "key" | "vision";
  /** "overlay" lays the content over the clip; "key" keys the screen colour out and puts the content under it. */
  mode?: "overlay" | "key";
  /** The flat colour the screen was generated in, e.g. "#00FF00" or "#000000". */
  key?: string;
  /** How the content fills the screen (default cover). */
  fit?: "cover" | "contain";
  /** Screen width / height in its own plane (TV 16/9). Default: estimated from the first quad. */
  aspect?: number;
  /** Glass sheen strength 0–1 (default 0.06). */
  glare?: number;
  /** Soft edge in output pixels (default 1.5). */
  feather?: number;
  /** How far (px) the content runs past the stated screen edge onto the bezel / under the key, so no
   *  sliver of the original screen shows (default 2 for overlay, 3 px + 1 % of the screen for key). */
  bleed?: number;
  /** Easing between track keys (default linear — correct for tracked motion). */
  ease?: "linear" | "smooth";
}

export const PLATE_FPS = 30;
const TRANSITION_SEC: Record<PlateTransition, number> = { cut: 1 / PLATE_FPS, fade: 0.4, wipe: 0.5 };
const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

// ---------------------------------------------------------------- geometry

/** Homography taking the unit square (u, v) onto the quad: returns (u, v) → [x, y] in the quad's units. */
export function homography(q: Quad): (u: number, v: number) => Point {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q; // TL TR BR BL ↔ (0,0) (1,0) (1,1) (0,1)
  const sx = x0 - x1 + x2 - x3;
  const sy = y0 - y1 + y2 - y3;
  let a: number, b: number, d: number, e: number, g: number, h: number;
  if (Math.abs(sx) < 1e-12 && Math.abs(sy) < 1e-12) {
    a = x1 - x0; b = x2 - x1; d = y1 - y0; e = y2 - y1; g = 0; h = 0;
  } else {
    const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
    const den = dx1 * dy2 - dx2 * dy1;
    g = (sx * dy2 - dx2 * sy) / den;
    h = (dx1 * sy - sx * dy1) / den;
    a = x1 - x0 + g * x1; b = x3 - x0 + h * x3;
    d = y1 - y0 + g * y1; e = y3 - y0 + h * y3;
  }
  return (u, v) => {
    const w = g * u + h * v + 1;
    return [(a * u + b * v + x0) / w, (d * u + e * v + y0) / w];
  };
}

export function quadCentroid(q: Quad): Point {
  return [(q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4];
}

/** Grow a quad (pixel units) by about `px` on every side. */
export function expandQuad(q: Quad, px: number): Quad {
  const [cx, cy] = quadCentroid(q);
  return q.map(([x, y]) => {
    const dx = x - cx, dy = y - cy;
    const len = Math.hypot(dx, dy) || 1;
    const k = px * Math.SQRT2;
    return [x + (dx / len) * k, y + (dy / len) * k];
  }) as Quad;
}

/** Point-in-convex-quad (any winding). */
export function insideQuad(q: Quad, x: number, y: number): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = q[i];
    const [bx, by] = q[(i + 1) % 4];
    const c = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (c !== 0) {
      if (sign === 0) sign = Math.sign(c);
      else if (Math.sign(c) !== sign) return false;
    }
  }
  return true;
}

function validQuad(q: Quad): boolean {
  if (!q.every((p) => p.every((v) => Number.isFinite(v)))) return false;
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = q[i], [bx, by] = q[(i + 1) % 4], [cx, cy] = q[(i + 2) % 4];
    const c = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    if (Math.abs(c) < 1e-9) return false;
    if (sign === 0) sign = Math.sign(c);
    else if (Math.sign(c) !== sign) return false;
  }
  return true;
}

/** Order four points TL, TR, BR, BL (clockwise on screen, starting nearest the top-left). */
export function orderQuad(pts: Point[]): Quad {
  const cx = pts.reduce((n, p) => n + p[0], 0) / pts.length;
  const cy = pts.reduce((n, p) => n + p[1], 0) / pts.length;
  const s = [...pts].sort((p, q) => Math.atan2(p[1] - cy, p[0] - cx) - Math.atan2(q[1] - cy, q[0] - cx));
  let first = 0;
  s.forEach((p, i) => { if (p[0] + p[1] < s[first][0] + s[first][1]) first = i; });
  return [0, 1, 2, 3].map((k) => s[(first + k) % 4]) as Quad;
}

// ---------------------------------------------------------------- track

/** The plate's keyframes in clip time, sorted (firstLast spans the whole clip). */
export function resolveTrack(plate: Pick<ScreenPlate, "track" | "firstLast">, clipDurSec: number): TrackKey[] {
  if (plate.track?.length) {
    return [...plate.track].map((k) => ({ t: Math.min(Math.max(0, k.t), Math.max(0, clipDurSec)), quad: k.quad })).sort((a, b) => a.t - b.t);
  }
  if (plate.firstLast) return [{ t: 0, quad: plate.firstLast[0] }, { t: Math.max(0, clipDurSec), quad: plate.firstLast[1] }];
  throw new Error("screen plate has no track: give track, firstLast or detect");
}

const easeOf = (p: number, ease: ScreenPlate["ease"]) => (ease === "smooth" ? p * p * (3 - 2 * p) : p);

/** The quad at clip time t (same interpolation as the ffmpeg expressions). */
export function quadAt(track: TrackKey[], t: number, ease: ScreenPlate["ease"] = "linear"): Quad {
  return track[0].quad.map((_, c) =>
    [0, 1].map((ax) => {
      let v = track[0].quad[c][ax];
      for (let i = 0; i + 1 < track.length; i++) {
        const dt = track[i + 1].t - track[i].t;
        const p = dt <= 0 ? (t >= track[i + 1].t ? 1 : 0) : Math.min(1, Math.max(0, (t - track[i].t) / dt));
        v += (track[i + 1].quad[c][ax] - track[i].quad[c][ax]) * easeOf(p, ease);
      }
      return v;
    })
  ) as Quad;
}

/** One corner coordinate as an ffmpeg expression of the frame number `in` (piecewise-linear in time). */
export function cornerExpr(track: TrackKey[], corner: number, axis: 0 | 1, size: number, ease: ScreenPlate["ease"] = "linear", fps = PLATE_FPS): string {
  const v0 = track[0].quad[corner][axis] * size;
  let out = fmt(v0);
  const T = `(in/${fps})`;
  for (let i = 0; i + 1 < track.length; i++) {
    const dv = (track[i + 1].quad[corner][axis] - track[i].quad[corner][axis]) * size;
    if (Math.abs(dv) < 1e-4) continue;
    const dt = Math.max(1e-3, track[i + 1].t - track[i].t);
    const p = `clip((${T}-${fmt(track[i].t)})/${fmt(dt)},0,1)`;
    const e = ease === "smooth" ? `(${p}*${p}*(3-2*${p}))` : p;
    out += `${dv < 0 ? "-" : "+"}${fmt(Math.abs(dv))}*${e}`;
  }
  return out;
}

// ---------------------------------------------------------------- filter

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`bad key colour ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** A saturated key (green / blue / magenta) — safe to key out; black and white are not. */
export function isChromaKey(hex: string): boolean {
  const [r, g, b] = hexToRgb(hex);
  return Math.max(r, g, b) - Math.min(r, g, b) > 120;
}

export function plateMode(plate: ScreenPlate): "overlay" | "key" {
  return plate.mode ?? (plate.key && isChromaKey(plate.key) ? "key" : "overlay");
}

function edgeLen(q: Quad, i: number, w: number, h: number): number {
  const [a, b] = [q[i], q[(i + 1) % 4]];
  return Math.hypot((b[0] - a[0]) * w, (b[1] - a[1]) * h);
}

/** ffmpeg input args for the plate's content images (inputs inputIndexBase … in this order; the filter loops them). */
export function screenPlateInputArgs(contentFiles: string[]): string[] {
  return contentFiles.flatMap((f) => ["-i", f]);
}

/**
 * filter_complex fragment compositing the plate onto a clip. The clip's video is `opts.inLabel`
 * (default [0:v]); the content images are inputs inputIndexBase… (screenPlateInputArgs); the result
 * is `opts.outLabel` (default [sp]) in yuv420p at the plate frame rate, timestamps from 0.
 */
export function screenPlateFilter(
  plate: ScreenPlate,
  clipW: number,
  clipH: number,
  clipDurSec: number,
  inputIndexBase: number,
  opts: { inLabel?: string; outLabel?: string; fps?: number } = {}
): string {
  const fps = opts.fps ?? PLATE_FPS;
  const inLabel = opts.inLabel ?? "[0:v]";
  const outLabel = opts.outLabel ?? "[sp]";
  const W = clipW, H = clipH;
  const D = Math.max(clipDurSec, 1 / fps);
  const track = resolveTrack(plate, D);
  if (!plate.contents.length) throw new Error("screen plate has no content");
  const mode = plateMode(plate);
  // The content runs a little past the screen edge so no sliver of the generated screen peeks out
  // (on the bezel in overlay mode — 2 px is invisible there; under the key in key mode).
  const bleedOf = (q: Quad) => plate.bleed ?? (mode === "key" ? 3 + 0.01 * Math.min(edgeLen(q, 0, W, H), edgeLen(q, 1, W, H)) : 2);
  const keyed = track.map((k) => ({ t: k.t, quad: bleedOf(k.quad) > 0 ? normQuad(expandQuad(pxQuad(k.quad, W, H), bleedOf(k.quad)), W, H) : k.quad }));
  const q0 = track[0].quad;
  const qw = (edgeLen(q0, 0, W, H) + edgeLen(q0, 2, W, H)) / 2;
  const qh = (edgeLen(q0, 1, W, H) + edgeLen(q0, 3, W, H)) / 2;
  const aspect = plate.aspect ?? qw / Math.max(1, qh);
  const L = Math.max(W, H);
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  const [cw, ch] = aspect >= 1 ? [even(L), even(L / aspect)] : [even(L * aspect), even(L)];
  const fit = plate.fit ?? "cover";
  const contents = [...plate.contents].sort((a, b) => a.fromSec - b.fromSec).filter((c, i) => i === 0 || c.fromSec < D);
  const parts: string[] = [];

  // Every content image is prepared ONCE (fit, stretch to the frame, glass sheen, feathered alpha) and
  // the finished frame is looped — per frame only the crossfade, the warp and the overlay run.
  const n = contents.length;
  const loops = Math.ceil((D + 1) * fps);
  // Feathered alpha: the outermost ring is fully transparent, so the warp (which clamps at the edges)
  // leaves everything outside the quad clear; the ramp is ≈ `feather` px on screen.
  const feather = Math.max(0.5, plate.feather ?? 1.5);
  const fx = Math.max(1, (feather * W) / Math.max(1, qw));
  const fy = Math.max(1, (feather * H) / Math.max(1, qh));
  const one = `color=c=black:s=${W}x${H}:r=${fps}:d=${fmt(1 / fps)}`;
  parts.push(`${one},format=gray,geq=lum='255*clip(min((min(X,W-1-X)-0.5)/${fmt(fx)},(min(Y,H-1-Y)-0.5)/${fmt(fy)}),0,1)'${n > 1 ? `,split=${n}${contents.map((_, i) => `[spm${i}]`).join("")}` : "[spm0]"}`);
  // Glass: a faint diagonal sheen and a soft top-to-bottom falloff.
  const glare = Math.min(1, Math.max(0, plate.glare ?? 0.06));
  if (glare > 0) {
    parts.push(`${one},format=rgba,geq=r=255:g=255:b=255:a='${fmt(255 * glare)}*(0.75*exp(-pow(X/W*0.7+Y/H*0.45-0.42,2)/0.006)+0.35*(1-Y/H))'${n > 1 ? `,split=${n}${contents.map((_, i) => `[spg${i}]`).join("")}` : "[spg0]"}`);
  }
  contents.forEach((_, i) => {
    const sized = fit === "cover"
      ? `scale=${cw}:${ch}:force_original_aspect_ratio=increase,crop=${cw}:${ch}`
      : `scale=${cw}:${ch}:force_original_aspect_ratio=decrease,pad=${cw}:${ch}:(ow-iw)/2:(oh-ih)/2:black`;
    parts.push(`[${inputIndexBase + i}:v]select=eq(n\\,0),${sized},scale=${W}:${H},setsar=1,format=yuv444p[spi${i}]`);
    const lit = glare > 0 ? `[spi${i}][spg${i}]overlay=format=yuv444,` : `[spi${i}]`;
    parts.push(`${lit}format=yuva444p[spa${i}]`);
    parts.push(`[spa${i}][spm${i}]alphamerge,loop=loop=${loops}:size=1:start=0,setpts=N/${fps}/TB,fps=${fps}[spc${i}]`);
  });
  // Content timeline: cut / fade / wipe at each fromSec.
  let cur = "[spc0]";
  contents.slice(1).forEach((c, k) => {
    const i = k + 1;
    const tr = c.transition ?? "cut";
    const d = TRANSITION_SEC[tr];
    const offset = Math.max(1 / fps, c.fromSec - (tr === "cut" ? 0 : d / 2));
    parts.push(`${cur}[spc${i}]xfade=transition=${tr === "wipe" ? "wipeleft" : "fade"}:duration=${fmt(d)}:offset=${fmt(offset)}[spx${i}]`);
    cur = `[spx${i}]`;
  });
  parts.push(`${cur}trim=duration=${fmt(D + 1 / fps)},setpts=PTS-STARTPTS[spca]`);

  // 4. Warp onto the moving quad (perspective corner order: TL, TR, BL, BR).
  const order: [number, string, string][] = [[0, "x0", "y0"], [1, "x1", "y1"], [3, "x2", "y2"], [2, "x3", "y3"]];
  const corners = order.map(([c, xn, yn]) => `${xn}='${cornerExpr(keyed, c, 0, W, plate.ease, fps)}':${yn}='${cornerExpr(keyed, c, 1, H, plate.ease, fps)}'`).join(":");
  parts.push(`[spca]perspective=${corners}:interpolation=linear:sense=destination:eval=frame[spw]`);

  // 5. Composite.
  parts.push(`${inLabel}fps=${fps},setpts=PTS-STARTPTS,format=yuv444p[spclip]`);
  if (mode === "key") {
    const [r, g, b] = hexToRgb(plate.key ?? "#00FF00");
    const chroma = isChromaKey(plate.key ?? "#00FF00");
    const sim = chroma ? 0.33 : 0.1;
    const blend = chroma ? 0.08 : 0.04;
    const hex = `0x${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
    parts.push(`[spclip]split=2[spa][spb]`);
    parts.push(`[spb]colorkey=${hex}:${sim}:${blend}[spk]`);
    parts.push(`[spa][spw]overlay=0:0:format=yuv444:eof_action=pass[spu]`);
    parts.push(`[spu][spk]overlay=0:0:format=yuv444,format=yuv420p${outLabel}`);
  } else {
    parts.push(`[spclip][spw]overlay=0:0:format=yuv444:eof_action=pass,format=yuv420p${outLabel}`);
  }
  return parts.join(";");
}

const pxQuad = (q: Quad, w: number, h: number) => q.map(([x, y]) => [x * w, y * h]) as Quad;
const normQuad = (q: Quad, w: number, h: number) => q.map(([x, y]) => [x / w, y / h]) as Quad;

// ---------------------------------------------------------------- local key detector

/**
 * Find the screen generated as a flat key colour: the largest connected key-coloured region, its
 * boundary reduced to four corners, each side then re-fitted as a straight line through the boundary.
 * Free and local. Returns null when no region covers at least `minArea` of the frame.
 */
export async function detectKeyedQuad(
  framePath: string | Buffer,
  key = "#00FF00",
  opts: { tolerance?: number; minArea?: number } = {}
): Promise<Quad | null> {
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(framePath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels } = info;
  const [kr, kg, kb] = hexToRgb(key);
  const tol = (opts.tolerance ?? (isChromaKey(key) ? 0.35 : 0.12)) * 441.7;
  const tol2 = tol * tol;
  const mask = new Uint8Array(W * H);
  for (let i = 0, p = 0; i < W * H; i++, p += channels) {
    const dr = data[p] - kr, dg = data[p + 1] - kg, db = data[p + 2] - kb;
    if (dr * dr + dg * dg + db * db <= tol2) mask[i] = 1;
  }
  // Largest 4-connected component.
  const seen = new Uint8Array(W * H);
  const queue = new Int32Array(W * H);
  let best: Int32Array | null = null;
  for (let s = 0; s < W * H; s++) {
    if (!mask[s] || seen[s]) continue;
    let head = 0, tail = 0;
    queue[tail++] = s;
    seen[s] = 1;
    while (head < tail) {
      const i = queue[head++];
      const x = i % W;
      const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i >= W ? i - W : -1, i < W * (H - 1) ? i + W : -1];
      for (const n of nb) if (n >= 0 && mask[n] && !seen[n]) { seen[n] = 1; queue[tail++] = n; }
    }
    if (!best || tail > best.length) best = queue.slice(0, tail);
  }
  if (!best || best.length < (opts.minArea ?? 0.002) * W * H) return null;
  // Boundary: row and column extremes, at pixel edges.
  const rowMin = new Float64Array(H).fill(Infinity), rowMax = new Float64Array(H).fill(-Infinity);
  const colMin = new Float64Array(W).fill(Infinity), colMax = new Float64Array(W).fill(-Infinity);
  for (const i of best) {
    const x = i % W, y = (i - x) / W;
    if (x < rowMin[y]) rowMin[y] = x;
    if (x > rowMax[y]) rowMax[y] = x;
    if (y < colMin[x]) colMin[x] = y;
    if (y > colMax[x]) colMax[x] = y;
  }
  const boundary: Point[] = [];
  for (let y = 0; y < H; y++) if (rowMin[y] <= rowMax[y]) boundary.push([rowMin[y], y + 0.5], [rowMax[y] + 1, y + 0.5]);
  for (let x = 0; x < W; x++) if (colMin[x] <= colMax[x]) boundary.push([x + 0.5, colMin[x]], [x + 0.5, colMax[x] + 1]);
  const hull = convexHull(boundary);
  if (hull.length < 4) return null;
  const rough = reduceToQuad(hull);
  // Two passes: a wide band around the rough sides (their corners are cut by the reduction), then a tight one.
  let q = rough;
  for (const band of [Math.max(4, 0.015 * Math.hypot(W, H)), 2]) {
    const fitted = refitSides(q, boundary, band);
    if (validQuad(fitted)) q = fitted;
  }
  return normQuad(q, W, H);
}

function convexHull(points: Point[]): Point[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Point[] = [], upper: Point[] = [];
  for (const pt of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop();
    lower.push(pt);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p[i]) <= 0) upper.pop();
    upper.push(p[i]);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Drop the hull vertex that costs the least area until four remain (Visvalingam). */
function reduceToQuad(hull: Point[]): Quad {
  const pts = [...hull];
  const area = (a: Point, b: Point, c: Point) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
  while (pts.length > 4) {
    let k = 0, min = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const a = area(pts[(i - 1 + pts.length) % pts.length], pts[i], pts[(i + 1) % pts.length]);
      if (a < min) { min = a; k = i; }
    }
    pts.splice(k, 1);
  }
  return orderQuad(pts);
}

type Line = { p: Point; d: Point };

function fitLine(points: Point[]): Line | null {
  if (points.length < 3) return null;
  const mx = points.reduce((n, p) => n + p[0], 0) / points.length;
  const my = points.reduce((n, p) => n + p[1], 0) / points.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of points) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my); }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { p: [mx, my], d: [Math.cos(th), Math.sin(th)] };
}

function intersect(a: Line, b: Line): Point | null {
  const den = a.d[0] * b.d[1] - a.d[1] * b.d[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((b.p[0] - a.p[0]) * b.d[1] - (b.p[1] - a.p[1]) * b.d[0]) / den;
  return [a.p[0] + a.d[0] * t, a.p[1] + a.d[1] * t];
}

function linesToQuad(lines: (Line | null)[], fallback: Quad): Quad {
  return fallback.map((c, i) => {
    const a = lines[(i + 3) % 4], b = lines[i];
    const p = a && b ? intersect(a, b) : null;
    return p && Math.hypot(p[0] - c[0], p[1] - c[1]) < 0.15 * Math.max(1, Math.hypot(fallback[2][0] - fallback[0][0], fallback[2][1] - fallback[0][1])) ? p : c;
  }) as Quad;
}

/** Re-fit each side as a line through the boundary points near its middle (rounded corners don't bend it). */
function refitSides(q: Quad, boundary: Point[], band = 3): Quad {
  const lines = [0, 1, 2, 3].map((i) => {
    const a = q[i], b = q[(i + 1) % 4];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 4) return null;
    const d: Point = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const near = boundary.filter(([x, y]) => {
      const s = ((x - a[0]) * d[0] + (y - a[1]) * d[1]) / len;
      const off = Math.abs((x - a[0]) * d[1] - (y - a[1]) * d[0]);
      return s > 0.12 && s < 0.88 && off < band;
    });
    return fitLine(near);
  });
  return linesToQuad(lines, q);
}

// ---------------------------------------------------------------- edge snap

export interface GrayImage { data: Uint8Array | Buffer; width: number; height: number }

/**
 * Snap an approximate quad (pixel units) onto the strongest nearby edges: along each side, search
 * ±radius px across the side for the largest intensity step (Sobel, sub-pixel peak), fit a line
 * through the hits, and intersect neighbouring lines. Corners that would move too far stay put.
 */
export function snapQuadToEdges(img: GrayImage, quad: Quad, opts: { radius?: number; samples?: number } = {}): Quad {
  const { data, width: W, height: H } = img;
  const radius = opts.radius ?? Math.max(4, Math.round(0.02 * Math.min(W, H)));
  const samples = opts.samples ?? 32;
  const at = (x: number, y: number) => data[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))];
  const grad = (fx: number, fy: number): Point => {
    const x = Math.round(fx), y = Math.round(fy);
    const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
    const gy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
    return [gx, gy];
  };
  const lines = [0, 1, 2, 3].map((i) => {
    const a = quad[i], b = quad[(i + 1) % 4];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 8) return null;
    const d: Point = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const n: Point = [-d[1], d[0]];
    const hits: { p: Point; o: number }[] = [];
    for (let k = 0; k < samples; k++) {
      const s = 0.12 + (0.76 * k) / (samples - 1);
      const px = a[0] + (b[0] - a[0]) * s, py = a[1] + (b[1] - a[1]) * s;
      const vals: number[] = [];
      for (let o = -radius; o <= radius; o++) {
        const [gx, gy] = grad(px + n[0] * o, py + n[1] * o);
        vals.push(Math.abs(gx * n[0] + gy * n[1]));
      }
      let m = 0;
      vals.forEach((v, j) => { if (v > vals[m]) m = j; });
      if (vals[m] < 40) continue; // no real edge here (Sobel units, 0–1020)
      let sub = 0;
      if (m > 0 && m < vals.length - 1) {
        const den = vals[m - 1] - 2 * vals[m] + vals[m + 1];
        if (den !== 0) sub = Math.max(-0.5, Math.min(0.5, (0.5 * (vals[m - 1] - vals[m + 1])) / den));
      }
      const o = m - radius + sub;
      hits.push({ p: [px + n[0] * o, py + n[1] * o], o });
    }
    if (hits.length < Math.max(4, samples / 4)) return null;
    // Keep the dominant edge: the hits whose offset agrees with the median.
    const med = [...hits].map((h) => h.o).sort((x, y) => x - y)[Math.floor(hits.length / 2)];
    const first = fitLine(hits.filter((h) => Math.abs(h.o - med) <= 2.5).map((h) => h.p));
    if (!first) return null;
    const resid = (p: Point) => Math.abs((p[0] - first.p[0]) * first.d[1] - (p[1] - first.p[1]) * first.d[0]);
    return fitLine(hits.map((h) => h.p).filter((p) => resid(p) <= 1.5)) ?? first;
  });
  const out = linesToQuad(lines, quad);
  return out.map((p, i) => (Math.hypot(p[0] - quad[i][0], p[1] - quad[i][1]) <= radius * 1.6 ? p : quad[i])) as Quad;
}

// ---------------------------------------------------------------- vision detector

export const SCREEN_QUAD_SYSTEM = `You locate the display screen of a TV, monitor, tablet or phone in a photo.
Return the four corners of the screen's visible glass area (inside the bezel/frame, not the outer body), as fractions 0-1 of the image width (x) and height (y), origin top-left.
If several screens are visible, choose the largest. If no screen is visible, return {"found": false}.
Return JSON only: {"found": true, "tl": [x, y], "tr": [x, y], "br": [x, y], "bl": [x, y]}`;

const pt = z.tuple([z.number(), z.number()]);
const visionQuadSchema = z.object({ found: z.boolean().default(false), tl: pt.optional(), tr: pt.optional(), br: pt.optional(), bl: pt.optional() });

export type VisionQuadFn = (imageDataUrl: string, systemPrompt: string) => Promise<unknown>;

/** Default vision call: the project's vision-capable model helper (same one keyframe QC uses). */
const defaultVision: VisionQuadFn = async (imageDataUrl, systemPrompt) => {
  const { analyzeWithClaude } = await import("@/services/ai/claude-client");
  return analyzeWithClaude({
    systemPrompt,
    userPrompt: [{ type: "text", text: "Find the screen corners in this image:" }, { type: "image_url", url: imageDataUrl }],
    responseSchema: visionQuadSchema,
    maxTokens: 200,
  });
};

async function loadImage(src: string | Buffer): Promise<Buffer> {
  if (Buffer.isBuffer(src)) return src;
  if (/^data:/.test(src)) return Buffer.from(src.slice(src.indexOf(",") + 1), "base64");
  if (/^https?:/.test(src)) {
    const res = await fetch(src, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`image download ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  return readFile(src);
}

/**
 * Screen corners from a vision model (one call on a small JPEG), refined locally and for free:
 * the corners are snapped onto the strongest nearby edges so the plate sits on the bezel's inner edge.
 * Never throws — returns null when there is no usable answer.
 */
export async function detectScreenQuad(
  imageUrlOrPath: string | Buffer,
  deps: { vision?: VisionQuadFn; refine?: boolean; maxSide?: number } = {}
): Promise<Quad | null> {
  try {
    const sharp = (await import("sharp")).default;
    const buf = await loadImage(imageUrlOrPath);
    const small = await sharp(buf).resize({ width: 768, height: 768, fit: "inside" }).jpeg({ quality: 80 }).toBuffer();
    const raw = await (deps.vision ?? defaultVision)(`data:image/jpeg;base64,${small.toString("base64")}`, SCREEN_QUAD_SYSTEM);
    const parsed = visionQuadSchema.safeParse(raw);
    if (!parsed.success || !parsed.data.found) return null;
    const { tl, tr, br, bl } = parsed.data;
    if (!tl || !tr || !br || !bl) return null;
    const q = orderQuad([tl, tr, br, bl].map(([x, y]) => [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))] as Point));
    if (!validQuad(q)) return null;
    if (deps.refine === false) return q;
    const { data, info } = await sharp(buf).resize({ width: deps.maxSide ?? 1280, height: deps.maxSide ?? 1280, fit: "inside", withoutEnlargement: true }).grayscale().raw().toBuffer({ resolveWithObject: true });
    const snapped = snapQuadToEdges({ data, width: info.width, height: info.height }, pxQuad(q, info.width, info.height));
    const out = normQuad(snapped, info.width, info.height);
    return validQuad(out) ? out : q;
  } catch (err) {
    console.warn("[screen-plate] vision detection failed:", err instanceof Error ? err.message.slice(0, 160) : err);
    return null;
  }
}

// ---------------------------------------------------------------- runner

export async function probeMedia(file: string): Promise<{ w: number; h: number; durSec: number }> {
  if (!ffmpegPath) throw new Error("ffmpeg is not available");
  const stderr: string = await run(ffmpegPath, ["-hide_banner", "-i", file]).then((r) => String(r.stderr), (e: { stderr?: unknown }) => String(e.stderr ?? ""));
  const size = /Video: .*?(\d{2,5})x(\d{2,5})/.exec(stderr);
  if (!size) throw new Error(`no video stream in ${path.basename(file)}`);
  const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(stderr);
  return { w: Number(size[1]), h: Number(size[2]), durSec: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0 };
}

async function extractFrame(src: string, tSec: number, out: string): Promise<string> {
  await run(ffmpegPath!, ["-y", "-v", "error", "-ss", fmt(Math.max(0, tSec)), "-i", src, "-frames:v", "1", "-update", "1", out], { timeout: 60_000 });
  return out;
}

/** Find the track on the clip's own frames: key colour every 0.5 s (free), or vision on the first + last frame. */
export async function detectTrack(
  src: string,
  plate: ScreenPlate,
  durSec: number,
  dir: string,
  deps: { vision?: VisionQuadFn; sampleEverySec?: number } = {}
): Promise<TrackKey[]> {
  const last = Math.max(0, durSec - 1.5 / PLATE_FPS);
  const step = deps.sampleEverySec ?? 0.5;
  const times = plate.detect === "key" ? [...Array(Math.floor(last / step) + 1).keys()].map((k) => k * step).concat(last % step > 1e-3 ? [last] : []) : [0, last];
  const keys: TrackKey[] = [];
  for (const [i, t] of times.entries()) {
    const file = await extractFrame(src, t, path.join(dir, `spdet${i}-${Date.now() % 1e6}.png`));
    const quad = plate.detect === "key" ? await detectKeyedQuad(file, plate.key ?? "#00FF00") : await detectScreenQuad(file, { vision: deps.vision });
    await rm(file, { force: true });
    if (quad) keys.push({ t, quad });
  }
  return keys; // after the last key the quad holds (the expressions clamp)
}

/**
 * Composite a plate onto one clip (or a still image when `still`), writing `out`.
 * Returns the track it used.
 */
export async function applyScreenPlate(input: {
  src: string;
  out: string;
  plate: ScreenPlate;
  dir: string;
  still?: boolean;
  vision?: VisionQuadFn;
}): Promise<{ out: string; track: TrackKey[] }> {
  if (!ffmpegPath) throw new Error("ffmpeg is not available");
  const { src, out, dir } = input;
  const m = await probeMedia(src);
  const dur = input.still ? 1 / PLATE_FPS : m.durSec || 1 / PLATE_FPS;
  let plate = input.plate;
  if (!plate.track?.length && !plate.firstLast) {
    if (!plate.detect) throw new Error("screen plate has no track, firstLast or detect");
    const track = await detectTrack(src, plate, dur, dir, { vision: input.vision });
    if (!track.length) throw new Error("screen plate: no screen found on the clip");
    plate = { ...plate, track };
  }
  const track = resolveTrack(plate, dur);
  const files = await Promise.all(
    plate.contents.map(async (c, i) => {
      if (c.path) return c.path;
      if (!c.url) throw new Error("screen plate content needs url or path");
      const file = path.join(dir, `spcontent${i}-${path.basename(out)}.img`);
      await writeFile(file, await loadImage(c.url));
      return file;
    })
  );
  const sorted = [...plate.contents].map((c, i) => ({ c, f: files[i] })).sort((a, b) => a.c.fromSec - b.c.fromSec);
  const plateSorted = { ...plate, contents: sorted.map((s) => s.c) };
  const filter = screenPlateFilter(plateSorted, m.w, m.h, dur, 1, { inLabel: "[0:v]", outLabel: "[sp]" });
  const inArgs = input.still ? ["-loop", "1", "-framerate", String(PLATE_FPS), "-t", fmt(dur * 2), "-i", src] : ["-i", src];
  const outArgs = input.still
    ? ["-map", "[sp]", "-frames:v", "1", "-update", "1"]
    : ["-map", "[sp]", "-map", "0:a?", "-t", fmt(dur), "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p", "-c:a", "copy"];
  await run(ffmpegPath, ["-y", "-v", "error", ...inArgs, ...screenPlateInputArgs(sorted.map((s) => s.f)), "-filter_complex", filter, ...outArgs, out], { timeout: 300_000 });
  return { out, track };
}

/**
 * render-v2 hook: composite every frame's plate onto that frame's source clip/still and swap the
 * source file, so the edit (reframe, speed, text, end card) runs on the composited footage.
 * A plate that fails is skipped with a warning — the clip renders as generated.
 */
export async function applyScreenPlates(input: {
  dir: string;
  frames: { frameNumber: number; screenPlate?: ScreenPlate | null }[];
  segments: { kind: "clip" | "still"; url: string; frameNumber: number }[];
  sources: Map<string, string>;
  vision?: VisionQuadFn;
}): Promise<void> {
  const done = new Set<string>();
  for (const f of input.frames) {
    if (!f.screenPlate?.contents?.length) continue;
    for (const s of input.segments.filter((x) => x.frameNumber === f.frameNumber)) {
      const src = input.sources.get(s.url);
      if (!src || done.has(s.url)) continue;
      done.add(s.url);
      const out = path.join(input.dir, `sp${f.frameNumber}-${done.size}.${s.kind === "still" ? "png" : "mp4"}`);
      try {
        await applyScreenPlate({ src, out, plate: f.screenPlate, dir: input.dir, still: s.kind === "still", vision: input.vision });
        input.sources.set(s.url, out);
      } catch (err) {
        console.warn(`[screen-plate] frame ${f.frameNumber} skipped:`, err instanceof Error ? err.message.slice(0, 200) : err);
      }
    }
  }
}
