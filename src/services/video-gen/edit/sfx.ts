/**
 * Transition sweeteners, synthesised from noise and sine primitives — nothing
 * sampled, so there is no licence question:
 *   whoosh  swept noise on whip / dissolve boundaries
 *   impact  pitch-dropping thump + click on the drop, zoom punches and flashes
 *   click   a soft pop when the CTA button lands
 * All are mixed low: they sweeten the cut, never compete with the voice.
 * Timings come from the rendered cut list, never from the plan, so a sound can
 * never drift from its cut.
 */
import { SAMPLE_RATE } from "./music-synth";

export type SfxKind = "whoosh" | "impact" | "click";

export interface SfxEvent {
  kind: SfxKind;
  /** The cut (seconds). A whoosh peaks on it, so it starts a little before. */
  atSec: number;
}

function whoosh(dur = 0.42): Float32Array {
  const n = Math.round(dur * SAMPLE_RATE);
  const out = new Float32Array(n);
  let lp = 0;
  let seed = 12345;
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const x = (seed / 0x7fffffff) * 2 - 1;
    const p = i / n;
    const cutoff = 250 + 2600 * Math.sin(Math.PI * p); // airy, not hissy
    const a = Math.exp((-2 * Math.PI * cutoff) / SAMPLE_RATE);
    lp = (1 - a) * x + a * lp;
    out[i] = lp * Math.sin(Math.PI * p) ** 1.5;
  }
  return normalise(out);
}

function impact(dur = 0.38): Float32Array {
  const n = Math.round(dur * SAMPLE_RATE);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    phase += (2 * Math.PI * 120 * Math.exp(-t * 9)) / SAMPLE_RATE;
    const tick = i < 200 ? (((i * 7919) % 200) / 100 - 1) * Math.exp(-t * 90) * 0.35 : 0;
    out[i] = Math.sin(phase) * Math.exp(-t * 11) + tick;
  }
  return normalise(out);
}

function click(dur = 0.12): Float32Array {
  // A rounded "pop": a short downward sine glide, no sharp transient.
  const n = Math.round(dur * SAMPLE_RATE);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    phase += (2 * Math.PI * (520 + 380 * Math.exp(-t * 40))) / SAMPLE_RATE;
    out[i] = Math.sin(phase) * Math.min(1, t / 0.004) * Math.exp(-t * 30);
  }
  return normalise(out);
}

function normalise(x: Float32Array): Float32Array {
  let peak = 1e-9;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  for (let i = 0; i < x.length; i++) x[i] /= peak;
  return x;
}

export const GAIN: Record<SfxKind, number> = { whoosh: 0.12, impact: 0.15, click: 0.14 };

/** A stereo bed with every event placed; a whoosh is centred on its cut. */
export function renderSfxBed(events: SfxEvent[], durationSec: number): { left: Float32Array; right: Float32Array } {
  const n = Math.round(durationSec * SAMPLE_RATE);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const cache: Partial<Record<SfxKind, Float32Array>> = {};
  for (const e of events) {
    const s = (cache[e.kind] ??= e.kind === "whoosh" ? whoosh() : e.kind === "impact" ? impact() : click());
    const start = Math.round((e.kind === "whoosh" ? e.atSec - s.length / SAMPLE_RATE / 2 : e.atSec) * SAMPLE_RATE);
    for (let i = 0; i < s.length; i++) {
      const j = start + i;
      if (j < 0 || j >= n) continue;
      left[j] += s[i] * GAIN[e.kind];
      right[j] += s[i] * GAIN[e.kind];
    }
  }
  return { left, right };
}
