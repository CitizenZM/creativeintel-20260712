import { describe, expect, it } from "vitest";
import { canvasFor, planSegments } from "./glm-assemble";

const frames = [1, 2, 3, 4, 5].map((n) => ({ frameNumber: n, startSec: (n - 1) * 2, endSec: n * 2 }));

describe("planSegments", () => {
  it("cuts each frame's window from the clip that covers it and holds CTA frames on a still", () => {
    const jobs = [
      { kind: "video", status: "completed", resultUrl: "v1.mp4", settings: { coversFrames: [1, 2], frameOffsetsSec: [
        { frameNumber: 1, clipStartSec: 0, clipEndSec: 2 },
        { frameNumber: 2, clipStartSec: 2, clipEndSec: 4 },
      ] } },
      { kind: "video", status: "completed", resultUrl: "v3.mp4", settings: { coversFrames: [3, 4], frameOffsetsSec: [
        { frameNumber: 3, clipStartSec: 0, clipEndSec: 2 },
        { frameNumber: 4, clipStartSec: 2, clipEndSec: 4 },
      ] } },
      { kind: "image", status: "skipped", resultUrl: "packshot.png", settings: { compositeLocally: true, frameNumber: 5, coversFrames: [5] } },
    ];
    const segs = planSegments(frames, jobs as never);
    expect(segs.map((s) => [s.kind, s.url, s.kind === "clip" ? s.from : null, s.length])).toEqual([
      ["clip", "v1.mp4", 0, 2],
      ["clip", "v1.mp4", 2, 2],
      ["clip", "v3.mp4", 0, 2],
      ["clip", "v3.mp4", 2, 2],
      ["still", "packshot.png", null, 2],
    ]);
  });

  it("skips frames with nothing rendered", () => {
    expect(planSegments(frames.slice(0, 1), [] as never)).toEqual([]);
  });

  it("sizes the canvas by aspect ratio", () => {
    expect(canvasFor("9:16")).toEqual({ w: 1080, h: 1920 });
    expect(canvasFor("16:9")).toEqual({ w: 1920, h: 1080 });
  });
});
