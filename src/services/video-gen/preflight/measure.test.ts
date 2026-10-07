import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { describe, expect, it } from "vitest";
import { edgeDensity, frameStats, measurePreflight, meanAbsDiff, parseLeadingSilence, parseProbe, textBandScore } from "./measure";

describe("parsers", () => {
  it("reads duration, size and audio from ffmpeg's banner", () => {
    const s = `Input #0, mov,mp4\n  Duration: 00:00:15.03, start: 0.000000, bitrate: 5000 kb/s\n  Stream #0:0[0x1](und): Video: h264 (High), yuv420p(tv, bt709, progressive), 1080x1920 [SAR 1:1 DAR 9:16], 4800 kb/s, 30 fps\n  Stream #0:1[0x2](und): Audio: aac (LC), 44100 Hz, stereo`;
    expect(parseProbe(s)).toEqual({ durationSec: 15.03, width: 1080, height: 1920, hasAudio: true });
    expect(parseProbe("Duration: 00:01:02.50,\n Stream #0:0: Video: h264, 640x360, 25 fps").hasAudio).toBe(false);
  });
  it("finds silence at the very start only", () => {
    expect(parseLeadingSilence("[silencedetect] silence_start: 0\n[silencedetect] silence_end: 0.84 | silence_duration: 0.84")).toBeCloseTo(0.84);
    expect(parseLeadingSilence("[silencedetect] silence_start: 3.2\n[silencedetect] silence_end: 4.0")).toBe(0);
    expect(parseLeadingSilence("[silencedetect] silence_start: -0.01", 2)).toBe(2);
  });
});

describe("pixel stats", () => {
  it("measures brightness, contrast and saturation of an RGB frame", () => {
    const grey = Buffer.alloc(4 * 4 * 3, 128);
    const s = frameStats(grey, 4, 4);
    expect(s.brightness).toBeCloseTo(0.5, 1);
    expect(s.contrast).toBeCloseTo(0, 2);
    expect(s.saturation).toBeCloseTo(0, 2);
    const red = Buffer.alloc(4 * 4 * 3);
    for (let i = 0; i < 16; i++) red[i * 3] = 255;
    expect(frameStats(red, 4, 4).saturation).toBeCloseTo(1, 2);
  });
  it("measures motion between grey frames", () => {
    expect(meanAbsDiff([Buffer.alloc(10, 0), Buffer.alloc(10, 51)])).toBeCloseTo(0.2, 3);
    expect(meanAbsDiff([Buffer.alloc(10, 7)])).toBe(0);
  });
  it("sees a band of text-like edges", () => {
    const w = 40, h = 24;
    const flat = Buffer.alloc(w * h, 90);
    const text = Buffer.from(flat);
    for (let y = 10; y < 14; y++) for (let x = 4; x < 36; x++) text[y * w + x] = x % 3 === 0 ? 250 : 20;
    expect(edgeDensity(flat, w, h)).toBe(0);
    expect(textBandScore(text, w, h)).toBeGreaterThan(textBandScore(flat, w, h) + 0.2);
  });
});

describe("measurePreflight", () => {
  it("measures a synthetic clip end to end (local ffmpeg)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pf-"));
    try {
      const file = path.join(dir, "t.mp4");
      await promisify(execFile)(ffmpegPath!, ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x568:rate=30:duration=3", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-af", "adelay=600|600,volume=0.5", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", file]);
      const m = await measurePreflight(file, dir);
      expect(m.width).toBe(320);
      expect(m.durationSec).toBeGreaterThan(2.5);
      expect(m.hasAudio).toBe(true);
      expect(m.leadingSilenceSec).toBeGreaterThan(0.4);
      expect(m.firstFrame.saturation).toBeGreaterThan(0.2);
      expect(m.motion1s).toBeGreaterThan(0);
      expect(m.loudnessLufs).not.toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
