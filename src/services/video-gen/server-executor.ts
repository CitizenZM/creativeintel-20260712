/**
 * Server-side run executor shared by the engines the Next.js server drives
 * itself — GLM (Zhipu free cloud) and ComfyUI (self-hosted GPU). It walks the
 * compiled LibtvRun/LibtvJob graph:
 *   upload (PROD-/LOGO)  → pass the asset URL through
 *   image  (K<n>)        → adapter.generateImage; CTA stills (compositeLocally) use the packshot
 *   video  (V<n>)        → adapter.submitVideo off its keyframe, then adapter.pollVideo
 * then assembles the master with ffmpeg (glm-assemble). Status goes through the
 * same libtv-queue transitions, so Studio's UI is the same for every engine.
 *
 * It advances in short "ticks" driven by the approve request (after()), the
 * run-status poll and the cron sweep. Every job transition is claimed with a
 * conditional update, so overlapping ticks never double-submit.
 */
import { prisma } from "@/lib/db";
import type { LibtvJob } from "@/generated/prisma/client";
import { jobDone, jobFailed, runDone, runFailed } from "./libtv-queue";
import { assembleGlmMaster, type AssembleFrame } from "./glm-assemble";
import type { ServerEngine } from "./libtv-pricing";

export type TickResult = "idle" | "running" | "done" | "failed";

export type TaskResult =
  | { status: "PROCESSING" }
  | { status: "SUCCESS"; url: string; remoteUrl?: string }
  | { status: "FAIL"; error: string };

export interface JobContext {
  runId: string;
  nodeName: string;
  aspectRatio: string;
  /** Clip length for video jobs (job settings, else the run's clip duration). */
  durationSec: number;
}

/** What an engine must provide; the graph walking is shared. */
export interface EngineAdapter {
  engine: ServerEngine;
  workerId: string;
  maxVideosInFlight: number;
  imagesPerTick: number;
  isConfigured(): boolean;
  notConfiguredError: string;
  /** A persisted image URL, or a task id to poll with pollImage when it finishes later. */
  generateImage(prompt: string, ctx: JobContext): Promise<{ url: string } | { taskId: string }>;
  pollImage?(taskId: string, ctx: JobContext): Promise<TaskResult>;
  /** Start a clip; returns the task id stored on the job (nodeId). */
  submitVideo(input: { prompt: string; imageUrl?: string }, ctx: JobContext): Promise<string>;
  pollVideo(taskId: string, ctx: JobContext): Promise<TaskResult>;
}

const TERMINAL_JOB = new Set(["completed", "skipped", "failed"]);
const ACTIVE_RUN = ["approved", "claimed", "running", "assembling"];

async function claimJob(jobId: string): Promise<boolean> {
  const { count } = await prisma.libtvJob.updateMany({
    where: { id: jobId, status: "queued" },
    data: { status: "running", startedAt: new Date(), attempts: { increment: 1 } },
  });
  return count === 1;
}

