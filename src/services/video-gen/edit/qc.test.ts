import { describe, expect, it } from "vitest";
import { parseCuts, parseLoudness, scoreQc } from "./qc";

describe("parseCuts", () => {
  it("keeps the strongest detection of a transition cluster", () => {
    const log = [
      "frame:0 pts:0 pts_time:7.7333",
      "lavfi.scene_score=0.31",
      "frame:1 pts:0 pts_time:7.8333",
      "lavfi.scene_score=0.82",
      "frame:2 pts:0 pts_time:12.0",
      "lavfi.scene_score=0.5",
    ].join("\n");
    expect(parseCuts(log)).toEqual([7.8333, 12]);
  });
});

describe("parseLoudness", () => {
  it("reads integrated loudness and true peak from the ebur128 summary", () => {
    expect(parseLoudness("...\nSummary:\n  I:  -14.3 LUFS\n  Peak: -1.8 dBFS")).toEqual({ lufs: -14.3, peak: -1.8 });
  });
});

describe("scoreQc", () => {
  const base = {
    durationSec: 20,
    cutsSec: [1.25, 2.5, 3.75],
    freezes: [],
    loudnessLufs: -14.2,
    truePeakDb: -1.8,
    beats: Array.from({ length: 33 }, (_, i) => i * 0.625), // 96 BPM, every second beat carries a cut
    plannedCuts: Array.from({ length: 14 }, (_, i) => (i + 1) * 1.25),
    hookHeadline: true,
    captionCoverage: 0.97,
    ctaSec: 16,
  };
  it("passes a paced, on-beat, normalised edit", () => {
    expect(scoreQc(base).checks.filter((c) => !c.pass).map((c) => c.key)).toEqual([]);
  });
  it("fails a slow, frozen, clipping edit with a long end card", () => {
    const r = scoreQc({ ...base, plannedCuts: [6, 12], freezes: [{ start: 3, duration: 2.5 }], truePeakDb: 1.2, ctaSec: 12, cutsSec: [6.06, 12] });
    expect(r.checks.filter((c) => !c.pass).map((c) => c.key)).toEqual(
      expect.arrayContaining(["first_cut_s", "cuts_per_15s", "avg_shot_s", "longest_static_s", "beat_max_ms", "end_card_s", "true_peak_dbfs"])
    );
  });
  it("judges beat timing only on cuts the plan put on the beat (a cut kept on its frame for the voiceover is not an error)", () => {
    const off = { ...base, cutsSec: [1.25, 2.5, 3.4, 3.75] };
    expect(scoreQc(off).checks.find((c) => c.key === "beat_max_ms")!.pass).toBe(false);
    const r = scoreQc({ ...off, offBeatCuts: [3.4] });
    expect(r.checks.find((c) => c.key === "beat_max_ms")!.pass).toBe(true);
    expect(r.checks.find((c) => c.key === "beat_bias_ms")!.pass).toBe(true);
  });
});
