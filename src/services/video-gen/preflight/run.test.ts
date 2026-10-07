import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  libtvRun: { findFirst: vi.fn(), update: vi.fn() },
  project: { findUnique: vi.fn() },
  storyboard: { findUnique: vi.fn() },
}));
const net = vi.hoisted(() => ({ safeFetchBuffer: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/safe-fetch", () => net);

import { preflightRun, PreflightError } from "./run";

describe("preflightRun", () => {
  beforeEach(() => vi.clearAllMocks());

  it("scores the master with the storyboard plan and keeps the report on qcReport", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pfr-"));
    try {
      const file = path.join(dir, "m.mp4");
      await promisify(execFile)(ffmpegPath!, ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=270x480:rate=30:duration=2", "-f", "lavfi", "-i", "sine=duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", file]);
      db.libtvRun.findFirst.mockResolvedValue({ id: "r1", masterMp4Url: "https://cdn.test/m.mp4", storyboardId: "s1", aspectRatio: "9:16", qcReport: { engine: "edit-v2", checks: [{ key: "caption_coverage", value: 97 }] } });
      db.project.findUnique.mockResolvedValue({ brandName: "TCL", campaignPlan: { goal: "promo" } });
      db.storyboard.findUnique.mockResolvedValue({ frames: [{ startSec: 0, endSec: 1, segment: "HOOK", textOverlay: "40% OFF TODAY", locked: { refs: "product" } }, { startSec: 1, endSec: 2, segment: "CTA", textOverlay: "SHOP NOW" }] });
      net.safeFetchBuffer.mockResolvedValue({ ok: true, status: 200, buffer: await readFile(file), contentType: "video/mp4" });
      const r = await preflightRun("p1", "r1", { platform: "tiktok" });
      expect(r.platform).toBe("tiktok");
      expect(r.checks.find((c) => c.key === "sale_pitch_3s")!.pass).toBe(true);
      expect(r.checks.find((c) => c.key === "captions")!.value).toBe(97);
      expect(db.libtvRun.update).toHaveBeenCalledWith({ where: { id: "r1" }, data: { qcReport: expect.objectContaining({ engine: "edit-v2", preflight: r }) } });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it("refuses runs without a master and unknown platforms", async () => {
    db.libtvRun.findFirst.mockResolvedValue({ id: "r1", masterMp4Url: null, qcReport: null });
    await expect(preflightRun("p1", "r1")).rejects.toMatchObject({ status: 409 });
    db.libtvRun.findFirst.mockResolvedValue({ id: "r1", masterMp4Url: "https://x/m.mp4", qcReport: null });
    await expect(preflightRun("p1", "r1", { platform: "myspace" })).rejects.toBeInstanceOf(PreflightError);
  });
});
