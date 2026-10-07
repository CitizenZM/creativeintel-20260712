/**
 * Smart thumbnails / cover frames for a rendered video — local ffmpeg + sharp only:
 *
 *   candidates  ~12 times across the body (not the end card), away from cuts (transition blur)
 *   score       sharpness (Laplacian variance), brightness + contrast, colourfulness
 *               (Hasler–Süsstrunk), stillness (no motion blur: the next frame barely differs), plus a
 *               lift for shots the render plan says show the product or a person; a frame already
 *               carrying text (a band of strong edges) or a split comparison shot is marked down —
 *               the edit scores its clean cut layer (no overlays), finished files carry burned-in text
 *   compose     the top frame, cropped to 9:16 / 1:1 / 4:5 on its most salient region (sharp's
 *               attention strategy), with the hook headline in the cover-safe area. Reels' profile grid
 *               shows the centre 3:4 (and older grids 1:1) of a 9:16 cover, so the 9:16 headline sits
 *               inside the centre square; the 4:5 one inside its centre square too.
 */
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { pMap } from "@/lib/parallel";
import { frameStats, textBandScore } from "../preflight/measure";
import { DEFAULT_STYLE, type BrandStyle } from "./brand-style";
import { fitLayerPng, type LayoutBox } from "./safe-layout";
import { hookHeadlinePng } from "./text-layers";

const run = promisify(execFile);

export type CoverAspect = "9:16" | "1:1" | "4:5";
export const COVER_ASPECTS: CoverAspect[] = ["9:16", "1:1", "4:5"];

export interface FrameMeasures {
  /** Laplacian variance of the grey frame (0–255 scale): higher = sharper. */
  sharpness: number;
  brightness: number;
  contrast: number;
  /** Hasler–Süsstrunk colourfulness / 100 (≈ 0 grey … 1+ vivid). */
  colourfulness: number;
  /** Mean absolute luma change to the next frame (0–1): motion blur risk. */
  motion: number;
  /** Text-like edge band density (preflight textBandScore; ≥ 0.16 reads as on-screen text). */
  text?: number;
}

export interface CoverShot {
  startSec: number;
  endSec: number;
  product: boolean;
  person: boolean;
  /** A split comparison (the other side and its labels in frame): a poor cover. */
  avoid?: boolean;
}

export interface CoverPlan {
  durationSec: number;
  ctaSec: number | null;
  cutsSec: number[];
  shots: CoverShot[];
}

export interface CoverFile {
  aspect: CoverAspect;
  file: string;
  /** Nominal cover size (1080 wide). */
  w: number;
  h: number;
}

export interface CoversResult {
  frameSec: number;
  score: number;
  /** Every candidate scored, best first. */
  candidates: { t: number; score: number }[];
  frameFile: string;
  covers: CoverFile[];
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function laplacianVariance(g: Uint8Array | Buffer, w: number, h: number): number {
  let sum = 0;
  let sq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = g[i - 1] + g[i + 1] + g[i - w] + g[i + w] - 4 * g[i];
      sum += v;
      sq += v * v;
      n++;
    }
  if (!n) return 0;
  const mean = sum / n;
  return sq / n - mean * mean;
}

export function colourfulness(rgb: Uint8Array | Buffer, pixels: number): number {
  let srg = 0, syb = 0, qrg = 0, qyb = 0;
  for (let i = 0; i < pixels; i++) {
    const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2];
    const rg = r - g;
    const yb = 0.5 * (r + g) - b;
    srg += rg; syb += yb; qrg += rg * rg; qyb += yb * yb;
  }
  const mrg = srg / pixels, myb = syb / pixels;
  const vrg = Math.max(0, qrg / pixels - mrg * mrg), vyb = Math.max(0, qyb / pixels - myb * myb);
  return r3((Math.sqrt(vrg + vyb) + 0.3 * Math.sqrt(mrg * mrg + myb * myb)) / 100);
}

/** 0–1 (bonuses can lift past 1). Pure. */
export function scoreCoverFrame(m: FrameMeasures, meta: { product?: boolean; person?: boolean; avoid?: boolean }): number {
  const sharp = clamp01((Math.log10(m.sharpness + 1) - 1) / 2);
  const bright = clamp01(1 - Math.abs(m.brightness - 0.5) / 0.35);
  const contrast = clamp01(m.contrast / 0.2);
  const colour = clamp01(m.colourfulness / 0.6);
  const still = clamp01(1 - m.motion / 0.08);
  const base = 0.3 * sharp + 0.15 * bright + 0.15 * contrast + 0.15 * colour + 0.25 * still;
  // A dark or blurred frame never wins on metadata alone.
  const gate = Math.min(bright, sharp, still) > 0.2 ? 1 : 0.3;
  // Text already in the frame would sit under the cover's headline.
  const textPenalty = 0.3 * clamp01(((m.text ?? 0) - 0.1) / 0.12);
  const score = base + gate * ((meta.product ? 0.15 : 0) + (meta.person ? 0.1 : 0)) - textPenalty;
  return r3(meta.avoid ? score * 0.5 : score);
}

