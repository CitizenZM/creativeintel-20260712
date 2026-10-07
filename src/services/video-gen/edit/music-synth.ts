/**
 * A royalty-free music bed, synthesised from scratch for each ad — no library,
 * no licence question, and an exact tempo so every cut can land on a beat.
 *
 * Structure follows the ad, not a song: energy from the first frame (no slow
 * intro), a riser into the drop where the hook hands over to the body, a
 * breakdown bar before the offer, the full groove again for the CTA and a final
 * hit with a decaying crash on the last beat. Pop/EDM vocabulary: four-on-the-
 * floor kick, claps on 2 and 4, off-beat hats, a pumping (side-chained) bass
 * and pad on a vi–IV–I–V progression, a plucked arpeggio in the second half.
 */
import { MOOD_ENERGY, type MoodId } from "./music-moods";

export const SAMPLE_RATE = 44100;
/** Every bed is normalised to this integrated loudness before it is ducked and mixed. */
export const BED_LUFS = -14;
/** Sample ceiling of a bed (−1 dBFS). */
export const BED_CEILING = 0.89;

export interface MusicPlan {
  durationSec: number;
  bpm: number;
  /** Where the hook hands over to the body: the drop (seconds). */
  dropSec: number;
  /** Optional one-bar breakdown before the offer (seconds). */
  breakdownSec?: number | null;
  /** Where the CTA starts: everything plays, then the final hit at the end. */
  ctaSec?: number | null;
  /** 0 calm … 1 high energy. */
  energy?: number;
  seed?: number;
  /**
   * "pop" (default): four-on-the-floor EDM bed. "holiday": a warm, light seasonal bed — celesta
   * arpeggio, sleigh bells, soft piano chords, sine bass, a gentle kick on 1 and 3, no claps,
   * risers or crashes. Holiday/gift ads use it; it sits further under the voice.
   * The other moods (music-moods.ts) are arranged by the pattern engine below (MOOD_SPECS).
   */
  mood?: MoodId;
}

/** Chord roots (Hz) and triads for vi–IV–I–V in C: Am F C G. */
const PROGRESSION: { root: number; chord: number[] }[] = [
  { root: 55.0, chord: [220.0, 261.63, 329.63] }, // Am
  { root: 43.65, chord: [174.61, 220.0, 261.63] }, // F
  { root: 65.41, chord: [196.0, 261.63, 329.63] }, // C (G3 C4 E4)
  { root: 49.0, chord: [196.0, 246.94, 293.66] }, // G
];

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 4294967296) * 2 - 1;
  };
}

interface Bus {
  l: Float32Array;
  r: Float32Array;
}

function addMono(bus: Bus, at: number, samples: Float32Array, gain: number, pan = 0) {
  const start = Math.round(at * SAMPLE_RATE);
  const gl = gain * Math.min(1, 1 - pan);
  const gr = gain * Math.min(1, 1 + pan);
  for (let i = 0; i < samples.length; i++) {
    const j = start + i;
    if (j < 0 || j >= bus.l.length) continue;
    bus.l[j] += samples[i] * gl;
    bus.r[j] += samples[i] * gr;
  }
}

/** Pitch-dropping sine thump; the defaults are the kick, a higher base and slower decay make a tom. */
function kick(base = 48, sweep = 110, decay = 7.5, dur = 0.42): Float32Array {
  const n = Math.round(dur * SAMPLE_RATE);
  const out = new Float32Array(n);
  const click = rng(0x6b1c); // a fixed click: every render of the bed is identical
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const f = base + sweep * Math.exp(-t * 32);
    phase += (2 * Math.PI * f) / SAMPLE_RATE;
    out[i] = Math.sin(phase) * Math.exp(-t * decay) + (i < 90 ? click() * 0.15 * (1 - i / 90) : 0);
  }
  return out;
}

function noiseHit(dur: number, decay: number, hp: number, rand: () => number, tone = 0): Float32Array {
  const n = Math.round(dur * SAMPLE_RATE);
  const out = new Float32Array(n);
  let lp = 0;
  const a = Math.exp((-2 * Math.PI * hp) / SAMPLE_RATE);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const x = rand();
    lp = (1 - a) * x + a * lp;
    const high = x - lp; // one-pole high-pass
    const body = tone ? Math.sin(2 * Math.PI * tone * t) * Math.exp(-t * 30) * 0.5 : 0;
    out[i] = (high + body) * Math.exp(-t * decay);
  }
  return out;
}

/** Detuned saw stack through a one-pole low-pass. */
function sawVoice(freq: number, dur: number, cutoff: number, attack: number, release: number, detune = 0.006): Float32Array {
  const n = Math.round(dur * SAMPLE_RATE);
  const out = new Float32Array(n);
  const fs = [freq * (1 - detune), freq, freq * (1 + detune)];
  const ph = [0, 0.33, 0.66];
  let lp = 0;
  const a = Math.exp((-2 * Math.PI * cutoff) / SAMPLE_RATE);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    let s = 0;
    for (let k = 0; k < 3; k++) {
      ph[k] = (ph[k] + fs[k] / SAMPLE_RATE) % 1;
      s += 2 * ph[k] - 1;
    }
    lp = (1 - a) * (s / 3) + a * lp;
    const env = Math.min(1, t / attack) * Math.min(1, Math.max(0, (dur - t) / release));
    out[i] = lp * env;
  }
  return out;
}

/** Plucked tone (3 harmonics); a slow decay with its upper partials dying first reads as a guitar string. */
function pluck(freq: number, dur: number, decay = 14, damp = 0): Float32Array {
  const n = Math.round(dur * SAMPLE_RATE);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const sq = Math.sin(2 * Math.PI * freq * t) + 0.35 * Math.sin(2 * Math.PI * freq * 2 * t) * Math.exp(-t * damp) + 0.15 * Math.sin(2 * Math.PI * freq * 3 * t) * Math.exp(-t * damp * 2);
    out[i] = sq * Math.exp(-t * decay) * Math.min(1, t / 0.003) * Math.min(1, Math.max(0, (dur - t) / 0.02));
  }
  return out;
}

