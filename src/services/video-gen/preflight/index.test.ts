import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { preflightForEdit } from "./index";

describe("preflightForEdit", () => {
  it("builds the plan and ink-trimmed layer boxes from an edit-v2 render", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pfe-"));
    try {
      const master = path.join(dir, "v2master.mp4");
      await promisify(execFile)(ffmpegPath!, ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=540x960:rate=30:duration=3", "-f", "lavfi", "-i", "sine=duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", master]);
      // A 500-px-wide card with 50 px of transparent padding each side, and a CTA pushed off the bottom.
      const card = path.join(dir, "v2card0.png");
      await sharp({ create: { width: 500, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: { create: { width: 400, height: 60, channels: 4, background: "#ffffff" } }, left: 50, top: 20 }]).png().toFile(card);
      const cta = path.join(dir, "v2cta.png");
      await sharp({ create: { width: 200, height: 60, channels: 4, background: "#ff0000" } }).png().toFile(cta);
      const r = await preflightForEdit({
        master,
        dir,
        aspectRatio: "9:16",
        canvas: { w: 540, h: 960 },
        plan: { durationSec: 3, ctaSec: 2, cards: [{ text: "40% OFF", startSec: 0, endSec: 1.5, role: "hook" }], shots: [{ startSec: 2, endSec: 3, segment: "CTA", kind: "still" }], ctaButton: { text: "Shop now", startSec: 2.2 } },
        frames: [{ startSec: 0, endSec: 3, voiceover: "Forty percent off today." }],
        overlays: [
          { file: card, y: 0.25, startSec: 0, endSec: 1.5 },
          { file: cta, y: 0.95, startSec: 2.2, endSec: 3 },
        ],
        captions: [],
        captionCoverage: 1,
        known: {},
      });
      expect(r.platform).toBe("tiktok");
      const sz = r.checks.find((c) => c.key === "safe_zone")!;
      expect(sz.value).toBe("1/2 outside");
      expect(sz.fix).toMatch(/cta/);
      expect(r.checks.find((c) => c.key === "text_first_s")!.pass).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
