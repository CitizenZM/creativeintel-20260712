/**
 * Beat detection for a brand's own (licensed) music track, so a real track can
 * replace the synthesised bed and every cut still lands on its beat:
 *   onset envelope  half-wave-rectified rise of log energy on a pre-emphasised
 *                   mono decode (≈23 ms hops)
 *   tempo           autocorrelation of the envelope over 70–180 BPM, weighted
 *                   towards 120 (the octave errors every tracker makes)
 *   phase           the beat offset whose grid collects the most onset energy
 *   drop            the largest jump in 2 s loudness — where the edit's hook→body
 *                   cut should land
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";

const run = promisify(execFile);
export const DETECT_SR = 11025;
const HOP = 256;

export interface BeatAnalysis {
  bpm: number;
  /** Beat times in seconds from the start of the track. */
  beats: number[];
  dropSec: number;
  durationSec: number;
}

/** Onset strength per hop from mono samples. Pure. */
export function onsetEnvelope(x: Float32Array, sr = DETECT_SR, hop = HOP): { env: Float32Array; rms: Float32Array; hopSec: number } {
  const n = Math.floor(x.length / hop);
  const hi = new Float32Array(n);
  /** Low-band (kick + bass, < ~150 Hz) loudness per hop — what a drop is made of. */
  const rms = new Float32Array(n);
  const a = Math.exp((-2 * Math.PI * 150) / sr);
  let prev = 0;
  let lp = 0;
  for (let i = 0; i < n; i++) {
    let e = 0;
    let el = 0;
    for (let k = i * hop; k < (i + 1) * hop; k++) {
      const y = x[k] - 0.97 * prev; // pre-emphasis: percussive attacks dominate
      prev = x[k];
      e += y * y;
      lp = (1 - a) * x[k] + a * lp;
      el += lp * lp;
    }
    hi[i] = Math.sqrt(e / hop);
    rms[i] = Math.sqrt(el / hop);
  }
  const env = new Float32Array(n);
  for (let i = 1; i < n; i++) env[i] = Math.max(0, Math.log(1e-4 + hi[i]) - Math.log(1e-4 + hi[i - 1]));
  return { env, rms, hopSec: hop / sr };
}

/** Tempo, beat grid and drop from an onset envelope. Pure. */
export function analyzeEnvelope(env: Float32Array, rms: Float32Array, hopSec: number): BeatAnalysis {
  const n = env.length;
  const durationSec = n * hopSec;
  // Tempo + phase by grid fit: for each BPM (0.5 steps) and phase, the mean
  // onset strength on its beats (interpolated), weighted towards 120 BPM.
  // An onset is stamped at the centre of the hop it happened in.
  const at = (t: number) => {
    const p = t / hopSec - 0.5;
    const i = Math.floor(p);
    const f = p - i;
    return (env[i] ?? 0) * (1 - f) + (env[i + 1] ?? 0) * f;
  };
  let best = { score: -Infinity, period: 0.5, offset: 0 };
  for (let bpm = 70; bpm <= 180; bpm += 0.5) {
    const period = 60 / bpm;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
    for (let offset = 0; offset < period; offset += hopSec / 2) {
      let sum = 0;
      let count = 0;
      for (let t = offset; t < durationSec; t += period) {
        sum += at(t);
        count++;
      }
      // Off-beat penalty: a grid at the wrong tempo also lands between beats.
      let off = 0;
      for (let t = offset + period / 2; t < durationSec; t += period) off += at(t);
      const score = ((sum - 0.5 * off) / Math.max(1, count)) * prior;
      if (score > best.score) best = { score, period, offset };
    }
  }
  const period = best.period;
  const beats: number[] = [];
  for (let t = best.offset; t < durationSec; t += period) beats.push(Math.round(t * 1000) / 1000);
  // Drop: the beat where the next bar is loudest relative to the 2 s before it
  // (a ratio, so a riser building into the drop doesn't pull it early).
  const w = Math.max(1, Math.round(2 / hopSec));
  const bar = Math.max(1, Math.round((4 * period) / hopSec));
  const mean = (from: number, to: number) => {
    let s = 0;
    for (let k = Math.max(0, from); k < Math.min(rms.length, to); k++) s += rms[k];
    return s / Math.max(1, Math.min(rms.length, to) - Math.max(0, from));
  };
  let dropSec = beats[0] ?? 0;
  let bestRise = -Infinity;
  for (const b of beats) {
    const i = Math.round(b / hopSec);
    if (i < w || i + bar > rms.length) continue;
    const rise = Math.log((mean(i, i + bar) + 1e-6) / (mean(i - w, i) + 1e-6));
    if (rise > bestRise + 1e-9) {
      bestRise = rise;
      dropSec = b;
    }
  }
  return { bpm: Math.round((60 / period) * 10) / 10, beats, dropSec, durationSec: Math.round(durationSec * 1000) / 1000 };
}

/** Decode a track and analyse it. */
export async function detectBeats(file: string): Promise<BeatAnalysis> {
  if (!ffmpegPath) throw new Error("ffmpeg is not available");
  const { stdout } = await run(ffmpegPath, ["-v", "error", "-i", file, "-ac", "1", "-ar", String(DETECT_SR), "-f", "f32le", "-"], {
    encoding: "buffer",
    timeout: 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const buf = stdout as unknown as Buffer;
  const x = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
  const { env, rms, hopSec } = onsetEnvelope(x);
  return analyzeEnvelope(env, rms, hopSec);
}

/**
 * Where to start the track so its drop lands on the edit's drop (hook → body),
 * keeping the window inside the track.
 */
export function trackWindowStart(a: Pick<BeatAnalysis, "dropSec" | "durationSec">, editDropSec: number, editSec: number): number {
  const start = a.dropSec - editDropSec;
  return Math.max(0, Math.min(Math.max(0, a.durationSec - editSec), start));
}