/** Filtered noise sweep up into the drop. */
function riser(dur: number, rand: () => number): Float32Array {
  const n = Math.round(dur * SAMPLE_RATE);
  const out = new Float32Array(n);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const p = i / n;
    const cutoff = 300 + 7000 * p * p;
    const a = Math.exp((-2 * Math.PI * cutoff) / SAMPLE_RATE);
    lp = (1 - a) * rand() + a * lp;
    out[i] = lp * p * p * 1.6;
  }
  return out;
}

export interface MusicResult {
  /** Interleaved stereo, -1..1. */
  left: Float32Array;
  right: Float32Array;
  bpm: number;
  beats: number[];
}

/** Bell / celesta: inharmonic sine partials, fast attack, long soft decay. */
function bell(freq: number, dur: number): Float32Array {
  const n = Math.round(dur * SAMPLE_RATE);
  const out = new Float32Array(n);
  const partials: [number, number, number][] = [
    [1, 1, 3.2],
    [2.0, 0.35, 5],
    [3.01, 0.16, 8],
    [4.17, 0.08, 11],
  ];
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    let v = 0;
    for (const [m, g, d] of partials) v += g * Math.sin(2 * Math.PI * freq * m * t) * Math.exp(-t * d);
    out[i] = v * Math.min(1, t / 0.002);
  }
  return out;
}

/** Soft electric-piano chord tone: sine + a little 2nd harmonic, gentle tremolo, decaying. */
function epiano(freq: number, dur: number): Float32Array {
  const n = Math.round(dur * SAMPLE_RATE);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const trem = 1 - 0.12 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 4.5 * t));
    out[i] = (Math.sin(2 * Math.PI * freq * t) + 0.22 * Math.sin(2 * Math.PI * freq * 2 * t)) * trem * Math.min(1, t / 0.01) * Math.exp(-t * 1.6) * Math.min(1, Math.max(0, (dur - t) / 0.08));
  }
  return out;
}

/** Sine bass note with a soft attack and release. */
function sineBass(freq: number, dur: number): Float32Array {
  const n = Math.round(dur * SAMPLE_RATE);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    out[i] = (Math.sin(2 * Math.PI * freq * t) + 0.25 * Math.sin(2 * Math.PI * freq * 2 * t)) * Math.min(1, t / 0.015) * Math.min(1, Math.max(0, (dur - t) / 0.05));
  }
  return out;
}

/** Sleigh-bell shake: a cluster of high metallic partials over a bright noise burst. */
function sleigh(rand: () => number, dur = 0.3): Float32Array {
  const n = Math.round(dur * SAMPLE_RATE);
  const out = new Float32Array(n);
  // Pure metallic partials, no noise: a clean "ting", not a shaker hiss ("cha-cha").
  const freqs = [2637, 3520, 4186, 5274].map((f) => f * (1 + 0.004 * rand()));
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    let v = 0;
    for (const f of freqs) v += Math.sin(2 * Math.PI * f * t + f);
    out[i] = v * 0.25 * Math.exp(-t * 18) * Math.min(1, t / 0.003);
  }
  return out;
}

/**
 * "Jingle Bells" chorus (James Lord Pierpont, 1857 — public domain) in C: [note Hz, beats] per bar, and the
 * chord under each bar. Instantly reads as Christmas; the ad's end resolves on a ringing C chord.
 */
const E5 = 659.25, F5 = 698.46, G5 = 783.99, C5 = 523.25, D5 = 587.33;
const JINGLE: [number, number][][] = [
  [[E5, 1], [E5, 1], [E5, 2]],
  [[E5, 1], [E5, 1], [E5, 2]],
  [[E5, 1], [G5, 1], [C5, 1.5], [D5, 0.5]],
  [[E5, 4]],
  [[F5, 1], [F5, 1], [F5, 1.5], [F5, 0.5]],
  [[F5, 1], [E5, 1], [E5, 1], [E5, 0.5], [E5, 0.5]],
  [[E5, 1], [D5, 1], [D5, 1], [E5, 1]],
  [[D5, 2], [G5, 2]],
];
const C_CHORD = { root: 65.41, chord: [261.63, 329.63, 392.0] };
const F_CHORD = { root: 43.65, chord: [174.61, 220.0, 261.63] };
const D7_CHORD = { root: 73.42, chord: [220.0, 261.63, 293.66, 369.99] };
const G_CHORD = { root: 49.0, chord: [196.0, 246.94, 293.66] };
const JINGLE_CHORDS = [C_CHORD, C_CHORD, C_CHORD, C_CHORD, F_CHORD, C_CHORD, D7_CHORD, G_CHORD];

