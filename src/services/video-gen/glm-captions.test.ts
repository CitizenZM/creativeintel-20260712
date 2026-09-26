import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { describe, expect, it } from "vitest";
import { captionFilter, planSegments, wrapCaption } from "./glm-assemble";

const run = promisify(execFile);

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

  it("burns a caption into a real 1080x1920 segment", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "caption-test-"));
    try {
      const lineFiles: string[] = [];
      for (const [n, line] of wrapCaption("Tired of managing piles of receipts?").entries()) {
        lineFiles.push(path.join(dir, `cap-${n}.txt`));
        await writeFile(lineFiles[n], line);
      }
      const out = path.join(dir, "seg.mp4");
      await run(ffmpegPath!, [
        "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=navy:s=1080x1920:d=1", "-vf",
        captionFilter(lineFiles, { w: 1080, h: 1920 }, path.join(process.cwd(), "assets/fonts/Anton-Regular.ttf")),
        "-frames:v", "1", "-update", "1", path.join(dir, "cap.png"), "-c:v", "libx264", "-preset", "veryfast", out,
      ]);
      const { stderr } = await run(ffmpegPath!, ["-i", out]).catch((e) => e as { stderr: string });
      expect(String(stderr)).toMatch(/1080x1920/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
