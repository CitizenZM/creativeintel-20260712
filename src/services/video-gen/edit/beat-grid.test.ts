import { describe, expect, it } from "vitest";
import { beatGrid, CUT_SNAP_SEC, fitTempo, snapCut } from "./beat-grid";

describe("snapCut", () => {
  const g = beatGrid(10, 90); // beats every 0.667 s

  it("moves a cut onto the nearest beat within ±120 ms", () => {
    expect(CUT_SNAP_SEC).toBe(0.12);
    expect(snapCut(g, 2.05)).toEqual({ atSec: 2, onBeat: true });
    expect(snapCut(g, 1.3)).toEqual({ atSec: 1.333, onBeat: true });
  });

  it("leaves a cut on its own frame when the nearest beat is further than that", () => {
    expect(snapCut(g, 1)).toEqual({ atSec: 1, onBeat: false });
  });

  it("never moves a cut later when a voiceover line starts there (only earlier, so the picture leads the voice)", () => {
    expect(snapCut(g, 1.3, { voStart: true })).toEqual({ atSec: 1.3, onBeat: false });
    expect(snapCut(g, 1.4, { voStart: true })).toEqual({ atSec: 1.333, onBeat: true });
  });

  it("returns frame-exact times", () => {
    const g2 = beatGrid(10, 97);
    const s = snapCut(g2, 3);
    expect(Math.abs(s.atSec * 30 - Math.round(s.atSec * 30))).toBeLessThan(1e-6);
  });
});

describe("fitTempo", () => {
  it("picks the tempo in the mood's range that puts the most cuts on a beat, smallest total offset, then nearest the nominal, on ties", () => {
    // 2-second frames: 90 BPM puts every boundary on a beat; 85 almost none.
    expect(fitTempo([2, 4, 6, 8, 10, 12], { bpm: 85, min: 80, max: 92 })).toBe(90);
    // 1-second frames in a 112–122 range: 120.
    expect(fitTempo([1, 2, 3, 4, 5, 6, 7], { bpm: 118, min: 112, max: 122 })).toBe(120);
    // A fixed tempo stays.
    expect(fitTempo([1.3, 2.7], { bpm: 120, min: 120, max: 120 })).toBe(120);
    // No cuts: the nominal tempo.
    expect(fitTempo([], { bpm: 95, min: 86, max: 104 })).toBe(95);
  });
});
