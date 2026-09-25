/**
 * Server-side executor for GLM runs — the free, parallel alternative to the
 * LibTV Mac worker. It walks the same compiled LibtvRun/LibtvJob graph:
 *   upload (PROD-/LOGO)  → pass the asset URL through
 *   image  (K<n>)        → Zhipu CogView-3-Flash (free); CTA stills use the packshot
 *   video  (V<n>)        → Zhipu CogVideoX-Flash image-to-video off its keyframe (free)
 * then assembles the master with ffmpeg. Status goes through the same
 * libtv-queue transitions, so Studio's UI is unchanged.
 *
 * It advances in short "ticks" driven by the approve request (after()), the
 * run-status poll and the cron sweep. Every job transition is claimed with a
 * conditional update, so overlapping ticks never double-submit.
 */
import { prisma } from "@/lib/db";
import { generateImagePersisted, getVideoTask, isZhipuConfigured, persistResult, submitVideo } from "@/services/ai/zhipu";
import type { LibtvJob } from "@/generated/prisma/client";
import { jobDone, jobFailed, runDone, runFailed } from "./libtv-queue";
import { assembleGlmMaster, type AssembleFrame } from "./glm-assemble";

const WORKER_ID = "glm-server";
const MAX_VIDEOS_IN_FLIGHT = 2; // free-tier concurrency is low
const IMAGES_PER_TICK = 3;
const TERMINAL_JOB = new Set(["completed", "skipped", "failed"]);

type TickResult = "idle" | "running" | "done" | "failed";

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

export async function tickGlmRun(runId: string): Promise<TickResult> {
  const run = await prisma.libtvRun.findUnique({ where: { id: runId }, include: { jobs: true } });
  if (!run || run.executor !== "glm") return "idle";
  if (!["approved", "claimed", "running", "assembling"].includes(run.status)) return "idle";
  if (!isZhipuConfigured()) {
    await runFailed(runId, "ZHIPU_API_KEY is not configured");
    return "failed";
  }

  await prisma.libtvRun.update({
    where: { id: runId },
    data:
      run.status === "approved"
        ? { status: "running", workerId: WORKER_ID, claimedAt: new Date(), startedAt: new Date(), error: null }
        : { claimedAt: new Date() },
  });

  const byName = new Map(run.jobs.map((j) => [j.nodeName, j]));
  const urlOf = (ref: string) => byName.get(refName(ref))?.resultUrl ?? byName.get(refName(ref))?.sourceUrl ?? null;

  // Uploads: the packshot/logo already live in our storage.
  for (const j of run.jobs.filter((x) => x.kind === "upload" && x.status === "queued")) {
    if (await claimJob(j.id)) await jobDone({ jobId: j.id, resultUrl: j.sourceUrl, creditsSpent: 0 });
  }

  // Keyframes.
  const images = run.jobs.filter((x) => x.kind === "image" && x.status === "queued").slice(0, IMAGES_PER_TICK);
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
        const url = await generateImagePersisted(j.prompt, { aspectRatio: run.aspectRatio, folder: `glm-runs/${runId}` });
        await jobDone({ jobId: j.id, resultUrl: url, creditsSpent: 0 });
      } catch (err) {
        await jobFailed(j.id, err instanceof Error ? err.message : String(err));
      }
    })
  );

  // Clips: poll the ones in flight, then start more while under the cap.
  const fresh = await prisma.libtvJob.findMany({ where: { runId } });
  const videos = fresh.filter((x) => x.kind === "video");
  for (const j of videos.filter((x) => x.status === "running" && x.nodeId)) {
    try {
      const task = await getVideoTask(j.nodeId!);
      if (task.status === "SUCCESS" && task.videoUrl) {
        const url = await persistResult(task.videoUrl, `glm-runs/${runId}`, `${j.nodeName}.mp4`);
        await jobDone({ jobId: j.id, resultUrl: url, remoteUrl: task.videoUrl, creditsSpent: 0 });
      } else if (task.status === "FAIL") {
        await jobFailed(j.id, "CogVideoX-Flash reported FAIL");
      }
    } catch (err) {
      console.warn(`[glm] poll ${j.nodeName} failed:`, err instanceof Error ? err.message : err);
    }
  }
  const byNameFresh = new Map(fresh.map((j) => [j.nodeName, j]));
  let inFlight = videos.filter((x) => x.status === "running").length;
  for (const j of videos.filter((x) => x.status === "queued")) {
    if (inFlight >= MAX_VIDEOS_IN_FLIGHT) break;
    const ref = byNameFresh.get(refName(((j.leftRefs as string[] | null) ?? [])[0] ?? ""));
    if (ref && !TERMINAL_JOB.has(ref.status)) continue; // keyframe not ready yet
    const imageUrl = ref?.resultUrl ?? undefined;
    if (!(await claimJob(j.id))) continue;
    try {
      const taskId = await submitVideo({ prompt: j.prompt, imageUrl, aspectRatio: run.aspectRatio });
      await prisma.libtvJob.update({ where: { id: j.id }, data: { nodeId: taskId } });
      inFlight++;
    } catch (err) {
      await jobFailed(j.id, err instanceof Error ? err.message : String(err));
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
    await runFailed(runId, `Assembly failed: ${err instanceof Error ? err.message : String(err)}`);
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
export async function driveGlmRun(runId: string, budgetMs = 270_000): Promise<TickResult> {
  const deadline = Date.now() + budgetMs;
  let result: TickResult = "running";
  while (Date.now() < deadline) {
    result = await tickGlmRun(runId).catch((err) => {
      console.warn(`[glm] tick ${runId} failed:`, err instanceof Error ? err.message : err);
      return "running" as TickResult;
    });
    if (result !== "running") break;
    await new Promise((r) => setTimeout(r, 8000));
  }
  return result;
}

/** Cron sweep: advance every active GLM run a little. */
export async function advanceActiveGlmRuns(budgetMs = 50_000): Promise<number> {
  const runs = await prisma.libtvRun.findMany({
    where: { executor: "glm", status: { in: ["approved", "claimed", "running"] } },
    select: { id: true },
    take: 5,
  });
  if (!runs.length) return 0;
  const share = Math.max(10_000, Math.floor(budgetMs / runs.length));
  for (const r of runs) await driveGlmRun(r.id, share);
  return runs.length;
}
