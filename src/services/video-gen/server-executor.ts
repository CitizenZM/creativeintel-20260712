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
import { cleanFramePrompt, hasPeople, motionSafePrompt } from "./prompt-safety";
import { keyframeQcEnabled, MAX_KEYFRAME_REROLLS, reviewKeyframe, shouldReroll } from "./keyframe-qc";
import { finishDirectedMotion, finishDirectedStill } from "./shot-director";

export type TickResult = "idle" | "running" | "done" | "failed";

export type TaskResult =
  | { status: "PROCESSING" }
  | { status: "SUCCESS"; url: string; remoteUrl?: string; creditsSpent?: number }
  | { status: "FAIL"; error: string };

export interface JobContext {
  runId: string;
  nodeName: string;
  aspectRatio: string;
  /** Clip length for video jobs (job settings, else the run's clip duration). */
  durationSec: number;
  projectId?: string;
  /** The job's compiled settings (e.g. a bring-your-own paid model id). */
  settings?: Record<string, unknown>;
  creditsEstimated?: number;
  /** Finished reference images (cast lock: the CAST image or the packshot). */
  referenceUrls?: string[];
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
  /** imageUrl = the segment's start keyframe; lastImageUrl = its end keyframe (first + last frame anchoring). */
  submitVideo(input: { prompt: string; imageUrl?: string; lastImageUrl?: string; seed?: number }, ctx: JobContext): Promise<string>;
  pollVideo(taskId: string, ctx: JobContext): Promise<TaskResult>;
}

const TERMINAL_JOB = new Set(["completed", "skipped", "failed"]);

/**
 * Image and video models invent lettering — garbled signs ("Obalzarus"), fake
 * brand names on the product. Captions and the real packshot carry all text, so
 * every generated frame is told to have none. Prepended so a model that
 * truncates long prompts (CogVideoX: 500 chars) still sees it.
 */
export const NO_TEXT_IMAGE = "No text, letters, words, numbers, logos, signage or watermarks anywhere in the image.";
export const NO_TEXT_VIDEO = "No text, letters, logos or signage appear.";

/**
 * Engines whose image-to-video warps faces (the free CogVideoX, small local
 * models). Seedance on Matrix keeps faces stable, so its clips always move.
 */
const FACE_SAFE_ENGINES = new Set<string>(["glm", "comfyui"]);

/** People in the clip or its keyframe → hold it as a still (FACE_SAFE_MOTION=off disables). */
export function faceSafe(clipPrompt: string, keyframePrompt?: string | null): boolean {
  if (process.env.FACE_SAFE_MOTION === "off") return false;
  return hasPeople(clipPrompt) || (!!keyframePrompt && hasPeople(keyframePrompt));
}

export function withNoText(prompt: string, kind: "image" | "video"): string {
  const clause = kind === "image" ? NO_TEXT_IMAGE : NO_TEXT_VIDEO;
  return prompt.startsWith(clause) ? prompt : `${clause} ${prompt}`;
}
/**
 * Assembly downloads every clip and encodes the master — about a minute. It only
 * starts with this much of the invocation's budget left, so a function limit can
 * never kill it half-way; a fresh invocation (the status poll) picks it up.
 */
// Edit engine v2 (shots, music, captions, QC, preview) takes ~2–3 min on Vercel.
export const ASSEMBLY_RESERVE_MS = 220_000;
/** An "assembling" run untouched this long was killed mid-assembly: assemble again. */
export const STALE_ASSEMBLY_MS = 6 * 60_000;
/** A keyframe / clip "running" this long without a task id lost its invocation. */
export const IMAGE_STALE_MS = 6 * 60_000;
const MAX_IMAGE_ATTEMPTS = 3;
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
    await jobDone({ jobId: job.id, resultUrl: result.url, remoteUrl: result.remoteUrl, creditsSpent: result.creditsSpent ?? 0 });
  } else if (result.status === "FAIL") {
    await jobFailed(job.id, result.error);
  }
}

