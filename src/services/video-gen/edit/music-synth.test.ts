import { describe, expect, it } from "vitest";
import { analyzeEnvelope, DETECT_SR, onsetEnvelope } from "./beat-detect";
import { BED_LUFS, integratedLufs, normalizeLoudness, SAMPLE_RATE, synthesizeMusic } from "./music-synth";
import { MOOD_IDS, MOOD_TEMPO, type MoodId } from "./music-moods";

/** 44.1 kHz stereo → 11.025 kHz mono (box filter), the detector's input. */
function toDetect(l: Float32Array, r: Float32Array): Float32Array {
  const k = SAMPLE_RATE / DETECT_SR;
  const out = new Float32Array(Math.floor(l.length / k));
  for (let i = 0; i < out.length; i++) {
    let s = 0;
    for (let j = 0; j < k; j++) s += l[i * k + j] + r[i * k + j];
    out[i] = s / (2 * k);
  }
  return out;
}

describe("integratedLufs (ITU-R BS.1770)", () => {
  it("reads a stereo 1 kHz sine at −23 dBFS as −23 LUFS, and −6 dB of gain as −6 LU", () => {
    const n = SAMPLE_RATE * 4;
    const a = Math.pow(10, -23 / 20);
    const l = new Float32Array(n);
    for (let i = 0; i < n; i++) l[i] = a * Math.sin((2 * Math.PI * 1000 * i) / SAMPLE_RATE);
    expect(integratedLufs(l, l)).toBeCloseTo(-23, 0);
    const half = l.map((x) => x / 2);
    expect(integratedLufs(l, l) - integratedLufs(half, half)).toBeCloseTo(6.02, 1);
  });

  it("normalises to a target without going over the ceiling", () => {
    const n = SAMPLE_RATE * 3;
    const l = new Float32Array(n);
    for (let i = 0; i < n; i++) l[i] = (i % 11025 < 2000 ? 0.5 : 0.08) * Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE);
    const r = l.slice();
    normalizeLoudness(l, r, -14, 0.89);
    expect(integratedLufs(l, r)).toBeCloseTo(-14, 0);
    expect(l.reduce((m, x) => Math.max(m, Math.abs(x)), 0)).toBeLessThanOrEqual(0.891);
  });
});

describe("synthesizeMusic moods", () => {
  const render = (mood: MoodId, bpm = MOOD_TEMPO[mood].bpm) => synthesizeMusic({ durationSec: 8, bpm, dropSec: 2, ctaSec: 6, seed: 3, mood, energy: 0.7 });

  it.each(MOOD_IDS.map((m) => [m]))("%s: the detector hears its tempo, it plays from the first frame and sits at −14 LUFS", { timeout: 60_000 }, (mood) => {
    const bpm = MOOD_TEMPO[mood].bpm;
    const m = render(mood);
    expect(m.bpm).toBe(bpm);
    expect(m.left.length).toBe(8 * SAMPLE_RATE);
    expect(m.beats[1] - m.beats[0]).toBeCloseTo(60 / bpm, 2);
    const { env, rms, hopSec } = onsetEnvelope(toDetect(m.left, m.right));
    const detected = analyzeEnvelope(env, rms, hopSec).bpm;
    expect(Math.abs(detected - bpm), `${mood} detected ${detected} BPM`).toBeLessThanOrEqual(1.5);
    expect(integratedLufs(m.left, m.right)).toBeCloseTo(BED_LUFS, 0);
    let peak = 0;
    let early = 0;
    for (let i = 0; i < m.left.length; i++) {
      if (!Number.isFinite(m.left[i]) || !Number.isFinite(m.right[i])) throw new Error("non-finite sample");
      peak = Math.max(peak, Math.abs(m.left[i]), Math.abs(m.right[i]));
      if (i < SAMPLE_RATE / 2) early = Math.max(early, Math.abs(m.left[i]));
    }
    expect(peak).toBeLessThanOrEqual(0.891);
    expect(early).toBeGreaterThan(0.05);
  });

  it("every mood sounds different", () => {
    const sig = (mood: MoodId) => {
      const m = render(mood, 120);
      // energy in 8 bands of the first 4 s, a coarse timbre fingerprint
      const out: number[] = [];
      for (let b = 0; b < 8; b++) {
        let s = 0;
        for (let i = b * 22050; i < (b + 1) * 22050; i++) s += m.left[i] * m.left[i];
        out.push(Math.sqrt(s / 22050));
      }
      return out;
    };
    const sigs = MOOD_IDS.map(sig);
    for (let i = 0; i < sigs.length; i++)
      for (let j = i + 1; j < sigs.length; j++) expect(sigs[i].some((v, k) => Math.abs(v - sigs[j][k]) > 1e-3), `${MOOD_IDS[i]} vs ${MOOD_IDS[j]}`).toBe(true);
  }, 60_000);

  it("is deterministic for a seed (a re-assembly is identical)", { timeout: 30_000 }, () => {
    const a = render("chill-lofi");
    const b = render("chill-lofi");
    let diff = 0;
    for (let i = 0; i < a.left.length; i += 97) diff = Math.max(diff, Math.abs(a.left[i] - b.left[i]));
    expect(diff).toBeLessThan(0.02);
  });
});