/** Candidate times over the body (the end card would put its own text under the cover's). */
export function coverCandidates(plan: Pick<CoverPlan, "durationSec" | "ctaSec" | "cutsSec">, n = 12): number[] {
  const end = Math.max(0.3, (plan.ctaSec ?? plan.durationSec) - 0.15);
  const start = Math.min(0.15, end / 2);
  const all = Array.from({ length: n }, (_, i) => r3(start + ((end - start) * (i + 0.5)) / n));
  const clear = all.filter((t) => plan.cutsSec.every((c) => Math.abs(t - c) > 0.12));
  return clear.length >= Math.min(3, n) ? clear : all;
}

/** Product / person tags per edit shot: CTA, zoom-hit and comparison shots show the product; frames say hasPerson. */
export function coverShots(
  plan: { shots: { startSec: number; endSec: number; frameNumber: number; segment: string; zoomHit?: unknown; compare?: unknown }[] },
  frames: { frameNumber: number; hasPerson?: boolean }[]
): CoverShot[] {
  return plan.shots.map((s) => ({
    startSec: s.startSec,
    endSec: s.endSec,
    product: s.segment === "CTA" || !!s.zoomHit || !!s.compare,
    person: !!frames.find((f) => f.frameNumber === s.frameNumber)?.hasPerson,
    ...(s.compare ? { avoid: true } : {}),
  }));
}

/** Cover size and the headline's safe box (1080 wide). */
export function coverLayout(aspect: CoverAspect): { w: number; h: number; box: LayoutBox; textY: number } {
  const w = 1080;
  const m = 86; // 8 % side margins
  if (aspect === "9:16") {
    // The centre 1:1 (y 420–1500) is what every grid crop keeps; stay inside it with a margin.
    return { w, h: 1920, box: { left: m, right: w - m, top: 450, bottom: 1470 }, textY: 0.34 };
  }
  if (aspect === "4:5") return { w, h: 1350, box: { left: m, right: w - m, top: 165, bottom: 1185 }, textY: 0.27 };
  return { w, h: 1080, box: { left: m, right: w - m, top: m, bottom: w - m }, textY: 0.24 };
}

async function rawAt(file: string, t: number, frames: number, w: number, fmt: "rgb24" | "gray"): Promise<Buffer[]> {
  const out = await run(ffmpegPath!, ["-v", "error", "-ss", t.toFixed(3), "-i", file, "-frames:v", String(frames), "-vf", `scale=${w}:-2`, "-f", "rawvideo", "-pix_fmt", fmt, "pipe:1"], {
    encoding: "buffer",
    timeout: 60_000,
    maxBuffer: 16 * 1024 * 1024,
  })
    .then((r) => r.stdout as Buffer)
    .catch(() => Buffer.alloc(0));
  const parts: Buffer[] = [];
  const size = out.length / frames;
  if (!Number.isInteger(size) || !size) return out.length ? [out] : [];
  for (let k = 0; k < frames; k++) parts.push(out.subarray(k * size, (k + 1) * size));
  return parts;
}

/** Measure one candidate frame (and its neighbour, for motion) at 160 px. */
export async function measureFrame(file: string, t: number, aspect: { w: number; h: number }): Promise<FrameMeasures | null> {
  const W = 160;
  const H = Math.max(2, Math.round((W * aspect.h) / aspect.w / 2) * 2);
  const [a, b] = await rawAt(file, t, 2, W, "rgb24");
  if (!a || a.length !== W * H * 3) return null;
  const gray = (rgb: Buffer) => {
    const g = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) g[i] = Math.round(0.2126 * rgb[i * 3] + 0.7152 * rgb[i * 3 + 1] + 0.0722 * rgb[i * 3 + 2]);
    return g;
  };
  const ga = gray(a);
  let motion = 0;
  if (b && b.length === a.length) {
    const gb = gray(b);
    let s = 0;
    for (let i = 0; i < ga.length; i++) s += Math.abs(ga[i] - gb[i]);
    motion = s / ga.length / 255;
  }
  const st = frameStats(a, W, H);
  return { sharpness: laplacianVariance(ga, W, H), brightness: st.brightness, contrast: st.contrast, colourfulness: colourfulness(a, W * H), motion, text: textBandScore(ga, W, H) };
}

