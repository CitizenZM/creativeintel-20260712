import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { colourfulness, COVER_ASPECTS, coverCandidates, coverLayout, coverShots, laplacianVariance, makeCovers, scoreCoverFrame } from "./covers";

const run = promisify(execFile);

/** A w×h grey frame: a checkerboard (sharp) or flat. */
function grey(w: number, h: number, sharpEdges: boolean): Uint8Array {
  const g = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = sharpEdges ? (((x >> 2) + (y >> 2)) % 2 ? 230 : 25) : 128;
  return g;
}

describe("frame measures", () => {
  it("Laplacian variance separates a sharp frame from a soft one", () => {
    expect(laplacianVariance(grey(64, 64, true), 64, 64)).toBeGreaterThan(1000);
    expect(laplacianVariance(grey(64, 64, false), 64, 64)).toBe(0);
  });
  it("colourfulness is 0 on grey and high on saturated colour", () => {
    const n = 32 * 32;
    const gray = new Uint8Array(n * 3).fill(120);
    const vivid = new Uint8Array(n * 3);
    for (let i = 0; i < n; i++) vivid.set(i % 2 ? [240, 20, 30] : [20, 60, 240], i * 3);
    expect(colourfulness(gray, n)).toBe(0);
    expect(colourfulness(vivid, n)).toBeGreaterThan(0.6);
  });
});

describe("scoreCoverFrame", () => {
  const good = { sharpness: 900, brightness: 0.5, contrast: 0.22, colourfulness: 0.5, motion: 0.005 };
  it("prefers a sharp, lit, colourful, still frame", () => {
    expect(scoreCoverFrame(good, {})).toBeGreaterThan(scoreCoverFrame({ ...good, sharpness: 15 }, {}));
    expect(scoreCoverFrame(good, {})).toBeGreaterThan(scoreCoverFrame({ ...good, brightness: 0.05 }, {}));
    expect(scoreCoverFrame(good, {})).toBeGreaterThan(scoreCoverFrame({ ...good, motion: 0.12 }, {}));
  });
  it("marks down a frame that already carries text, and split comparison shots", () => {
    expect(scoreCoverFrame({ ...good, text: 0.3 }, {})).toBeLessThan(scoreCoverFrame({ ...good, text: 0.02 }, {}) - 0.2);
    expect(scoreCoverFrame(good, { product: true, avoid: true })).toBeLessThan(scoreCoverFrame(good, {}));
  });
  it("lifts frames that show the product or a face (render-plan metadata)", () => {
    expect(scoreCoverFrame(good, { product: true })).toBeGreaterThan(scoreCoverFrame(good, {}));
    expect(scoreCoverFrame(good, { person: true })).toBeGreaterThan(scoreCoverFrame(good, {}));
  });
});

describe("coverCandidates / coverShots", () => {
  it("samples the body (not the end card), away from cuts", () => {
    const t = coverCandidates({ durationSec: 15, ctaSec: 12, cutsSec: [1, 2, 3.5] }, 12);
    expect(t.length).toBeGreaterThan(8);
    expect(Math.max(...t)).toBeLessThan(12);
    expect(t.every((x) => [1, 2, 3.5].every((c) => Math.abs(x - c) > 0.12))).toBe(true);
  });
  it("tags shots with product / person from the plan and the storyboard frames", () => {
    const shots = coverShots(
      { shots: [{ startSec: 0, endSec: 1, frameNumber: 1, segment: "HOOK" }, { startSec: 1, endSec: 2.5, frameNumber: 2, segment: "BODY", zoomHit: { x: 0.5, y: 0.5 } }, { startSec: 12, endSec: 15, frameNumber: 9, segment: "CTA" }] },
      [{ frameNumber: 1, hasPerson: true }]
    );
    expect(shots.map((s) => [s.person, s.product])).toEqual([[true, false], [false, true], [false, true]]);
    expect(coverShots({ shots: [{ startSec: 3, endSec: 4.5, frameNumber: 4, segment: "BODY", compare: { otherUrl: "x" } }] }, [])[0].avoid).toBe(true);
  });
});

describe("coverLayout", () => {
  it("keeps the 9:16 cover's headline inside the Reels grid's 3:4 and 1:1 centre crops", () => {
    const l = coverLayout("9:16");
    expect([l.w, l.h]).toEqual([1080, 1920]);
    const sq = { top: (1920 - 1080) / 2, bottom: (1920 + 1080) / 2 };
    expect(l.box.top).toBeGreaterThanOrEqual(sq.top);
    expect(l.box.bottom).toBeLessThanOrEqual(sq.bottom);
    expect(l.box.left).toBeGreaterThanOrEqual(54);
    expect(l.box.right).toBeLessThanOrEqual(1080 - 54);
  });
  it("4:5 keeps its text in the 1:1 centre crop; 1:1 inside a margin", () => {
    const f = coverLayout("4:5");
    expect([f.w, f.h]).toEqual([1080, 1350]);
    expect(f.box.top).toBeGreaterThanOrEqual(135);
    expect(f.box.bottom).toBeLessThanOrEqual(1215);
    const s = coverLayout("1:1");
    expect([s.w, s.h]).toEqual([1080, 1080]);
    expect(COVER_ASPECTS).toEqual(["9:16", "1:1", "4:5"]);
  });
});

describe("makeCovers (local ffmpeg + sharp)", { timeout: 120_000 }, () => {
  it("picks the sharp, lit frame of a small synthetic master and composes 9:16 / 1:1 / 4:5 covers", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "covers-"));
    try {
      // 0–1 s near-black, 1–2 s blurred, 2–3 s a sharp, colourful (text-free) pattern.
      const file = path.join(dir, "m.mp4");
      await run(ffmpegPath!, [
        "-v", "error", "-y",
        "-f", "lavfi", "-i", "color=c=0x080808:s=180x320:d=1:r=30",
        "-f", "lavfi", "-i", "mandelbrot=s=180x320:r=30,trim=duration=1",
        "-f", "lavfi", "-i", "mandelbrot=s=180x320:r=30,trim=duration=1",
        "-filter_complex", "[1:v]gblur=sigma=8[b];[0:v][b][2:v]concat=n=3:v=1[v]",
        "-map", "[v]", "-pix_fmt", "yuv420p", file,
      ]);
      const r = await makeCovers({ file, dir, headline: "WANT A NEW YEAR GIFT?", plan: { durationSec: 3, ctaSec: null, cutsSec: [1, 2], shots: [] }, outW: 360 });
      expect(r.frameSec).toBeGreaterThan(2);
      expect(r.covers.map((c) => c.aspect)).toEqual(["9:16", "1:1", "4:5"]);
      for (const c of r.covers) {
        const m = await sharp(c.file).metadata();
        expect(m.width).toBe(360);
        expect(m.height).toBe(Math.round((360 * c.h) / c.w));
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
