import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { describe, expect, it } from "vitest";
import { captionPng, overlayGraph, planSegments, wrapCaption } from "./glm-assemble";

const run = promisify(execFile);
const FONT = path.join(process.cwd(), "assets/fonts/Anton-Regular.ttf");

describe("captions", () => {
  it("wraps caption text into at most three lines", () => {
    expect(wrapCaption("Tired of managing piles of receipts?")).toEqual(["Tired of managing", "piles of receipts?"]);
    expect(wrapCaption("Up to 5% Cashback!")).toEqual(["Up to 5% Cashback!"]);
    expect(wrapCaption("one two three four five six seven eight nine ten eleven twelve thirteen", 10)).toHaveLength(3);
  });

  it("carries each frame's text onto its segment", () => {
    const segs = planSegments(
      [{ frameNumber: 1, startSec: 0, endSec: 2, text: "Get Your Ramp Card" }, { frameNumber: 2, startSec: 2, endSec: 4, text: "  " }],
      [{ kind: "image", status: "completed", resultUrl: "https://x/k1.png", settings: { coversFrames: [1, 2] } } as never]
    );
    expect(segs.map((s) => s.text)).toEqual(["Get Your Ramp Card", undefined]);
  });

  it("draws a caption PNG with sharp, escaping markup", async () => {
    const png = await captionPng(["Save <5%> & more"], { w: 1080, h: 1920 }, FONT);
    const sharp = (await import("sharp")).default;
    const meta = await sharp(png).metadata();
    expect(meta.format).toBe("png");
    expect(meta.channels).toBe(4);
    expect(meta.width).toBeGreaterThan(200);
    expect(meta.width).toBeLessThan(1080);
  });

  it("overlays the caption onto a real 1080x1920 segment (no drawtext needed)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "caption-test-"));
    try {
      const cap = path.join(dir, "cap.png");
      await writeFile(cap, await captionPng(wrapCaption("Tired of managing piles of receipts?"), { w: 1080, h: 1920 }, FONT));
      const out = path.join(dir, "seg.mp4");
      const vf = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,format=yuv420p";
      await run(ffmpegPath!, [
        "-y", "-v", "error", "-f", "lavfi", "-t", "1", "-i", "color=c=navy:s=720x1280:d=1", "-i", cap,
        "-filter_complex", overlayGraph(vf), "-map", "[out]", "-t", "1", "-an", "-c:v", "libx264", "-preset", "veryfast", out,
      ]);
      await run(ffmpegPath!, ["-y", "-v", "error", "-i", out, "-frames:v", "1", path.join(dir, "preview.png")]);
      const { stderr } = await run(ffmpegPath!, ["-i", out]).catch((e) => e as { stderr: string });
      expect(String(stderr)).toMatch(/1080x1920/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("fitStillFilter", () => {
  it("fits a landscape card into 9:16 over a blurred fill, with and without a caption", async () => {
    const { fitStillFilter } = await import("./glm-assemble");
    const dir = await mkdtemp(path.join(tmpdir(), "fit-test-"));
    try {
      const card = path.join(dir, "card.png");
      await run(ffmpegPath!, ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=600x338:rate=1", "-frames:v", "1", card]);
      const plain = path.join(dir, "plain.mp4");
      await run(ffmpegPath!, ["-y", "-v", "error", "-loop", "1", "-t", "1", "-i", card, "-vf", fitStillFilter({ w: 1080, h: 1920 }), "-an", "-c:v", "libx264", "-preset", "veryfast", plain]);
      const cap = path.join(dir, "cap.png");
      await writeFile(cap, await captionPng(["Apply Now"], { w: 1080, h: 1920 }, FONT));
      const withCap = path.join(dir, "cap.mp4");
      await run(ffmpegPath!, ["-y", "-v", "error", "-loop", "1", "-t", "1", "-i", card, "-i", cap, "-filter_complex", overlayGraph(fitStillFilter({ w: 1080, h: 1920 })), "-map", "[out]", "-t", "1", "-an", "-c:v", "libx264", "-preset", "veryfast", withCap]);
      for (const f of [plain, withCap]) {
        const { stderr } = await run(ffmpegPath!, ["-i", f]).catch((e) => e as { stderr: string });
        expect(String(stderr)).toMatch(/1080x1920/);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