/** A soft dark band behind the headline so it reads on any frame. */
function scrimSvg(w: number, h: number, cy: number, bandH: number): Buffer {
  const y0 = Math.max(0, cy - bandH);
  const y1 = Math.min(h, cy + bandH);
  return Buffer.from(
    `<svg width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="0.5" stop-color="#000" stop-opacity="0.38"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient></defs><rect x="0" y="${y0}" width="${w}" height="${y1 - y0}" fill="url(#g)"/></svg>`
  );
}

/** One cover: the frame cropped to `aspect` on its salient region, plus the headline in the cover-safe box. */
export async function composeCover(frame: Buffer, aspect: CoverAspect, headline: string | null, outW = 1080, look: BrandStyle = DEFAULT_STYLE): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  const L = coverLayout(aspect);
  const k = outW / L.w;
  const W = outW;
  const H = Math.round(L.h * k);
  const base = await sharp(frame).resize(W, H, { fit: "cover", position: sharp.strategy.attention }).png().toBuffer();
  if (!headline?.trim()) return sharp(base).jpeg({ quality: 90 }).toBuffer();
  const box: LayoutBox = { left: Math.round(L.box.left * k), right: Math.round(L.box.right * k), top: Math.round(L.box.top * k), bottom: Math.round(L.box.bottom * k) };
  const canvas = { w: W, h: H };
  const text = await hookHeadlinePng(headline, { ...canvas, safeW: box.right - box.left }, look);
  const fit = await fitLayerPng(text, L.textY, box, canvas);
  const m = await sharp(fit.png).metadata();
  const tw = m.width ?? 0;
  const th = m.height ?? 0;
  const cy = Math.round(fit.y * H);
  return sharp(base)
    .composite([
      { input: scrimSvg(W, H, cy, Math.round(th * 0.9)), left: 0, top: 0 },
      { input: fit.png, left: Math.max(0, Math.round(fit.cx - tw / 2)), top: Math.max(0, Math.round(cy - th / 2)) },
    ])
    .jpeg({ quality: 90 })
    .toBuffer();
}

/** Score candidate frames of `file`, pick the best and compose the three covers into `dir`. */
export async function makeCovers(input: { file: string; dir: string; headline: string | null; plan: CoverPlan; outW?: number; look?: BrandStyle; tag?: string }): Promise<CoversResult> {
  if (!ffmpegPath) throw new Error("ffmpeg is not available");
  const probe = await run(ffmpegPath, ["-hide_banner", "-i", input.file], { maxBuffer: 4 * 1024 * 1024 }).catch((e: { stderr?: string }) => ({ stderr: e.stderr ?? "" }));
  const v = /Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/.exec(String(probe.stderr));
  const size = { w: v ? Number(v[1]) : 9, h: v ? Number(v[2]) : 16 };
  const d = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(String(probe.stderr));
  const fileSec = d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : input.plan.durationSec;
  // A cutdown / export is shorter than the storyboard: sample only what the file holds.
  const durationSec = Math.min(input.plan.durationSec, fileSec);
  const times = coverCandidates({ ...input.plan, durationSec, ctaSec: input.plan.ctaSec !== null && input.plan.ctaSec < durationSec ? input.plan.ctaSec : null });
  const scored = (
    await pMap(
      times,
      async (t) => {
        const m = await measureFrame(input.file, t, size);
        if (!m) return null;
        const shot = input.plan.shots.find((s) => t >= s.startSec && t < s.endSec);
        return { t, score: scoreCoverFrame(m, { product: shot?.product, person: shot?.person, avoid: shot?.avoid }) };
      },
      { concurrency: 3 }
    )
  )
    .filter((x): x is { t: number; score: number } => !!x)
    .sort((a, b) => b.score - a.score || a.t - b.t);
  if (!scored.length) throw new Error("No frame could be measured for the cover");
  const best = scored[0];
  const tag = input.tag ?? "cover";
  const frameFile = path.join(input.dir, `${tag}-frame.png`);
  await run(ffmpegPath, ["-v", "error", "-y", "-ss", best.t.toFixed(3), "-i", input.file, "-frames:v", "1", frameFile], { timeout: 60_000 });
  const { readFile } = await import("node:fs/promises");
  const frame = await readFile(frameFile);
  const covers: CoverFile[] = [];
  for (const aspect of COVER_ASPECTS) {
    const file = path.join(input.dir, `${tag}-${aspect.replace(":", "x")}.jpg`);
    await writeFile(file, await composeCover(frame, aspect, input.headline, input.outW ?? 1080, input.look));
    const L = coverLayout(aspect);
    covers.push({ aspect, file, w: L.w, h: L.h });
  }
  return { frameSec: best.t, score: best.score, candidates: scored, frameFile, covers };
}
