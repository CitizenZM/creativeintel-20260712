/**
 * Pre-flight measurements on a rendered master — local ffmpeg only, small decodes:
 *   probe        duration, size, audio stream
 *   frame 1      RGB at 160 px: brightness (mean luma), contrast (luma σ), saturation (mean HSV S)
 *   0–3 s        grey frames at 12 fps: motion energy over 0–1 s, text-like edge bands per frame
 *   last 1 s     grey frames: motion + edge density (a held end card is still and text-dense)
 *   audio        silencedetect (leading silence) + ebur128 (integrated loudness, true peak)
 *   cuts         scene detection (qc.ts measureCuts)
 * Known values from the edit QC (loudness, peak, cuts) are reused instead of re-measured.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { measureCuts, parseLoudness } from "../edit/qc";
import type { PreflightMeasures } from "./types";

const run = promisify(execFile);
const W = 160;
const FPS = 12;

export function parseProbe(stderr: string): { durationSec: number; width: number; height: number; hasAudio: boolean } {
  const d = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(stderr);
  const v = /Stream #\d+:\d+[^\n]*Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/.exec(stderr);
  return {
    durationSec: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0,
    width: v ? Number(v[1]) : 0,
    height: v ? Number(v[2]) : 0,
    hasAudio: /Stream #\d+:\d+[^\n]*Audio:/.test(stderr),
  };
}

/** Seconds of silence from t = 0 (0 when the first silence starts later). */
export function parseLeadingSilence(stderr: string, durationSec = 0): number {
  const start = /silence_start:\s*(-?[\d.]+)/.exec(stderr);
  if (!start || Number(start[1]) > 0.05) return 0;
  const end = /silence_end:\s*([\d.]+)/.exec(stderr.slice(start.index));
  return end ? Number(end[1]) : durationSec;
}

/** Brightness / contrast (luma mean, σ) and saturation (mean HSV S) of an RGB24 frame, all 0–1. */
export function frameStats(rgb: Buffer | Uint8Array, w: number, h: number): { brightness: number; contrast: number; saturation: number } {
  const n = w * h;
  let sum = 0;
  let sq = 0;
  let sat = 0;
  for (let i = 0; i < n; i++) {
    const r = rgb[i * 3] / 255;
    const g = rgb[i * 3 + 1] / 255;
    const b = rgb[i * 3 + 2] / 255;
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sum += y;
    sq += y * y;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    sat += mx > 0 ? (mx - mn) / mx : 0;
  }
  const mean = sum / n;
  return { brightness: mean, contrast: Math.sqrt(Math.max(0, sq / n - mean * mean)), saturation: sat / n };
}

/** Mean absolute luma change between consecutive grey frames, 0–1. */
export function meanAbsDiff(frames: (Buffer | Uint8Array)[]): number {
  if (frames.length < 2) return 0;
  let total = 0;
  for (let k = 1; k < frames.length; k++) {
    const a = frames[k - 1];
    const b = frames[k];
    let s = 0;
    for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
    total += s / a.length / 255;
  }
  return total / (frames.length - 1);
}

function edgeMap(g: Buffer | Uint8Array, w: number, h: number, thr: number): Uint8Array {
  const e = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (Math.abs(g[i + 1] - g[i - 1]) + Math.abs(g[i + w] - g[i - w]) > thr) e[i] = 1;
    }
  return e;
}

/** Share of pixels on a strong edge. */
export function edgeDensity(g: Buffer | Uint8Array, w: number, h: number, thr = 90): number {
  const e = edgeMap(g, w, h, thr);
  let n = 0;
  for (const v of e) n += v;
  return n / (w * h);
}

/** Text-like: the densest horizontal band of strong edges (overlay text is a band of high-contrast strokes). */
export function textBandScore(g: Buffer | Uint8Array, w: number, h: number, thr = 90): number {
  const e = edgeMap(g, w, h, thr);
  const bands = Math.max(1, Math.round(h / 8));
  const bh = Math.max(1, Math.floor(h / bands));
  let best = 0;
  for (let b = 0; b < bands; b++) {
    let n = 0;
    for (let y = b * bh; y < Math.min(h, (b + 1) * bh); y++) for (let x = 0; x < w; x++) n += e[y * w + x];
    best = Math.max(best, n / (bh * w));
  }
  return best;
}

