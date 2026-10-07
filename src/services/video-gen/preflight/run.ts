/**
 * Operator `preflight`: score a finished run's master — the plan comes from its locked storyboard,
 * the goal from the project's campaign plan, captions coverage from the edit QC — and keep the report
 * on the run's qcReport.preflight.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { platformProfile } from "@/services/creative/library";
import type { PlatformId } from "@/services/creative/types";
import { runPreflight } from "./index";
import { planFromStoryboard, type StoryboardFrameLike } from "./plan";
import type { PreflightReport } from "./types";

export class PreflightError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function preflightRun(projectId: string, runId: string, opts: { platform?: string; goal?: string } = {}): Promise<PreflightReport> {
  const { prisma } = await import("@/lib/db");
  const run = await prisma.libtvRun.findFirst({ where: { id: runId, projectId }, select: { id: true, masterMp4Url: true, storyboardId: true, aspectRatio: true, qcReport: true } });
  if (!run) throw new PreflightError("Run not found", 404);
  if (!run.masterMp4Url) throw new PreflightError("This run has no master yet", 409);
  if (opts.platform) {
    try {
      platformProfile(opts.platform as PlatformId);
    } catch {
      throw new PreflightError(`Unknown platform ${opts.platform}`, 400);
    }
  }
  const [project, board] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, select: { brandName: true, campaignPlan: true } }),
    run.storyboardId ? prisma.storyboard.findUnique({ where: { id: run.storyboardId }, select: { frames: true } }) : null,
  ]);
  const qc = (run.qcReport ?? {}) as { checks?: { key: string; value: number | null }[]; preflight?: unknown };
  const cov = qc.checks?.find((c) => c.key === "caption_coverage")?.value;
  const goal = opts.goal ?? (project?.campaignPlan as { goal?: string } | null)?.goal ?? null;
  const frames = (Array.isArray(board?.frames) ? board!.frames : []) as StoryboardFrameLike[];
  const plan = frames.length ? planFromStoryboard(frames, { goal, brandName: project?.brandName, captionCoverage: typeof cov === "number" ? cov / 100 : null }) : null;

  const { safeFetchBuffer } = await import("@/lib/safe-fetch");
  const got = await safeFetchBuffer(run.masterMp4Url, { timeoutMs: 120_000, maxBytes: 300 * 1024 * 1024 });
  if (!got.ok || !got.buffer) throw new PreflightError(`Master download failed: ${got.error ?? got.status}`, 502);
  const dir = await mkdtemp(path.join(tmpdir(), `preflight-${run.id}-`));
  try {
    const file = path.join(dir, "master.mp4");
    await writeFile(file, got.buffer);
    const report = await runPreflight({ file, dir, plan, platform: (opts.platform as PlatformId) ?? null, aspectRatio: run.aspectRatio, goal });
    await prisma.libtvRun.update({ where: { id: run.id }, data: { qcReport: { ...(qc as object), preflight: report } as object } });
    return report;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
