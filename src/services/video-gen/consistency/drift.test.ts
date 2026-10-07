import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { autoRegenOnDrift, checkClipDrift, clipDriftForJob, sampleClipFrames } from "./drift";
import { frameSimilarity } from "./pixel-metrics";
import { deviceBox, deviceImage, type DeviceOpts } from "./test-images";
import { visionReportSchema, type VisionScorer } from "./vision";

// sharp + ffmpeg work is CPU-bound and the full suite runs files in parallel.
vi.setConfig({ testTimeout: 60_000 });

const run = promisify(execFile);
const THIN: DeviceOpts = { bezel: 0.025, width: 320, height: 240 };
const THICK: DeviceOpts = { bezel: 0.11, width: 320, height: 240 };

let dir = "";
let clip = "";
let steady = "";
let good: Buffer;
let bad: Buffer;

/** 3 s at 10 fps: thin bezel → thick bezel in the middle second → thin again. */
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ci-drift-test-"));
  good = await deviceImage(THIN);
  bad = await deviceImage(THICK);
  await writeFile(path.join(dir, "a.png"), good);
  await writeFile(path.join(dir, "b.png"), bad);
  const mk = async (out: string, files: string[]) => {
    const inputs = files.flatMap((f) => ["-loop", "1", "-t", "1", "-framerate", "10", "-i", path.join(dir, f)]);
    await run(ffmpegPath!, ["-y", "-v", "error", ...inputs, "-filter_complex", `concat=n=${files.length}:v=1:a=0,format=yuv420p`, "-r", "10", "-c:v", "libx264", out]);
  };
  clip = path.join(dir, "drift.mp4");
  steady = path.join(dir, "steady.mp4");
  await mk(clip, ["a.png", "b.png", "a.png"]);
  await mk(steady, ["a.png", "a.png", "a.png"]);
}, 60_000);

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

const vision: VisionScorer = vi.fn(async () =>
  visionReportSchema.parse({ product: { expected: true, present: true, bbox: deviceBox(THIN), view: "front", score: 0.9, checks: {} }, cast: [], defects: [] })
);
const refs = () => ({ product: [{ image: good }], start: good, end: good });

describe("clip drift", () => {
  it("samples 0 / 50 / 100 % of a clip locally with ffmpeg", async () => {
    const s = await sampleClipFrames(clip);
    expect(s.map((x) => x.at)).toEqual([0, 0.5, 1]);
    expect(s[1].t).toBeCloseTo(1.5, 1);
    expect(await frameSimilarity(s[0].image, good)).toBeGreaterThan(0.9);
    expect(await frameSimilarity(s[1].image, bad)).toBeGreaterThan(0.9);
    expect(await frameSimilarity(s[2].image, good)).toBeGreaterThan(0.9);
  });

  it("flags a clip whose product drifts mid-clip, with the reasons", async () => {
    const r = await checkClipDrift(clip, refs(), { shot: "Close-up of the tablet", deps: { scoreDeps: { vision } } });
    expect(r.driftFlag).toBe(true);
    expect(r.samples[0].pass).toBe(true);
    expect(r.samples[2].pass).toBe(true);
    expect(r.samples[1].pass).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/mid-clip/);
    expect(r.reasons.join(" ")).toMatch(/bezel thicker/);
    expect(r.boundary.start!).toBeGreaterThan(0.9);
  });

  it("does not flag a steady clip; accepts a Buffer", async () => {
    const { readFile } = await import("node:fs/promises");
    const r = await checkClipDrift(await readFile(steady), refs(), { shot: "Close-up of the tablet", deps: { scoreDeps: { vision } } });
    expect(r.driftFlag).toBe(false);
    expect(r.samples.every((s) => s.pass)).toBe(true);
  });

  it("re-generates only when autoRegenOnDrift is on, once", async () => {
    const jobRefs = { start: undefined, end: undefined, cast: [], product: [`data:image/png;base64,${good.toString("base64")}`], shot: "Close-up of the tablet" };
    const deps = { scoreDeps: { vision } };
    const off = await clipDriftForJob(clip, jobRefs, {}, { mode: "on", deps });
    expect(off).toMatchObject({ regenerate: false, report: { driftFlag: true } });
    const on = await clipDriftForJob(clip, jobRefs, { autoRegenOnDrift: 1 }, { mode: "on", deps });
    expect(on!.regenerate).toBe(true);
    const spent = await clipDriftForJob(clip, jobRefs, { autoRegenOnDrift: 1, driftRegens: 1 }, { mode: "on", deps });
    expect(spent!.regenerate).toBe(false);
    expect(await clipDriftForJob(clip, jobRefs, {}, { mode: "off", deps })).toBeNull();
    expect(autoRegenOnDrift(undefined)).toBe(false);
  });

  it("pixel mode makes no vision call", async () => {
    const v = vi.fn();
    const r = await checkClipDrift(clip, refs(), { shot: "x", vision: false, deps: { scoreDeps: { vision: v } } });
    expect(v).not.toHaveBeenCalled();
    expect(r.samples.every((s) => s.score === null)).toBe(true);
    expect(r.boundary.start!).toBeGreaterThan(0.9);
  });
});