export async function tickRun(
  adapter: EngineAdapter,
  runId: string,
  opts: { remainingMs?: number; reserveMs?: number } = {}
): Promise<TickResult> {
  const run = await prisma.libtvRun.findUnique({ where: { id: runId }, include: { jobs: true } });
  if (!run || run.executor !== adapter.engine) return "idle";
  if (!ACTIVE_RUN.includes(run.status)) return "idle";
  if (run.status === "assembling") {
    if (Date.now() - run.updatedAt.getTime() < STALE_ASSEMBLY_MS) return "idle"; // another invocation is on it
    const { count } = await prisma.libtvRun.updateMany({
      where: { id: runId, status: "assembling", updatedAt: run.updatedAt },
      data: { status: "running" },
    });
    if (count !== 1) return "idle";
    console.warn(`[${adapter.engine}] run ${runId} was stuck assembling — assembling again`);
    run.status = "running";
  }
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
    return {
      runId,
      nodeName: j.nodeName,
      aspectRatio: run.aspectRatio,
      durationSec: duration,
      projectId: run.projectId,
      settings: (j.settings ?? {}) as Record<string, unknown>,
      creditsEstimated: j.creditsEstimated ?? 0,
      referenceUrls: ((j.leftRefs as string[] | null) ?? []).map((r) => urlOf(r)).filter((u): u is string => !!u),
    };
  };
  const byName = new Map(run.jobs.map((j) => [j.nodeName, j]));
  const urlOf = (ref: string) => byName.get(refName(ref))?.resultUrl ?? byName.get(refName(ref))?.sourceUrl ?? null;

  // Uploads: the packshot/logo already live in our storage.
  for (const j of run.jobs.filter((x) => x.kind === "upload" && x.status === "queued")) {
    if (await claimJob(j.id)) await jobDone({ jobId: j.id, resultUrl: j.sourceUrl, creditsSpent: 0 });
  }

  // A keyframe or clip whose invocation was cut off before it got a task id stays
  // "running" forever: re-queue it after IMAGE_STALE_MS (fail it after MAX_IMAGE_ATTEMPTS).
  for (const j of run.jobs.filter((x) => (x.kind === "image" || x.kind === "video") && x.status === "running" && !x.nodeId)) {
    if (!j.startedAt || Date.now() - new Date(j.startedAt).getTime() < IMAGE_STALE_MS) continue;
    if ((j.attempts ?? 0) >= MAX_IMAGE_ATTEMPTS) await jobFailed(j.id, `${j.kind === "video" ? "Clip" : "Keyframe"} submission timed out repeatedly`);
    else await prisma.libtvJob.updateMany({ where: { id: j.id, status: "running" }, data: { status: "queued" } });
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
  // A keyframe edited from a reference (cast lock) waits until that reference image is done.
  const refsReady = (j: LibtvJob) =>
    ((j.leftRefs as string[] | null) ?? []).every((r) => {
      const ref = byName.get(refName(r));
      return !ref || ref.kind !== "image" || ref.status === "completed";
    });
  const images = run.jobs
    .filter((x) => x.kind === "image" && x.status === "queued" && refsReady(x))
    .slice(0, adapter.imagesPerTick);
  await Promise.all(
    images.map(async (j) => {
      if (!(await claimJob(j.id))) return;
      const settings = (j.settings ?? {}) as { compositeLocally?: boolean; directed?: number };
      try {
        if (settings.compositeLocally) {
          // CTA frames hold on the real packshot — no generation, no text drift.
          await jobDone({ jobId: j.id, resultUrl: urlOf(j.leftRefs ? (j.leftRefs as string[])[0] : "PROD-1"), skipped: true, creditsSpent: 0 });
          return;
        }
        // A directed keyframe already carries its own camera, light and surface detail: only the realism block is added.
        const stillPrompt = settings.directed ? finishDirectedStill(j.prompt) : cleanFramePrompt(j.prompt);
        const out = await adapter.generateImage(withNoText(stillPrompt, "image"), ctxFor(j));
        if ("url" in out) {
          // AI keyframe QC: send a visibly broken keyframe back once before a clip is made from it.
          const s = (j.settings ?? {}) as { qcAttempts?: number; castSheet?: unknown };
          if (keyframeQcEnabled() && adapter.engine !== "animatic") {
            // Keyframes edited from references are also checked for identity against them (strict: 2 re-rolls).
            const editFrom = (j.settings as { editFrom?: string } | null)?.editFrom;
            const refNames = editFrom ? ((j.leftRefs as string[] | null) ?? []) : [];
            const label = (r: string) => (r === "CAST" ? "casting sheet" : /^K\d+$/.test(r) ? "start frame of this shot" : "official product photo");
            const refImages = refNames.map((r) => ({ label: label(r), url: urlOf(r) })).filter((x): x is { label: string; url: string } => !!x.url);
            const verdict = await reviewKeyframe(out.url, j.prompt, refImages.length ? { images: refImages } : undefined);
            const attempts = s.qcAttempts ?? 0;
            if (shouldReroll(verdict, attempts, refImages.length ? Math.max(2, MAX_KEYFRAME_REROLLS) : MAX_KEYFRAME_REROLLS)) {
              await prisma.libtvJob.update({
                where: { id: j.id },
                data: { status: "queued", settings: { ...s, qcAttempts: attempts + 1, qcIssues: verdict!.issues.slice(0, 5), qcRejectedUrl: out.url } as never },
              });
              return;
            }
            if (verdict) {
              await prisma.libtvJob.update({ where: { id: j.id }, data: { settings: { ...s, qcOk: verdict.ok, qcIssues: verdict.issues.slice(0, 5) } as never } });
            }
          }
          await jobDone({ jobId: j.id, resultUrl: out.url, creditsSpent: 0 });
        } else await prisma.libtvJob.update({ where: { id: j.id }, data: { nodeId: out.taskId } });
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
  // A keyframe-review run holds its clips until "release-videos".
  for (const j of videos.filter((x) => x.status === "queued" && !(x.settings as { hold?: number } | null)?.hold)) {
    if (inFlight >= adapter.maxVideosInFlight) break;
    const ref = byNameFresh.get(refName(((j.leftRefs as string[] | null) ?? [])[0] ?? ""));
    if (ref && !TERMINAL_JOB.has(ref.status)) continue; // keyframe not ready yet
    if (ref?.status === "failed") continue; // the run fails on the keyframe; don't add a second error
    const imageUrl = ref?.resultUrl ?? undefined;
    // First + last frame anchoring: the clip also waits for its end keyframe (K<n>E).
    const vs = (j.settings ?? {}) as { anchorEnd?: number; seed?: number };
    const endRef = vs.anchorEnd ? byNameFresh.get(refName(((j.leftRefs as string[] | null) ?? [])[1] ?? "")) : undefined;
    if (endRef && !TERMINAL_JOB.has(endRef.status)) continue;
    const lastImageUrl = endRef?.status === "completed" ? (endRef.resultUrl ?? undefined) : undefined;
    if (!(await claimJob(j.id))) continue;
    // Free video models warp faces the moment people move: hold people shots on
    // their (sharp) keyframe with a slow zoom, and give AI motion to the rest.
    if (FACE_SAFE_ENGINES.has(adapter.engine) && imageUrl && faceSafe(j.prompt, ref?.prompt)) {
      try {
        const { animateStill } = await import("./animatic-executor");
        await jobDone({ jobId: j.id, resultUrl: await animateStill(imageUrl, ctxFor(j)), creditsSpent: 0 });
      } catch (err) {
        await jobFailed(j.id, errorText(err));
      }
      continue;
    }
    try {
      // Directed clips keep their camera move and action script; the legacy wrapper ("steady, slow camera,
      // smooth motion", "cinematic film still, sharp focus") is what made clips static and plastic.
      const directed = !!(j.settings as { directed?: number } | null)?.directed;
      const clipPrompt = directed ? finishDirectedMotion(j.prompt) : motionSafePrompt(cleanFramePrompt(j.prompt));
      const taskId = await adapter.submitVideo({ prompt: withNoText(clipPrompt, "video"), imageUrl, lastImageUrl, seed: vs.seed }, ctxFor(j));
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
  if (opts.remainingMs !== undefined && opts.remainingMs < (opts.reserveMs ?? ASSEMBLY_RESERVE_MS)) return "running"; // assemble in a fresh invocation

  const { count } = await prisma.libtvRun.updateMany({
    where: { id: runId, status: { in: ["running", "claimed", "approved"] } },
    data: { status: "assembling" },
  });
  if (count !== 1) return "running"; // another tick is assembling
  try {
    const frames = await storyboardFrames(run.storyboardId, run.directorPlan);
    const master = await assembleGlmMaster({ runId, projectId: run.projectId, aspectRatio: run.aspectRatio, frames, jobs: now as LibtvJob[] });
    // Free runs spend 0; bring-your-own paid clips record their cost.
    const spent = now.reduce((sum, x) => sum + (x.creditsSpent ?? 0), 0);
    await runDone({
      runId,
      masterMp4Url: master.masterUrl,
      voiceoverUrl: master.voiceoverUrl,
      subtitlesUrl: master.subtitlesUrl,
      previewMp4Url: master.previewUrl ?? null,
      contactSheetUrl: master.contactSheetUrl ?? null,
      qcReport: master.qcReport ?? null,
      creditsSpent: spent,
    });
    return "done";
  } catch (err) {
    await runFailed(runId, `Assembly failed: ${errorText(err)}`);
    return "failed";
  }
}

/**
 * A frame's on-screen text and voiceover line. A directed frame takes the plan
 * as-is: a null line means the previous line covers this shot (falling back to
 * the storyboard line would speak it twice). Pure.
 */
export function frameCopy(
  plan: { vo?: string | null; txt?: string | null } | undefined,
  storyText: unknown,
  storyVo: unknown
): { text: string | null; voiceover: string | null } {
  // On-screen text has no "covered by the previous line" meaning: a shot the plan left
  // without a keyword keeps the storyboard's (the hook headline lives there).
  if (plan) return { text: plan.txt ?? (typeof storyText === "string" ? storyText : null), voiceover: plan.vo ?? null };
  return { text: typeof storyText === "string" ? storyText : null, voiceover: typeof storyVo === "string" ? storyVo : null };
}

/**
 * The storyboard's frames as the edit sees them. A directed run's plan overrides
 * each frame's voiceover line and on-screen text (the selling-point copy).
 */
export async function storyboardFrames(storyboardId: string | null, directorPlan?: unknown): Promise<AssembleFrame[]> {
  if (!storyboardId) return [];
  const sb = await prisma.storyboard.findUnique({ where: { id: storyboardId }, select: { frames: true, frameSeconds: true } });
  const frameSeconds = sb?.frameSeconds || 2;
  const frames = Array.isArray(sb?.frames)
    ? (sb!.frames as { frameNumber?: number; startSec?: number; endSec?: number; textOverlay?: string | null; voiceover?: string | null; segment?: string | null; imagePrompt?: string | null; scene?: string | null; locked?: { speed?: number; zoomHit?: { x: number; y: number }; fine?: string; endCard?: { id: string; data?: Record<string, unknown> } } }[])
    : [];
  const plan = (directorPlan as { frames?: Record<string, { vo?: string | null; txt?: string | null }> } | null)?.frames ?? {};
  return frames.map((f, i) => {
    const n = f.frameNumber ?? i + 1;
    const p = plan[String(n)];
    return {
      frameNumber: n,
      startSec: Number.isFinite(f.startSec) ? f.startSec! : i * frameSeconds,
      endSec: Number.isFinite(f.endSec) ? f.endSec! : (i + 1) * frameSeconds,
      ...frameCopy(p, f.textOverlay, f.voiceover),
      segment: typeof f.segment === "string" ? f.segment : null,
      hasPerson: hasPeople(`${f.imagePrompt ?? ""} ${f.scene ?? ""}`),
      speed: f.locked?.speed ?? 1,
      zoomHit: f.locked?.zoomHit ?? null,
      fine: f.locked?.fine ?? null,
      endCard: f.locked?.endCard?.id ? { id: f.locked.endCard.id, data: (f.locked.endCard.data ?? {}) as never } : null,
    };
  });
}

/** Keep ticking a run until it settles or the time budget runs out. */
export async function driveRun(
  adapter: EngineAdapter,
  runId: string,
  budgetMs = 270_000,
  sleepMs = 8000,
  reserveMs = ASSEMBLY_RESERVE_MS
): Promise<TickResult> {
  const deadline = Date.now() + budgetMs;
  let result: TickResult = "running";
  while (Date.now() < deadline) {
    result = await tickRun(adapter, runId, { remainingMs: deadline - Date.now(), reserveMs }).catch((err) => {
      console.warn(`[${adapter.engine}] tick ${runId} failed:`, errorText(err));
      return "running" as TickResult;
    });
    if (result !== "running") break;
    await new Promise((r) => setTimeout(r, sleepMs));
  }
  return result;
}

/**
 * Cron sweep: advance every active run of this engine a little. A run whose
 * jobs are all done (or a stuck assembly) goes first with the whole budget, so
 * it can assemble even when nobody has Studio open.
 */
export async function advanceActiveRuns(
  adapter: EngineAdapter,
  budgetMs = 50_000,
  sleepMs = 8000,
  reserveMs = ASSEMBLY_RESERVE_MS
): Promise<number> {
  const runs = await prisma.libtvRun.findMany({
    where: { executor: adapter.engine, status: { in: ["approved", "claimed", "running", "assembling"] } },
    select: { id: true, status: true, jobs: { select: { status: true } } },
    take: 5,
  });
  if (!runs.length) return 0;
  const deadline = Date.now() + budgetMs;
  const ready = (r: (typeof runs)[number]) => r.status === "assembling" || (r.jobs ?? []).every((j) => TERMINAL_JOB.has(j.status));
  const ordered = [...runs.filter(ready), ...runs.filter((r) => !ready(r))];
  for (const [i, r] of ordered.entries()) {
    const left = deadline - Date.now();
    if (left <= 0) break;
    const share = ready(r) ? left : Math.max(10_000, Math.floor(left / (ordered.length - i)));
    await driveRun(adapter, r.id, share, sleepMs, reserveMs);
  }
  return runs.length;
}