/** I–vi–IV–V in C: C Am F G — bright and seasonal. */
function synthesizeHoliday(plan: MusicPlan): MusicResult {
  const { durationSec, bpm } = plan;
  const rand = rng(plan.seed ?? 7);
  const total = Math.ceil((durationSec + 2) * SAMPLE_RATE);
  const bus: Bus = { l: new Float32Array(total), r: new Float32Array(total) };
  const beat = 60 / bpm;
  const beatsTotal = Math.floor(durationSec / beat);
  const preDrop = (t: number) => t < plan.dropSec - 1e-6;
  const bells = sleigh(rand);
  const K = kick();

  for (let b = 0; b < beatsTotal; b++) {
    const t = b * beat;
    // Sleigh bells on the 8ths (accent on the off-beat), lighter before the drop.
    // Sleigh bells on the off-beat only, light — a sparkle, not a rhythm section.
    addMono(bus, t + beat / 2, bells, preDrop(t) ? 0.035 : 0.05, -0.25);
    // A soft, low kick on 1 and 3 after the drop — a pulse, not a club beat.
    if (!preDrop(t) && b % 2 === 0) addMono(bus, t, K, 0.3);
  }
  for (let bar = 0; bar * 4 * beat < durationSec; bar++) {
    const t0 = bar * 4 * beat;
    const { root, chord } = JINGLE_CHORDS[bar % JINGLE_CHORDS.length];
    // Piano chords on 1 and 3 (2 beats each).
    for (const half of [0, 2]) {
      const t = t0 + half * beat;
      if (t >= durationSec) continue;
      chord.forEach((f, k) => addMono(bus, t, epiano(f, 2 * beat), 0.045, k === 0 ? -0.3 : k === 2 ? 0.3 : 0));
    }
    // Sine bass on the beat.
    for (let q = 0; q < 4; q++) {
      const t = t0 + q * beat;
      if (t >= durationSec) continue;
      addMono(bus, t, sineBass(q === 2 ? root * 1.5 : root, beat * 0.9), preDrop(t) ? 0.18 : 0.26);
    }
    // The melody on celesta, doubled an octave down on soft piano for warmth.
    let at = t0;
    for (const [f, len] of JINGLE[bar % JINGLE.length]) {
      if (at < durationSec) {
        addMono(bus, at, bell(f, Math.max(0.6, len * beat + 0.3)), 0.16, 0.1);
        addMono(bus, at, epiano(f / 2, len * beat), 0.06, -0.1);
      }
      at += len * beat;
    }
  }
  // A bright chime on the drop and a ringing tonic chord to close — no crashes.
  for (const f of [1046.5, 1318.5, 1568.0]) addMono(bus, plan.dropSec, bell(f, 1.6), 0.05);
  const lastBeat = Math.max(0, beatsTotal - 1) * beat;
  for (const f of C_CHORD.chord) addMono(bus, lastBeat, epiano(f, 2.2), 0.12);
  for (const f of [523.25, 659.25, 783.99]) addMono(bus, lastBeat, bell(f, 1.8), 0.06);

  const n = Math.round(durationSec * SAMPLE_RATE);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  let peak = 1e-9;
  for (let i = 0; i < n; i++) {
    const fade = Math.min(1, (n - i) / (0.25 * SAMPLE_RATE));
    left[i] = Math.tanh(bus.l[i]) * fade;
    right[i] = Math.tanh(bus.r[i]) * fade;
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  }
  const norm = 0.8 / peak;
  for (let i = 0; i < n; i++) {
    left[i] *= norm;
    right[i] *= norm;
  }
  const beats: number[] = [];
  for (let b = 0; b <= beatsTotal; b++) beats.push(Math.round(b * beat * 1000) / 1000);
  return { left, right, bpm, beats };
}

/**
 * Render the bed for the plan's mood, normalised to BED_LUFS (−14 LUFS) under a −1 dBFS ceiling so
 * every mood enters the mix at the same loudness. Pure and deterministic for a seed.
 */
export function synthesizeMusic(plan: MusicPlan): MusicResult {
  const mood = plan.mood ?? "pop";
  const spec = mood in MOOD_SPECS ? MOOD_SPECS[mood as keyof typeof MOOD_SPECS] : null;
  // An unknown mood (stale data) gets the default bed rather than failing the render.
  const out = mood === "holiday" ? synthesizeHoliday(plan) : spec ? synthesizeMood(plan, spec) : synthesizePop(plan);
  normalizeLoudness(out.left, out.right, BED_LUFS, BED_CEILING);
  return out;
}

