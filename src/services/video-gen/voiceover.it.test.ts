import { execFile } from "node:child_process";
import { copyFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { describe, expect, it } from "vitest";
import { addVoiceoverAndSubtitles } from "./glm-assemble";

const run = promisify(execFile);

// Live Edge TTS + ffmpeg; run with RUN_TTS_IT=1 (network required).
describe.skipIf(!process.env.RUN_TTS_IT)("voiceover + subtitles (live)", () => {
  it("speaks the storyboard lines, mixes them in and burns subtitles", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "vo-it-"));
    const master = path.join(dir, "master.mp4");
    await run(ffmpegPath!, ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=0x2b4a3a:s=1080x1920:r=30:d=10", "-c:v", "libx264", "-pix_fmt", "yuv420p", master]);
    const frames = [
      { frameNumber: 1, startSec: 0, endSec: 2, voiceover: "Tired of managing piles of receipts?" },
      { frameNumber: 2, startSec: 2, endSec: 4, voiceover: "Tired of managing piles of receipts?" },
      { frameNumber: 3, startSec: 4, endSec: 6, voiceover: "Meet Ramp, the corporate card that closes your books for you." },
      { frameNumber: 4, startSec: 6, endSec: 8, voiceover: "Meet Ramp, the corporate card that closes your books for you." },
      { frameNumber: 5, startSec: 8, endSec: 10, voiceover: "Get your Ramp card." },
    ];
    const out = await addVoiceoverAndSubtitles({ dir, master, frames, totalSec: 10, canvas: { w: 1080, h: 1920 } });
    expect(out).not.toBeNull();
    const { stderr } = await run(ffmpegPath!, ["-i", out!.file]).catch((e) => e as { stderr: string });
    expect(String(stderr)).toMatch(/Audio: aac/);
    expect(String(stderr)).toMatch(/Duration: 00:00:10/);
    expect(out!.srt).toMatch(/receipts\?/);
    if (process.env.KEEP_IT_OUTPUT) {
      await copyFile(out!.file, path.join(process.env.KEEP_IT_OUTPUT, "vo-it.mp4"));
      await copyFile(out!.voiceoverFile, path.join(process.env.KEEP_IT_OUTPUT, "vo-it.mp3"));
      console.log(out!.srt);
    }
  }, 120_000);
});