const TEXT_BAND = 0.16;

async function rawFrames(args: string[], frameBytes: number): Promise<Buffer[]> {
  const out = await run(ffmpegPath!, ["-hide_banner", "-v", "error", ...args, "pipe:1"], { encoding: "buffer", maxBuffer: 256 * 1024 * 1024, timeout: 90_000 })
    .then((r) => r.stdout as Buffer)
    .catch(() => Buffer.alloc(0));
  const frames: Buffer[] = [];
  for (let o = 0; o + frameBytes <= out.length; o += frameBytes) frames.push(out.subarray(o, o + frameBytes));
  return frames;
}

export async function measurePreflight(
  file: string,
  dir: string,
  known: { loudnessLufs?: number | null; truePeakDb?: number | null; cutsSec?: number[] } = {}
): Promise<PreflightMeasures> {
  if (!ffmpegPath) throw new Error("ffmpeg is not available");
  const probe = parseProbe(String((await run(ffmpegPath, ["-hide_banner", "-i", file], { maxBuffer: 4 * 1024 * 1024 }).catch((e: { stderr?: string }) => ({ stderr: e.stderr ?? "" }))).stderr));
  const H = Math.max(2, Math.round((W * (probe.height || 16)) / (probe.width || 9) / 2) * 2);
  const scale = `scale=${W}:${H}`;

  const [first] = await rawFrames(["-i", file, "-frames:v", "1", "-vf", scale, "-f", "rawvideo", "-pix_fmt", "rgb24"], W * H * 3);
  const opening = await rawFrames(["-t", "3", "-i", file, "-vf", `fps=${FPS},${scale},format=gray`, "-f", "rawvideo", "-pix_fmt", "gray"], W * H);
  const closing = await rawFrames(["-sseof", "-1", "-i", file, "-vf", `fps=${FPS},${scale},format=gray`, "-f", "rawvideo", "-pix_fmt", "gray"], W * H);

  const onset = opening.findIndex((g) => textBandScore(g, W, H) >= TEXT_BAND);
  let leadingSilenceSec = 0;
  let loud = { lufs: known.loudnessLufs ?? null, peak: known.truePeakDb ?? null };
  if (probe.hasAudio) {
    const needLoud = known.loudnessLufs === undefined;
    const audio = await run(ffmpegPath, ["-hide_banner", "-nostats", "-i", file, "-vn", "-af", `silencedetect=n=-45dB:d=0.1${needLoud ? ",ebur128=peak=true" : ""}`, "-f", "null", "-"], { timeout: 90_000, maxBuffer: 16 * 1024 * 1024 }).catch((e: { stderr?: string }) => ({ stderr: e.stderr ?? "" }));
    const err = String(audio.stderr);
    leadingSilenceSec = parseLeadingSilence(err, probe.durationSec);
    if (needLoud) loud = parseLoudness(err);
  }
  const cutsSec = known.cutsSec ?? (await measureCuts(file, dir).catch(() => []));
  const lastEdge = closing.length ? closing.reduce((n, g) => n + edgeDensity(g, W, H), 0) / closing.length : 0;

  return {
    durationSec: probe.durationSec,
    width: probe.width,
    height: probe.height,
    firstFrame: first ? frameStats(first, W, H) : { brightness: 0, contrast: 0, saturation: 0 },
    motion1s: meanAbsDiff(opening.slice(0, FPS + 1)),
    textOnsetSec: onset < 0 ? null : Math.round((onset / FPS) * 100) / 100,
    cutsSec,
    hasAudio: probe.hasAudio,
    loudnessLufs: probe.hasAudio ? loud.lufs : null,
    truePeakDb: probe.hasAudio ? loud.peak : null,
    leadingSilenceSec,
    end: { motion: meanAbsDiff(closing), edgeDensity: lastEdge },
  };
}
