import { describe, expect, it } from "vitest";
import { synthesizeMusic, SAMPLE_RATE } from "./music-synth";
import { analyzeEnvelope, DETECT_SR, onsetEnvelope, trackWindowStart } from "./beat-detect";

/** Downmix + naive decimation of the synth's 44.1 kHz output to the detector rate. */
function toDetect(l: Float32Array, r: Float32Array): Float32Array {
  const step = SAMPLE_RATE / DETECT_SR;
  const out = new Float32Array(Math.floor(l.length / step));
  for (let i = 0; i < out.length; i++) {
    const j = Math.floor(i * step);
    out[i] = (l[j] + r[j]) / 2;
  }
  return out;
}

describe("beat detection", () => {
  it("recovers the tempo, the beat phase and the drop of a track with a known grid", () => {
    for (const bpm of [100, 120, 128]) {
      const m = synthesizeMusic({ durationSec: 20, bpm, dropSec: 4, energy: 0.8 });
      const { env, rms, hopSec } = onsetEnvelope(toDetect(m.left, m.right));
      const a = analyzeEnvelope(env, rms, hopSec);
      expect(Math.abs(a.bpm - bpm)).toBeLessThan(2);
      // Detected beats sit on the true grid (within ~2 hops).
      const period = 60 / bpm;
      const off = a.beats.slice(4, 20).map((t) => Math.abs(t / period - Math.round(t / period)) * period);
      expect(Math.max(...off)).toBeLessThan(0.06);
      expect(Math.abs(a.dropSec - 4)).toBeLessThan(period * 1.01 + 0.05);
    }
  }, 30_000);

  it("starts the window so the track's drop meets the edit's drop", () => {
    expect(trackWindowStart({ dropSec: 30, durationSec: 120 }, 2, 20)).toBe(28);
    expect(trackWindowStart({ dropSec: 1, durationSec: 120 }, 2, 20)).toBe(0);
    expect(trackWindowStart({ dropSec: 110, durationSec: 120 }, 2, 20)).toBe(100);
  });
});
