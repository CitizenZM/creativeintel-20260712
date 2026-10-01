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
