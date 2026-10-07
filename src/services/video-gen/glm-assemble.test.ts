import { describe, expect, it } from "vitest";
import { attachProductBoxes, canvasFor, planSegments, type AssembleFrame } from "./glm-assemble";

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

describe("attachProductBoxes", () => {
  const box = (b: number[] | null, present = true) => ({ consistency: { score: 0.8, productBox: b, productPresent: present } });
  const jobs = [
    { nodeName: "PROD-1", kind: "upload", status: "completed", resultUrl: "https://cdn/pack.png", sourceUrl: "https://src/pack.png", settings: {}, leftRefs: [] },
    { nodeName: "K3", kind: "image", status: "completed", resultUrl: "k3.png", settings: { frameNumber: 3, ...box([0.6, 0.6, 0.9, 0.88]) }, leftRefs: ["PROD-1"] },
    { nodeName: "K3E", kind: "image", status: "completed", resultUrl: "k3e.png", settings: { endOf: 3, frameNumber: null, ...box([0.5, 0.55, 0.85, 0.9]) }, leftRefs: ["K3", "PROD-1"] },
    { nodeName: "K5", kind: "image", status: "completed", resultUrl: "k5.png", settings: { frameNumber: 5, ...box(null, false) }, leftRefs: ["PROD-1"] },
    { nodeName: "V3", kind: "video", status: "completed", resultUrl: "v3.mp4", settings: { coversFrames: [3], frameOffsetsSec: [{ frameNumber: 3, clipStartSec: 0, clipEndSec: 2 }] }, leftRefs: ["K3", "K3E"] },
    { nodeName: "V5", kind: "video", status: "completed", resultUrl: "v5.mp4", settings: { coversFrames: [5], frameOffsetsSec: [{ frameNumber: 5, clipStartSec: 0, clipEndSec: 2 }] }, leftRefs: ["K5"] },
  ];
  const fr: AssembleFrame[] = [
    { frameNumber: 3, startSec: 0, endSec: 2, zoomHit: { x: 0.5, y: 0.5 } },
    { frameNumber: 4, startSec: 2, endSec: 4 },
    { frameNumber: 5, startSec: 4, endSec: 6, segment: "CTA" },
  ];

  it("threads each frame's start / end keyframe product box from the job settings", () => {
    const out = attachProductBoxes(fr, jobs as never);
    expect(out[0].productBox).toEqual({ start: [0.6, 0.6, 0.9, 0.88], end: [0.5, 0.55, 0.85, 0.9], present: true });
    expect(out[1].productBox).toBeNull();
    expect(out[2].productBox).toEqual({ start: null, end: null, present: false });
  });

  it("gives the CTA frame its official packshot (the product reference its keyframe was edited from)", () => {
    const out = attachProductBoxes(fr, jobs as never);
    expect(out[2].packshotUrl).toBe("https://cdn/pack.png");
    expect(out[0].packshotUrl ?? null).toBeNull();
  });

  it("lands the zoom hit on the product's centre and passes the box to the segment", () => {
    const segs = planSegments(attachProductBoxes(fr, jobs as never), jobs as never);
    const s3 = segs.find((s) => s.frameNumber === 3)!;
    expect(s3.zoomHit!.x).toBeCloseTo(0.75, 3);
    expect(s3.zoomHit!.y).toBeCloseTo(0.74, 3);
    expect(s3.productBox?.start).toEqual([0.6, 0.6, 0.9, 0.88]);
  });
});