/** The original pop/EDM bed. */
function synthesizePop(plan: MusicPlan): MusicResult {
  const { durationSec, bpm } = plan;
  const energy = Math.max(0, Math.min(1, plan.energy ?? 0.75));
  const rand = rng(plan.seed ?? 7);
  const total = Math.ceil((durationSec + 1.5) * SAMPLE_RATE); // room for the crash tail, trimmed after
  const drums: Bus = { l: new Float32Array(total), r: new Float32Array(total) };
  const music: Bus = { l: new Float32Array(total), r: new Float32Array(total) };
  const beat = 60 / bpm;
  const beatsTotal = Math.floor(durationSec / beat);
  const breakdown = plan.breakdownSec ?? null;
  const inBreakdown = (t: number) => breakdown !== null && t >= breakdown && t < breakdown + 4 * beat - 1e-6;
  const preDrop = (t: number) => t < plan.dropSec - 1e-6;

  const K = kick();
  const clap = noiseHit(0.22, 22, 900, rand, 190);
  const hatClosed = noiseHit(0.05, 90, 7000, rand);
  const hatOpen = noiseHit(0.18, 22, 6500, rand);
  const kickTimes: number[] = [];

  for (let b = 0; b < beatsTotal; b++) {
    const t = b * beat;
    const pos = b % 4;
    // Kick: four on the floor; in the hook only on 1 and 3 so the drop lands harder.
    if (!inBreakdown(t) && (!preDrop(t) || pos % 2 === 0)) {
      addMono(drums, t, K, 0.72);
      kickTimes.push(t);
    }
    if (!inBreakdown(t) && !preDrop(t) && (pos === 1 || pos === 3)) addMono(drums, t, clap, 0.42 * (0.7 + 0.3 * energy), 0.05);
    // Hats: 8ths (closed on the beat, open on the off-beat), 16ths at high energy.
    if (!inBreakdown(t)) {
      addMono(drums, t, hatClosed, 0.16, 0.25);
      addMono(drums, t + beat / 2, hatOpen, preDrop(t) ? 0.1 : 0.17, -0.2);
      if (energy > 0.6 && !preDrop(t)) {
        addMono(drums, t + beat / 4, hatClosed, 0.07, 0.3);
        addMono(drums, t + (3 * beat) / 4, hatClosed, 0.07, -0.3);
      }
    }
  }

  // Chords change every bar.
  for (let bar = 0; bar * 4 * beat < durationSec; bar++) {
    const t0 = bar * 4 * beat;
    const { root, chord } = PROGRESSION[bar % PROGRESSION.length];
    // Pad: wide, slow attack, through the whole bar.
    for (const [k, f] of chord.entries()) {
      const padGain = inBreakdown(t0) ? 0.2 : 0.12;
      addMono(music, t0, sawVoice(f, 4 * beat + 0.05, 1600 + 1400 * energy, 0.04, 0.12), padGain, k === 0 ? -0.5 : k === 1 ? 0.5 : 0);
    }
    // Bass: 8th notes (octave jump on the off-beat), silent in the breakdown.
    for (let e = 0; e < 8; e++) {
      const t = t0 + (e * beat) / 2;
      if (t >= durationSec || inBreakdown(t)) continue;
      const f = e % 2 ? root * 2 : root;
      addMono(music, t, sawVoice(f, beat / 2 - 0.01, 520, 0.004, 0.03, 0.003), preDrop(t) ? 0.22 : 0.34);
    }
    // Pluck arpeggio after the drop.
    for (let s = 0; s < 16; s++) {
      const t = t0 + (s * beat) / 4;
      if (t >= durationSec || preDrop(t) || (energy < 0.5 && s % 2)) continue;
      const note = chord[[0, 1, 2, 1][s % 4]] * 2;
      addMono(music, t, pluck(note, 0.22), inBreakdown(t) ? 0.13 : 0.1, s % 2 ? 0.35 : -0.35);
    }
  }

  // Riser into the drop, a hit on it, and a final hit + crash on the last beat.
  if (plan.dropSec > 0.6) addMono(drums, plan.dropSec - Math.min(1.6, plan.dropSec), riser(Math.min(1.6, plan.dropSec), rand), 0.22);
  // The breakdown builds back into the groove with its own riser.
  if (breakdown !== null) addMono(drums, breakdown + 2 * beat, riser(2 * beat, rand), 0.2);
  const crash = noiseHit(1.4, 2.6, 4000, rand);
  addMono(drums, plan.dropSec, crash, 0.22);
  const lastBeat = Math.max(0, beatsTotal - 1) * beat;
  addMono(drums, lastBeat, K, 1.0);
  addMono(drums, lastBeat, crash, 0.3);
  if (plan.ctaSec) addMono(drums, plan.ctaSec, crash, 0.16);

  // Side-chain pump: the music ducks under every kick.
  const pumped: Bus = { l: new Float32Array(total), r: new Float32Array(total) };
  let k = 0;
  for (let i = 0; i < total; i++) {
    const t = i / SAMPLE_RATE;
    while (k + 1 < kickTimes.length && kickTimes[k + 1] <= t) k++;
    const since = kickTimes.length && kickTimes[k] <= t ? t - kickTimes[k] : 1;
    const g = 1 - 0.55 * Math.exp(-since * 9);
    pumped.l[i] = music.l[i] * g + drums.l[i];
    pumped.r[i] = music.r[i] * g + drums.r[i];
  }

  // Trim to the ad, 30 ms fade at the end, soft-clip and normalise to -1 dBFS.
  const n = Math.round(durationSec * SAMPLE_RATE);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  let peak = 1e-9;
  for (let i = 0; i < n; i++) {
    const fade = Math.min(1, (n - i) / (0.03 * SAMPLE_RATE));
    left[i] = Math.tanh(pumped.l[i] * 1.2) * fade;
    right[i] = Math.tanh(pumped.r[i] * 1.2) * fade;
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  }
  const norm = 0.89 / peak;
  for (let i = 0; i < n; i++) {
    left[i] *= norm;
    right[i] *= norm;
  }
  const beats: number[] = [];
  for (let b = 0; b <= beatsTotal; b++) beats.push(Math.round(b * beat * 1000) / 1000);
  return { left, right, bpm, beats };
}


// ─── Loudness (ITU-R BS.1770-4 integrated, gated) ─────────────────────────────

type Biquad = [number, number, number, number, number]; // b0 b1 b2 a1 a2 (a0 = 1)

/** The K-weighting pre-filter (high shelf +4 dB at ~1.5 kHz, then a ~38 Hz high-pass), for any sample rate. */
function kWeighting(fs: number): Biquad[] {
  const shelf = (() => {
    const G = 3.999843853973347, f0 = 1681.974450955533, Q = 0.7071752369554196;
    const K = Math.tan((Math.PI * f0) / fs);
    const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
    const a0 = 1 + K / Q + K * K;
    return [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] as Biquad;
  })();
  const highpass = (() => {
    const f0 = 38.13547087602444, Q = 0.5003270373238773;
    const K = Math.tan((Math.PI * f0) / fs);
    const a0 = 1 + K / Q + K * K;
    return [1 / a0, -2 / a0, 1 / a0, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] as Biquad;
  })();
  return [shelf, highpass];
}

