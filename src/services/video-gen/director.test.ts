import { describe, expect, it } from "vitest";
import { sampleTimes, shotIndexesFor } from "./director";

describe("sampleTimes", () => {
  it("takes the middle of each non-CTA beat, at most 8", () => {
    const frames = Array.from({ length: 10 }, (_, i) => ({ frameNumber: i + 1, startSec: i * 2, endSec: i * 2 + 2, segment: i >= 8 ? "CTA" : i === 0 ? "HOOK" : "BODY" }));
    expect(sampleTimes(frames)).toEqual(frames.slice(0, 8).map((f) => ({ frameNumber: f.frameNumber, t: f.startSec + 1 })));
    const long = Array.from({ length: 20 }, (_, i) => ({ frameNumber: i + 1, startSec: i * 2, endSec: i * 2 + 2 }));
    expect(sampleTimes(long)).toHaveLength(8);
  });
});

describe("shotIndexesFor", () => {
  it("maps flagged storyboard frames to the keyframe jobs that render them", () => {
    const jobs = [
      { kind: "upload", shotIndex: -1, settings: {} },
      { kind: "image", shotIndex: -1, settings: { castSheet: 1, coversFrames: [] } },
      { kind: "image", shotIndex: 1, settings: { frameNumber: 2, coversFrames: [2, 3] } },
      { kind: "image", shotIndex: 3, settings: { frameNumber: 4, coversFrames: [4, 5] } },
      { kind: "video", shotIndex: 1, settings: { coversFrames: [2, 3] } },
    ];
    expect(shotIndexesFor([3, 5], jobs)).toEqual([1, 3]);
    expect(shotIndexesFor([9], jobs)).toEqual([]);
  });
});