function refName(ref: string): string {
  return ref.replace(/^FF\s+/, "").trim();
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function applyTaskResult(adapter: EngineAdapter, job: LibtvJob, result: TaskResult) {
  if (result.status === "SUCCESS") {
    await jobDone({ jobId: job.id, resultUrl: result.url, remoteUrl: result.remoteUrl, creditsSpent: 0 });
  } else if (result.status === "FAIL") {
    await jobFailed(job.id, result.error);
  }
}

export async function tickRun(adapter: EngineAdapter, runId: string): Promise<TickResult> {
  const run = await prisma.libtvRun.findUnique({ where: { id: runId }, include: { jobs: true } });
  if (!run || run.executor !== adapter.engine) return "idle";
  if (!ACTIVE_RUN.includes(run.status)) return "idle";
  if (!adapter.isConfigured()) {
    await runFailed(runId, adapter.notConfiguredError);
    return "failed";
  }

  await prisma.libtvRun.update({
    where: { id: runId },
    data:
      run.status === "approved"
        ? { status: "running", workerId: adapter.workerId, claimedAt: new Date(), startedAt: new Date(), error: null }
        : { claimedAt: new Date() },
  });

  const ctxFor = (j: LibtvJob): JobContext => {
    const s = (j.settings ?? {}) as { duration?: unknown };
    const duration = Number(s.duration) || Number(run.clipDurationSec) || 5;
    return { runId, nodeName: j.nodeName, aspectRatio: run.aspectRatio, durationSec: duration };
  };
  const byName = new Map(run.jobs.map((j) => [j.nodeName, j]));
  const urlOf = (ref: string) => byName.get(refName(ref))?.resultUrl ?? byName.get(refName(ref))?.sourceUrl ?? null;

  // Uploads: the packshot/logo already live in our storage.
  for (const j of run.jobs.filter((x) => x.kind === "upload" && x.status === "queued")) {
    if (await claimJob(j.id)) await jobDone({ jobId: j.id, resultUrl: j.sourceUrl, creditsSpent: 0 });
  }

  // Keyframes that finish asynchronously (engines with pollImage).
  if (adapter.pollImage) {
    for (const j of run.jobs.filter((x) => x.kind === "image" && x.status === "running" && x.nodeId)) {
      try {
        await applyTaskResult(adapter, j, await adapter.pollImage(j.nodeId!, ctxFor(j)));
      } catch (err) {
        console.warn(`[${adapter.engine}] poll ${j.nodeName} failed:`, errorText(err));
      }
    }
  }

  // Keyframes.
  const images = run.jobs.filter((x) => x.kind === "image" && x.status === "queued").slice(0, adapter.imagesPerTick);
  await Promise.all(
    images.map(async (j) => {
      if (!(await claimJob(j.id))) return;
      const settings = (j.settings ?? {}) as { compositeLocally?: boolean };
      try {
        if (settings.compositeLocally) {
          // CTA frames hold on the real packshot — no generation, no text drift.
          await jobDone({ jobId: j.id, resultUrl: urlOf(j.leftRefs ? (j.leftRefs as string[])[0] : "PROD-1"), skipped: true, creditsSpent: 0 });
          return;
        }
        const out = await adapter.generateImage(j.prompt, ctxFor(j));
        if ("url" in out) await jobDone({ jobId: j.id, resultUrl: out.url, creditsSpent: 0 });
        else await prisma.libtvJob.update({ where: { id: j.id }, data: { nodeId: out.taskId } });
      } catch (err) {
        await jobFailed(j.id, errorText(err));
      }
    })
  );

  // Clips: poll the ones in flight, then start more while under the cap.
  const fresh = await prisma.libtvJob.findMany({ where: { runId } });
  const videos = fresh.filter((x) => x.kind === "video");
  for (const j of videos.filter((x) => x.status === "running" && x.nodeId)) {
    try {
      await applyTaskResult(adapter, j, await adapter.pollVideo(j.nodeId!, ctxFor(j)));
    } catch (err) {
      console.warn(`[${adapter.engine}] poll ${j.nodeName} failed:`, errorText(err));
    }
  }
  const byNameFresh = new Map(fresh.map((j) => [j.nodeName, j]));
  let inFlight = videos.filter((x) => x.status === "running").length;
  for (const j of videos.filter((x) => x.status === "queued")) {
    if (inFlight >= adapter.maxVideosInFlight) break;
    const ref = byNameFresh.get(refName(((j.leftRefs as string[] | null) ?? [])[0] ?? ""));
    if (ref && !TERMINAL_JOB.has(ref.status)) continue; // keyframe not ready yet
    const imageUrl = ref?.resultUrl ?? undefined;
    if (!(await claimJob(j.id))) continue;
    try {
      const taskId = await adapter.submitVideo({ prompt: j.prompt, imageUrl }, ctxFor(j));
      await prisma.libtvJob.update({ where: { id: j.id }, data: { nodeId: taskId } });
      inFlight++;
    } catch (err) {
      await jobFailed(j.id, errorText(err));
    }
  }

  // Done? Assemble once every job is terminal.
  const now = await prisma.libtvJob.findMany({ where: { runId } });
  const failed = now.filter((x) => x.status === "failed");
  if (failed.length) {
    await runFailed(runId, `${failed.length} job(s) failed: ${failed.map((f) => `${f.nodeName} — ${f.error ?? "error"}`).join("; ")}`.slice(0, 1500));
    return "failed";
  }
  if (!now.every((x) => TERMINAL_JOB.has(x.status))) return "running";

  const { count } = await prisma.libtvRun.updateMany({
    where: { id: runId, status: { in: ["running", "claimed", "approved"] } },
    data: { status: "assembling" },
  });
  if (count !== 1) return "running"; // another tick is assembling
  try {
    const frames = await storyboardFrames(run.storyboardId);
    const master = await assembleGlmMaster({ runId, aspectRatio: run.aspectRatio, frames, jobs: now as LibtvJob[] });
    await runDone({ runId, masterMp4Url: master, creditsSpent: 0 });
    return "done";
  } catch (err) {
    await runFailed(runId, `Assembly failed: ${errorText(err)}`);
    return "failed";
  }
}

async function storyboardFrames(storyboardId: string | null): Promise<AssembleFrame[]> {
  if (!storyboardId) return [];
  const sb = await prisma.storyboard.findUnique({ where: { id: storyboardId }, select: { frames: true, frameSeconds: true } });
  const frameSeconds = sb?.frameSeconds || 2;
  const frames = Array.isArray(sb?.frames) ? (sb!.frames as { frameNumber?: number; startSec?: number; endSec?: number }[]) : [];
  return frames.map((f, i) => ({
    frameNumber: f.frameNumber ?? i + 1,
    startSec: Number.isFinite(f.startSec) ? f.startSec! : i * frameSeconds,
    endSec: Number.isFinite(f.endSec) ? f.endSec! : (i + 1) * frameSeconds,
  }));
}

/** Keep ticking a run until it settles or the time budget runs out. */
export async function driveRun(adapter: EngineAdapter, runId: string, budgetMs = 270_000, sleepMs = 8000): Promise<TickResult> {
  const deadline = Date.now() + budgetMs;
  let result: TickResult = "running";
  while (Date.now() < deadline) {
    result = await tickRun(adapter, runId).catch((err) => {
      console.warn(`[${adapter.engine}] tick ${runId} failed:`, errorText(err));
      return "running" as TickResult;
    });
    if (result !== "running") break;
    await new Promise((r) => setTimeout(r, sleepMs));
  }
  return result;
}

/** Cron sweep: advance every active run of this engine a little. */
export async function advanceActiveRuns(adapter: EngineAdapter, budgetMs = 50_000, sleepMs = 8000): Promise<number> {
  const runs = await prisma.libtvRun.findMany({
    where: { executor: adapter.engine, status: { in: ["approved", "claimed", "running"] } },
    select: { id: true },
    take: 5,
  });
  if (!runs.length) return 0;
  const share = Math.max(10_000, Math.floor(budgetMs / runs.length));
  for (const r of runs) await driveRun(adapter, r.id, share, sleepMs);
  return runs.length;
}