function filterBiquads(x: Float32Array, stages: Biquad[]): Float64Array {
  let y = Float64Array.from(x);
  for (const [b0, b1, b2, a1, a2] of stages) {
    const out = new Float64Array(y.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < y.length; i++) {
      const v = b0 * y[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = y[i];
      y2 = y1;
      y1 = v;
      out[i] = v;
    }
    y = out;
  }
  return y;
}

/** Integrated loudness (LUFS) of a stereo signal: K-weighted, 400 ms blocks at 75 % overlap, −70 LUFS absolute and −10 LU relative gates. */
export function integratedLufs(left: Float32Array, right: Float32Array, fs = SAMPLE_RATE): number {
  const k = kWeighting(fs);
  const chans = [filterBiquads(left, k), filterBiquads(right, k)];
  const block = Math.round(0.4 * fs);
  const hop = Math.round(0.1 * fs);
  const z: number[] = [];
  for (let s = 0; s + block <= left.length; s += hop) {
    let sum = 0;
    for (const c of chans) {
      let m = 0;
      for (let i = s; i < s + block; i++) m += c[i] * c[i];
      sum += m / block;
    }
    z.push(sum);
  }
  const lufs = (v: number) => -0.691 + 10 * Math.log10(Math.max(1e-12, v));
  const abs = z.filter((v) => lufs(v) > -70);
  if (!abs.length) return -Infinity;
  const rel = lufs(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const gated = abs.filter((v) => lufs(v) > rel);
  return lufs(gated.reduce((a, b) => a + b, 0) / Math.max(1, gated.length));
}

/**
 * Scale a stereo signal in place to `target` LUFS; peaks that would pass `ceiling` are soft-limited
 * (tanh knee from 70 % of the ceiling), then the loudness is re-measured and corrected (≤ 4 passes).
 */
export function normalizeLoudness(left: Float32Array, right: Float32Array, target = BED_LUFS, ceiling = BED_CEILING): void {
  const knee = 0.7 * ceiling;
  const soft = (x: number) => {
    const a = Math.abs(x);
    return a <= knee ? x : Math.sign(x) * (knee + (ceiling - knee) * Math.tanh((a - knee) / (ceiling - knee)));
  };
  for (let pass = 0; pass < 4; pass++) {
    const now = integratedLufs(left, right);
    if (!Number.isFinite(now) || Math.abs(now - target) < 0.05) break;
    const g = Math.pow(10, (target - now) / 20);
    for (let i = 0; i < left.length; i++) {
      left[i] = soft(left[i] * g);
      right[i] = soft(right[i] * g);
    }
  }
  for (let i = 0; i < left.length; i++) {
    left[i] = Math.max(-ceiling, Math.min(ceiling, left[i]));
    right[i] = Math.max(-ceiling, Math.min(ceiling, right[i]));
  }
}

// ─── Mood engine: a 16th-note pattern sequencer over the same synth primitives ─

const midi = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

type DrumName = "kick" | "snare" | "clap" | "cajon" | "hat" | "openHat" | "shaker" | "tom" | "snap";
type ChordVoice = "epiano" | "pad" | "strum" | "stab" | "bell";

/**
 * One mood's arrangement. Patterns are 16th-note steps within a bar (0–15), or within two bars
 * (0–31) for phrases that answer themselves. Chords are MIDI notes; the bass plays the chord's
 * `bass` note plus an interval in semitones.
 */
export interface MoodSpec {
  progression: { bass: number; tones: number[] }[];
  /** Index of the tonic chord (the ending resolves to it). */
  tonic: number;
  /** Delay of the off-beat 8ths as a share of half a beat (0 = straight). */
  swing: number;
  drums: Partial<Record<DrumName, number[]>>;
  /** Drum pattern in the hook (before the drop): lighter, the drop lands harder. */
  intro: Partial<Record<DrumName, number[]>>;
  drumGain?: Partial<Record<DrumName, number>>;
  bass: { voice: "sine" | "saw"; notes: [step: number, interval: number, len16: number][]; gain: number };
  chords: { voice: ChordVoice; hits: [step: number, len16: number, dir?: 1 | -1][]; gain: number; octave?: number }[];
  lead?: { voice: "pluck" | "bell"; notes: [step: number, tone: number, octave: number][]; gain: number; fromDrop: boolean };
  /** Side-chain depth under the kick (0 = none). */
  pump: number;
  /** One-pole low-pass on the music bus (Hz): the dusty lo-fi top end. */
  lowpass?: number;
  /** Vinyl crackle level. */
  crackle?: number;
  /** Intensity rises across the ad (cinematic). */
  build?: boolean;
  dropHit: "crash" | "chime" | "braam" | "none";
  risers: boolean;
  ending: "hit" | "ring";
}

const DRUM_GAIN: Record<DrumName, number> = { kick: 0.7, snare: 0.4, clap: 0.42, cajon: 0.32, hat: 0.13, openHat: 0.14, shaker: 0.08, tom: 0.45, snap: 0.25 };

export const MOOD_SPECS: Record<Exclude<MoodId, "pop" | "holiday">, MoodSpec> = {
  // Bright radio pop in G: I–V–vi–IV, off-beat piano, claps on 2 and 4, a plucked two-bar hook.
  "upbeat-pop": {
    progression: [
      { bass: 31, tones: [55, 59, 62] }, // G
      { bass: 38, tones: [54, 57, 62] }, // D
      { bass: 40, tones: [55, 59, 64] }, // Em
      { bass: 36, tones: [55, 60, 64] }, // C
    ],
    tonic: 0,
    swing: 0,
    drums: { kick: [0, 8, 10], clap: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], shaker: [1, 3, 5, 7, 9, 11, 13, 15] },
    intro: { kick: [0, 8], hat: [0, 4, 8, 12] },
    drumGain: { shaker: 0.05 },
    bass: { voice: "saw", notes: [[0, 0, 3], [3, 0, 1], [6, 7, 2], [8, 0, 3], [11, 0, 1], [14, 12, 2]], gain: 0.3 },
    chords: [
      { voice: "epiano", hits: [[2, 2], [6, 2], [10, 2], [14, 2]], gain: 0.07 },
      { voice: "pad", hits: [[0, 16]], gain: 0.03 },
    ],
    lead: { voice: "pluck", notes: [[0, 2, 1], [3, 1, 1], [6, 0, 1], [8, 1, 1], [10, 2, 1], [12, 2, 1], [16, 2, 1], [19, 1, 1], [22, 2, 1], [24, 0, 2], [28, 2, 1]], gain: 0.11, fromDrop: true },
    pump: 0.25,
    dropHit: "crash",
    risers: true,
    ending: "hit",
  },
  // Lo-fi hip-hop: swung boom-bap, dusty 9th/13th e-piano chords (ii–V–I–vi in C), a lazy bell line, crackle.
  "chill-lofi": {
    progression: [
      { bass: 38, tones: [53, 57, 60, 64] }, // Dm9
      { bass: 31, tones: [53, 59, 64] }, // G13
      { bass: 36, tones: [52, 55, 59, 62] }, // Cmaj9
      { bass: 33, tones: [55, 60, 64] }, // Am7
    ],
    tonic: 2,
    swing: 0.22,
    drums: { kick: [0, 7, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14] },
    intro: { kick: [0, 10], hat: [0, 4, 8, 12] },
    drumGain: { kick: 0.62, snare: 0.32, hat: 0.06 },
    bass: { voice: "sine", notes: [[0, 0, 6], [7, 0, 2], [10, 7, 4], [14, 12, 2]], gain: 0.3 },
    chords: [{ voice: "epiano", hits: [[0, 10], [10, 6]], gain: 0.075 }],
    lead: { voice: "bell", notes: [[3, 3, 1], [6, 2, 1], [11, 1, 1], [19, 2, 1], [22, 0, 1], [27, 1, 1]], gain: 0.06, fromDrop: true },
    pump: 0.12,
    lowpass: 2600,
    crackle: 0.025,
    dropHit: "none",
    risers: false,
    ending: "ring",
  },
  // Trailer build in A minor: i–VI–III–VII strings swelling over the ad, toms, a pulsing 8th ostinato, a braam on the drop.
  "cinematic-build": {
    progression: [
      { bass: 33, tones: [57, 60, 64] }, // Am
      { bass: 29, tones: [57, 60, 65] }, // F
      { bass: 36, tones: [55, 60, 64] }, // C
      { bass: 31, tones: [55, 59, 62] }, // G
    ],
    tonic: 0,
    swing: 0,
    drums: { kick: [0, 8], tom: [0, 3, 6, 10, 12, 14], clap: [4, 12] },
    intro: { kick: [0, 8], tom: [6, 12] },
    drumGain: { kick: 0.75, tom: 0.4, clap: 0.3 },
    bass: { voice: "saw", notes: [[0, 0, 4], [4, 0, 4], [8, 0, 4], [12, 0, 4]], gain: 0.26 },
    chords: [
      { voice: "pad", hits: [[0, 16]], gain: 0.075 },
      { voice: "pad", hits: [[0, 16]], gain: 0.04, octave: -12 },
    ],
    lead: { voice: "pluck", notes: [[0, 0, 1], [2, 0, 2], [4, 0, 1], [6, 1, 1], [8, 0, 1], [10, 0, 2], [12, 0, 1], [14, 2, 1]], gain: 0.09, fromDrop: true },
    pump: 0,
    build: true,
    dropHit: "braam",
    risers: true,
    ending: "hit",
  },
  // Festival house in F minor: four on the floor, off-beat bass, supersaw stabs, an 8th arpeggio, hard side-chain.
  "energetic-edm": {
    progression: [
      { bass: 29, tones: [56, 60, 65] }, // Fm
      { bass: 37, tones: [56, 61, 65] }, // Db
      { bass: 32, tones: [56, 60, 63] }, // Ab
      { bass: 39, tones: [55, 58, 63] }, // Eb
    ],
    tonic: 0,
    swing: 0,
    drums: { kick: [0, 4, 8, 12], clap: [4, 12], openHat: [2, 6, 10, 14], hat: [1, 3, 5, 7, 9, 11, 13, 15] },
    intro: { kick: [0, 4, 8, 12], hat: [0, 4, 8, 12] },
    drumGain: { kick: 0.8, openHat: 0.07, hat: 0.045 },
    bass: { voice: "saw", notes: [[2, 0, 2], [6, 0, 2], [10, 0, 2], [14, 12, 2]], gain: 0.36 },
    chords: [
      { voice: "stab", hits: [[0, 2], [3, 2], [6, 2], [10, 2], [13, 2]], gain: 0.06 },
      { voice: "pad", hits: [[0, 16]], gain: 0.025 },
    ],
    lead: { voice: "pluck", notes: [[0, 0, 1], [2, 1, 1], [4, 2, 1], [6, 1, 1], [8, 0, 2], [10, 2, 1], [12, 1, 1], [14, 2, 1]], gain: 0.08, fromDrop: true },
    pump: 0.4,
    dropHit: "crash",
    risers: true,
    ending: "hit",
  },
  // Strummed acoustic in D: I–vi–IV–V, cajón on 2 and 4, shaker, a glockenspiel melody.
  "warm-acoustic": {
    progression: [
      { bass: 38, tones: [50, 57, 62, 66] }, // D
      { bass: 35, tones: [47, 54, 59, 62] }, // Bm
      { bass: 31, tones: [43, 50, 55, 59] }, // G
      { bass: 33, tones: [45, 52, 57, 61] }, // A
    ],
    tonic: 0,
    swing: 0.08,
    drums: { kick: [0, 8], cajon: [4, 12], shaker: [0, 2, 4, 6, 8, 10, 12, 14] },
    intro: { kick: [0, 8], shaker: [0, 4, 8, 12] },
    drumGain: { kick: 0.5, cajon: 0.3, shaker: 0.07 },
    bass: { voice: "sine", notes: [[0, 0, 4], [6, 7, 2], [8, 0, 4], [14, 7, 2]], gain: 0.26 },
    chords: [{ voice: "strum", hits: [[0, 4, 1], [4, 2, 1], [6, 2, -1], [10, 2, -1], [12, 2, 1], [14, 2, -1]], gain: 0.05 }],
    lead: { voice: "bell", notes: [[0, 3, 1], [4, 2, 1], [6, 1, 1], [8, 2, 1], [16, 3, 1], [20, 1, 1], [24, 0, 2]], gain: 0.055, fromDrop: true },
    pump: 0,
    dropHit: "chime",
    risers: false,
    ending: "ring",
  },
  // Premium and sparse: descending maj7 chords (IVmaj7–iii7–ii7–Imaj9 in C), deep sine bass, snaps, a few bell notes.
  "luxury-minimal": {
    progression: [
      { bass: 29, tones: [53, 57, 60, 64] }, // Fmaj7
      { bass: 28, tones: [52, 55, 59, 62] }, // Em7
      { bass: 38, tones: [50, 53, 57, 60] }, // Dm7
      { bass: 36, tones: [52, 55, 59, 62] }, // Cmaj9
    ],
    tonic: 3,
    swing: 0,
    drums: { kick: [0, 8], snap: [4, 12], shaker: [2, 6, 10, 14] },
    intro: { kick: [0, 8], snap: [4, 12] },
    drumGain: { kick: 0.5, snap: 0.24, shaker: 0.04 },
    bass: { voice: "sine", notes: [[0, 0, 14]], gain: 0.3 },
    chords: [{ voice: "epiano", hits: [[0, 16]], gain: 0.07 }],
    lead: { voice: "bell", notes: [[0, 3, 1], [8, 2, 1], [16, 1, 1], [22, 2, 1], [24, 3, 1]], gain: 0.06, fromDrop: true },
    pump: 0,
    dropHit: "chime",
    risers: false,
    ending: "ring",
  },
};

function drumKit(rand: () => number): Record<DrumName, Float32Array> {
  return {
    kick: kick(),
    snare: noiseHit(0.2, 20, 1200, rand, 185),
    clap: noiseHit(0.22, 22, 900, rand, 190),
    cajon: noiseHit(0.16, 26, 500, rand, 140),
    hat: noiseHit(0.05, 90, 7000, rand),
    openHat: noiseHit(0.18, 22, 6500, rand),
    shaker: noiseHit(0.07, 55, 5200, rand),
    tom: kick(82, 70, 6, 0.6),
    snap: noiseHit(0.05, 80, 2500, rand),
  };
}

/** The pattern sequencer: drums, bass, chords and lead per the spec, shaped by the ad's drop / breakdown / CTA. */
function synthesizeMood(plan: MusicPlan, spec: MoodSpec): MusicResult {
  const { durationSec, bpm } = plan;
  const energy = Math.max(0, Math.min(1, plan.energy ?? MOOD_ENERGY[plan.mood ?? "upbeat-pop"]));
  const rand = rng(plan.seed ?? 7);
  const total = Math.ceil((durationSec + 2.5) * SAMPLE_RATE);
  const drums: Bus = { l: new Float32Array(total), r: new Float32Array(total) };
  const music: Bus = { l: new Float32Array(total), r: new Float32Array(total) };
  const beat = 60 / bpm;
  const s16 = beat / 4;
  const bar = 4 * beat;
  const beatsTotal = Math.floor(durationSec / beat + 1e-6);
  const breakdown = plan.breakdownSec ?? null;
  const inBreakdown = (t: number) => breakdown !== null && t >= breakdown - 1e-6 && t < breakdown + bar - 1e-6;
  const preDrop = (t: number) => t < plan.dropSec - 1e-6;
  const swingAt = (step: number) => (step % 4 === 2 ? spec.swing * (beat / 2) : 0);
  const cycle = (steps: number[]) => (steps.some((s) => s >= 16) ? 32 : 16);
  /** Times of a pattern's steps across the ad. */
  const times = (steps: number[]): { t: number; step: number; bar: number }[] => {
    const c = cycle(steps);
    const out: { t: number; step: number; bar: number }[] = [];
    for (let b = 0; b * bar < durationSec; b++) {
      for (const s of steps) {
        if (Math.floor(s / 16) !== b % (c / 16)) continue;
        const local = s % 16;
        const t = b * bar + local * s16 + swingAt(local);
        if (t < durationSec - 1e-6) out.push({ t, step: local, bar: b });
      }
    }
    return out;
  };
  const chordAt = (b: number) => spec.progression[b % spec.progression.length];
  const build = (t: number) => (spec.build ? 0.55 + 0.45 * Math.min(1, t / Math.max(1, durationSec - 1)) : 1);

  // Drums.
  const kit = drumKit(rand);
  const kickTimes: number[] = [];
  const names = new Set<DrumName>([...Object.keys(spec.drums), ...Object.keys(spec.intro)] as DrumName[]);
  for (const name of names) {
    const gain = spec.drumGain?.[name] ?? DRUM_GAIN[name];
    const pan = name === "hat" || name === "shaker" ? 0.25 : name === "openHat" ? -0.2 : name === "tom" ? -0.1 : 0;
    const full = times(spec.drums[name] ?? []);
    const intro = times(spec.intro[name] ?? []);
    for (const { t, step } of [...intro.filter((x) => preDrop(x.t)), ...full.filter((x) => !preDrop(x.t))]) {
      // In the breakdown only the light top (hats, shaker) keeps time.
      if (inBreakdown(t) && !(name === "hat" || name === "shaker")) continue;
      // Hats/shaker 16ths thin out at low energy.
      if ((name === "hat" || name === "shaker") && step % 2 === 1 && energy < 0.45) continue;
      addMono(drums, t, kit[name], gain * build(t) * (inBreakdown(t) ? 0.6 : 1), pan);
      if (name === "kick") kickTimes.push(t);
    }
  }
  kickTimes.sort((a, b) => a - b);

  // Bass.
  for (const [step, interval, len] of spec.bass.notes) {
    for (const { t, bar: b } of times([step])) {
      if (inBreakdown(t)) continue;
      const f = midi(chordAt(b).bass + interval);
      const dur = Math.max(0.08, len * s16 - 0.01);
      const voice = spec.bass.voice === "sine" ? sineBass(f, dur) : sawVoice(f, dur, 520, 0.004, 0.03, 0.003);
      addMono(music, t, voice, spec.bass.gain * (preDrop(t) ? 0.7 : 1) * build(t));
    }
  }

  // Chords.
  for (const layer of spec.chords) {
    for (const [step, len, dir] of layer.hits) {
      for (const { t, bar: b } of times([step])) {
        const tones = chordAt(b).tones.map((m) => midi(m + (layer.octave ?? 0)));
        const dur = len * s16;
        const g = layer.gain * (inBreakdown(t) ? 1.4 : 1) * build(t);
        tones.forEach((f, k) => {
          const pan = tones.length > 1 ? -0.4 + (0.8 * k) / (tones.length - 1) : 0;
          if (layer.voice === "epiano") addMono(music, t, epiano(f, dur + 0.05), g, pan);
          else if (layer.voice === "pad") addMono(music, t, sawVoice(f, dur + 0.05, 1100 + 900 * energy, Math.min(0.35, dur / 3), Math.min(0.3, dur / 3), 0.008), g, pan);
          else if (layer.voice === "stab") addMono(music, t, sawVoice(f, Math.max(0.12, dur - 0.02), 3200, 0.004, 0.06, 0.014), g, pan);
          else if (layer.voice === "bell") addMono(music, t, bell(f, dur + 0.6), g, pan);
          else {
            // Strum: strings 14 ms apart, low → high on a down-stroke, the reverse (and softer) on an up-stroke.
            const order = dir === -1 ? tones.length - 1 - k : k;
            addMono(music, t + order * 0.014, pluck(f, dur + 0.25, 3.2, 5), g * (dir === -1 ? 0.75 : 1), pan);
          }
        });
      }
    }
  }

  // Lead.
  if (spec.lead) {
    const lead = spec.lead;
    for (const [step, tone, octave] of lead.notes) {
      for (const { t, bar: b } of times([step])) {
        if (lead.fromDrop && preDrop(t)) continue;
        const tones = chordAt(b).tones;
        const f = midi(tones[tone % tones.length] + 12 * octave);
        const v = lead.voice === "bell" ? bell(f, 1.2) : pluck(f, 0.26, 12);
        addMono(music, t, v, lead.gain * (inBreakdown(t) ? 1.2 : 1) * build(t), step % 2 ? 0.3 : -0.3);
      }
    }
  }

  // Drop, breakdown, CTA and ending accents.
  const crash = noiseHit(1.4, 2.6, 4000, rand);
  const tonic = spec.progression[spec.tonic];
  if (spec.risers && plan.dropSec > 0.6) addMono(drums, plan.dropSec - Math.min(1.6, plan.dropSec), riser(Math.min(1.6, plan.dropSec), rand), 0.2);
  if (spec.risers && breakdown !== null) addMono(drums, breakdown + 2 * beat, riser(2 * beat, rand), 0.18);
  if (spec.dropHit === "crash") addMono(drums, plan.dropSec, crash, 0.2);
  if (spec.dropHit === "chime") for (const m of tonic.tones.slice(-3)) addMono(music, plan.dropSec, bell(midi(m + 24), 1.4), 0.035);
  if (spec.dropHit === "braam") {
    for (const m of [tonic.bass + 12, tonic.bass + 19, tonic.bass + 24]) addMono(music, plan.dropSec, sawVoice(midi(m), 1.6, 700, 0.02, 1.0, 0.012), 0.09);
    addMono(drums, plan.dropSec, kit.tom, 0.6);
  }
  if (plan.ctaSec && spec.dropHit === "crash") addMono(drums, plan.ctaSec, crash, 0.14);
  const lastBeat = Math.max(0, beatsTotal - 1) * beat;
  if (spec.ending === "hit") {
    addMono(drums, lastBeat, kit.kick, 0.9);
    addMono(drums, lastBeat, crash, 0.22);
  }
  for (const m of tonic.tones) addMono(music, lastBeat, epiano(midi(m), 2.4), spec.ending === "ring" ? 0.08 : 0.05);
  if (spec.ending === "ring") for (const m of tonic.tones.slice(-2)) addMono(music, lastBeat, bell(midi(m + 12), 2), 0.04);

  // Vinyl crackle (seeded): sparse clicks over a faint hiss.
  if (spec.crackle) {
    let lp = 0;
    for (let i = 0; i < total; i++) {
      lp = 0.9 * lp + 0.1 * rand();
      drums.l[i] += lp * spec.crackle * 0.25;
      drums.r[i] += lp * spec.crackle * 0.25;
      if (rand() > 0.9993) {
        const amp = spec.crackle * (0.4 + 0.6 * Math.abs(rand()));
        for (let k = 0; k < 90 && i + k < total; k++) {
          const v = amp * Math.exp(-k / 12) * (k % 2 ? -1 : 1);
          drums.l[i + k] += v;
          drums.r[i + k] += v * 0.8;
        }
      }
    }
  }

  // Music-bus low-pass (lo-fi), then the side-chain pump under the kick.
  if (spec.lowpass) {
    const a = Math.exp((-2 * Math.PI * spec.lowpass) / SAMPLE_RATE);
    let l = 0, r = 0;
    for (let i = 0; i < total; i++) {
      l = (1 - a) * music.l[i] + a * l;
      r = (1 - a) * music.r[i] + a * r;
      music.l[i] = l;
      music.r[i] = r;
    }
  }
  const n = Math.round(durationSec * SAMPLE_RATE);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    while (k + 1 < kickTimes.length && kickTimes[k + 1] <= t) k++;
    const since = kickTimes.length && kickTimes[k] <= t ? t - kickTimes[k] : 1;
    const g = 1 - spec.pump * Math.exp(-since * 9);
    const fade = Math.min(1, (n - i) / (0.25 * SAMPLE_RATE));
    left[i] = Math.tanh((music.l[i] * g + drums.l[i]) * 1.1) * fade;
    right[i] = Math.tanh((music.r[i] * g + drums.r[i]) * 1.1) * fade;
  }
  const beats: number[] = [];
  for (let b = 0; b <= beatsTotal; b++) beats.push(Math.round(b * beat * 1000) / 1000);
  return { left, right, bpm, beats };
}

/** 16-bit PCM stereo WAV. */
export function toWav(left: Float32Array, right: Float32Array, sampleRate = SAMPLE_RATE): Buffer {
  const n = left.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left[i])) * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right[i])) * 32767), 46 + i * 4);
  }
  return buf;
}
