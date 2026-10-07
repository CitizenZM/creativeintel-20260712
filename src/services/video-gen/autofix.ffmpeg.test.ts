/**
 * The auto-fix loop end to end on local ffmpeg at 270×480 (free, no network): a master that opens on
 * a black frame with its hook headline and offer pill in TikTok's right rail → one re-edit with the
 * corrections → a lit first frame and every text layer inside the TikTok safe box.
 */
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { autoFixRender, type AutoFixRecord, type QcLike } from "./autofix";
import { frameLuma, renderEditV2, type EditFixes } from "./edit/render-v2";
import { layoutBox } from "./edit/safe-layout";
import type { AssembleFrame, Segment } from "./glm-assemble";
import type { PlatformId } from "@/services/creative/types";

const run = promisify(execFile);
const canvas = { w: 270, h: 480 };

describe("autoFixRender on a real local render", { timeout: 600_000 }, () => {
  it("fixes a black first frame and right-rail text with one free re-edit", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autofix-it-"));
    try {
      const ff = ffmpegPath!;
      // Hook clip: 0.15 s of black (a model "warming up"), then a lit, colourful picture; played at 2×
      // (a time-remapped hook shot keeps its start: no motion-window search), so frame 1 is black.
      const c1 = path.join(root, "c1.mp4");
      await run(ff, ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=270x480:r=30:d=0.15", "-f", "lavfi", "-i", "testsrc2=s=270x480:r=30:d=4.5",
        "-filter_complex", "[0:v][1:v]concat=n=2:v=1[v]", "-map", "[v]", "-pix_fmt", "yuv420p", c1]);
      const c2 = path.join(root, "c2.mp4");
      await run(ff, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=s=270x480:r=30:d=2.5", "-pix_fmt", "yuv420p", c2]);
      const still = path.join(root, "p.png");
      await sharp({ create: { width: 540, height: 960, channels: 3, background: { r: 30, g: 60, b: 140 } } })
        .composite([{ input: Buffer.from(`<svg width="540" height="960"><rect x="90" y="300" width="360" height="220" rx="12" fill="#f4f4f4"/><rect x="110" y="320" width="320" height="180" fill="#ff7a00"/></svg>`), left: 0, top: 0 }])
        .png().toFile(still);

      const frames: AssembleFrame[] = [
        { frameNumber: 1, startSec: 0, endSec: 2, segment: "HOOK", text: "WANT A NEW YEAR GIFT WITH FREE INSTALLATION?" },
        { frameNumber: 2, startSec: 2, endSec: 4, segment: "BODY", text: "3,000 NITS" },
        { frameNumber: 3, startSec: 4, endSec: 6, segment: "CTA", text: "BLACK FRIDAY DEAL — SHOP AT TCL.COM" },
      ];
      const segments: Segment[] = [
        { kind: "clip", url: "c1", from: 0, length: 2, frameNumber: 1, text: frames[0].text!, speed: 2 },
        { kind: "clip", url: "c2", from: 0, length: 2, frameNumber: 2, text: frames[1].text! },
        { kind: "still", url: "p", length: 2, frameNumber: 3, text: frames[2].text! },
      ];
      const sources = new Map([["c1", c1], ["c2", c2], ["p", still]]);
      let n = 0;
      const render = async (platform: PlatformId | null, fixes?: EditFixes) => {
        const dir = path.join(root, `r${n++}`);
        await mkdir(dir);
        return renderEditV2({ dir, runId: "it", aspectRatio: "9:16", canvas, frames, segments, sources: new Map(sources), platform, fixes });
      };

      const first = await render(null);
      const saved: { record?: AutoFixRecord; promoted?: boolean } = {};
      let fixed: Awaited<ReturnType<typeof render>> | null = null;
      const r = await autoFixRender("it", {
        load: async () => ({ qc: first.qc as unknown as QcLike, platform: "tiktok", masterUrl: first.masterFile }),
        render: async (_id, o) => {
          fixed = await render(o.platform, o.fixes);
          return { qc: fixed.qc as unknown as QcLike, masterUrl: fixed.masterFile, previewUrl: fixed.previewFile };
        },
        save: async (_id, record, promote) => {
          saved.record = record;
          saved.promoted = !!promote;
        },
      });

      // Before: frame 1 black (the opener), hook / offer text past x 235 (TikTok's rail at 270 wide).
      expect(r.before.issues).toEqual(expect.arrayContaining(["first-frame", "safe-zone"]));
      expect(r.fixes).toMatchObject({ brightOpen: true, layoutInset: 0.01 });
      // After: both fixed, a better score, promoted.
      expect(r.after!.issues).not.toContain("first-frame");
      expect(r.after!.issues).not.toContain("safe-zone");
      // (The synthetic opener's black → test-pattern jump also counted as "motion in 0–1 s" before the
      // trim, so the total can stay level here; the fixable issues must still drop.)
      expect(r.after!.score).toBeGreaterThanOrEqual(r.before.score);
      expect(r.after!.issues.length).toBeLessThan(r.before.issues.length);
      expect(r.status).toBe("fixed");
      expect(saved.promoted).toBe(true);
      const f = fixed!;
      expect(await frameLuma(f.masterFile, 0)).toBeGreaterThan(0.25);
      const box = layoutBox(canvas, "tiktok");
      const sz = f.qc.preflight!.checks.find((c) => c.key === "safe_zone");
      expect(sz?.value).toMatch(/^0\//);
      expect(box.right).toBe(235);
      // Covers were made from the fixed master.
      expect(f.covers?.covers.map((c) => c.aspect)).toEqual(["9:16", "1:1", "4:5"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
