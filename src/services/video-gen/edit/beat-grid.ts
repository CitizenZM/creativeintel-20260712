/**
 * The beat grid every cut, caption pop, accent and SFX snaps to.
 *
 * The music bed is synthesised (music-synth.ts), so its tempo is exact and the
 * grid is known, not detected. 120 BPM makes the storyboard's 2-second frames
 * exactly four beats, so frame boundaries already land on downbeats.
 */
export const FPS = 30;

export interface BeatGrid {
  bpm: number;
  /** Seconds per beat. */
  period: number;
  /** Beat times from 0 up to the end, inclusive of 0. */
  beats: number[];
  /** Every 4th beat (bar starts). */
  downbeats: number[];
}

export function beatGrid(durationSec: number, bpm = 120): BeatGrid {
  const period = 60 / bpm;
  const beats: number[] = [];
  for (let i = 0; i * period <= durationSec + 1e-6; i++) beats.push(round3(i * period));
  return { bpm, period, beats, downbeats: beats.filter((_, i) => i % 4 === 0) };
}

/** Nearest frame (not the next one — rounding up made every cut ~21 ms late). */
export function snapToFrame(t: number, fps = FPS): number {
  return Math.round(t * fps) / fps;
}

/** The beat nearest to t. */
export function nearestBeat(grid: BeatGrid, t: number): number {
  let best = grid.beats[0] ?? 0;
  for (const b of grid.beats) if (Math.abs(b - t) < Math.abs(best - t)) best = b;
  return best;
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
