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
export const SAMPLE_RATE = 44100;

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
   */
  mood?: "pop" | "holiday";
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

function kick(): Float32Array {
  const n = Math.round(0.42 * SAMPLE_RATE);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const f = 48 + 110 * Math.exp(-t * 32);
    phase += (2 * Math.PI * f) / SAMPLE_RATE;
    out[i] = Math.sin(phase) * Math.exp(-t * 7.5) + (i < 90 ? (Math.random() * 2 - 1) * 0.15 * (1 - i / 90) : 0);
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

function pluck(freq: number, dur: number): Float32Array {
  const n = Math.round(dur * SAMPLE_RATE);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const sq = Math.sin(2 * Math.PI * freq * t) + 0.35 * Math.sin(2 * Math.PI * freq * 2 * t) + 0.15 * Math.sin(2 * Math.PI * freq * 3 * t);
    out[i] = sq * Math.exp(-t * 14) * Math.min(1, t / 0.003);
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
function sleigh(rand: () => number, dur = 0.16): Float32Array {
  const n = Math.round(dur * SAMPLE_RATE);
  const out = new Float32Array(n);
  const freqs = [5200, 6150, 7300, 8400];
  const noise = noiseHit(dur, 26, 6500, rand);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    let v = 0;
    for (const f of freqs) v += Math.sin(2 * Math.PI * f * t + f);
    out[i] = (v * 0.12 + noise[i]) * Math.exp(-t * 24) * Math.min(1, t / 0.006);
  }
  return out;
}

/** I–vi–IV–V in C: C Am F G — bright and seasonal. */
const HOLIDAY_PROGRESSION: { root: number; chord: number[] }[] = [
  { root: 65.41, chord: [261.63, 329.63, 392.0] }, // C
  { root: 55.0, chord: [220.0, 261.63, 329.63] }, // Am
  { root: 43.65, chord: [174.61, 220.0, 261.63] }, // F
  { root: 49.0, chord: [196.0, 246.94, 293.66] }, // G
];

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
    addMono(bus, t, bells, preDrop(t) ? 0.05 : 0.07, 0.3);
    addMono(bus, t + beat / 2, bells, preDrop(t) ? 0.08 : 0.11, -0.25);
    // A soft, low kick on 1 and 3 after the drop — a pulse, not a club beat.
    if (!preDrop(t) && b % 2 === 0) addMono(bus, t, K, 0.3);
  }
  for (let bar = 0; bar * 4 * beat < durationSec; bar++) {
    const t0 = bar * 4 * beat;
    const { root, chord } = HOLIDAY_PROGRESSION[bar % HOLIDAY_PROGRESSION.length];
    // Piano chords on 1 and 3 (2 beats each).
    for (const half of [0, 2]) {
      const t = t0 + half * beat;
      if (t >= durationSec) continue;
      chord.forEach((f, k) => addMono(bus, t, epiano(f, 2 * beat), 0.075, k === 0 ? -0.3 : k === 2 ? 0.3 : 0));
    }
    // Sine bass on the beat.
    for (let q = 0; q < 4; q++) {
      const t = t0 + q * beat;
      if (t >= durationSec) continue;
      addMono(bus, t, sineBass(q === 2 ? root * 1.5 : root, beat * 0.9), preDrop(t) ? 0.18 : 0.26);
    }
    // Celesta arpeggio on quarter notes, two octaves up — sparse, so the voice stays in front.
    for (let q = 0; q < 4; q++) {
      const t = t0 + q * beat;
      if (t >= durationSec) continue;
      addMono(bus, t, bell(chord[[0, 1, 2, 1][q]] * 2, 0.9), 0.065, q % 2 ? 0.35 : -0.35);
    }
  }
  // A bright chime on the drop and a ringing tonic chord to close — no crashes.
  for (const f of [1046.5, 1318.5, 1568.0]) addMono(bus, plan.dropSec, bell(f, 1.6), 0.05);
  const lastBeat = Math.max(0, beatsTotal - 1) * beat;
  for (const f of HOLIDAY_PROGRESSION[0].chord) addMono(bus, lastBeat, epiano(f, 2.2), 0.14);
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

/** Render the bed. Pure apart from Math.random in the kick click (inaudible). */
export function synthesizeMusic(plan: MusicPlan): MusicResult {
  if (plan.mood === "holiday") return synthesizeHoliday(plan);
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
