import { prisma } from "@/lib/db";
import { pMap } from "@/lib/parallel";
import { getVideoModel } from "@/services/video-gen/models";
import { logAiUsage } from "@/services/ai/usage";

/** Paid video usage row, priced from the model table's costPerSecond. */
function logPaidVideo(job: Pick<FalVideoJob, "model" | "projectId">, provider: string, seconds: number) {
  const def = getVideoModel(job.model);
  logAiUsage({
    provider,
    model: job.model,
    capability: "video",
    videoSeconds: seconds,
    costUsd: def ? def.costPerSecond * seconds : null,
    projectId: job.projectId,
  });
}
import type { FalVideoJob } from "@/generated/prisma/client";

/**
 * Server-side polling core shared by:
 *   - GET /api/projects/[projectId]/studio/fal-status/[jobId] (fal provider)
 *   - GET /api/projects/[projectId]/studio/video-status/[operationId] (veo provider)
 *   - GET /api/cron/poll-video-jobs (background sweep, both providers)
 *
 * Preserves the exact terminal-write behavior that previously lived
 * inline in the fal-status and video-status routes.
 */

/** generate-shots (i2v jobs) prefixes job.prompt with a recoverable marker. */
const ENDPOINT_MARKER_RE = /^\[\[endpoint:([^\]]+)\]\]/;

export function stripEndpointMarker(p: string): string {
  return p.replace(/^\[\[endpoint:[^\]]+\]\]/, "");
}

export interface PollResult {
  job: FalVideoJob;
  status: string;
  videoUrl?: string | null;
  error?: string | null;
  /** Only set for veo jobs still in flight — raw operation metadata. */
  metadata?: unknown;
}

/** Result shape for polling a Veo operation directly by operationId (video-status route). */
export interface VeoPollResult {
  done: boolean;
  videoUrl?: string | null;
  metadata?: unknown;
}

export class PollError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

/**
 * Polls a single FalVideoJob against its provider (fal.ai or Veo LRO) and
 * applies the exact same terminal writes the original inline route logic did.
 * Throws PollError for conditions the original routes surfaced as HTTP errors
 * (missing API key, unknown model) — callers polling in bulk should catch.
 */
export async function pollJob(job: FalVideoJob): Promise<PollResult> {
  if (job.status === "completed" || job.status === "failed") {
    return { job, status: job.status, videoUrl: job.videoUrl, error: job.error };
  }

  const modelDef = getVideoModel(job.model);

  if (modelDef?.provider === "veo") {
    const veoResult = await pollVeoOperation(job.falRequestId);
    if (veoResult.done) {
      const refreshed = await prisma.falVideoJob.findUnique({ where: { id: job.id } });
      return {
        job: refreshed ?? job,
        status: refreshed?.status ?? (veoResult.videoUrl ? "completed" : "failed"),
        videoUrl: veoResult.videoUrl,
        error: refreshed?.error,
      };
    }
    return { job, status: job.status, metadata: veoResult.metadata };
  }

  return pollFalJob(job, modelDef);
}

/**
 * Polls a Veo long-running-operation by operationId directly (used by the
 * video-status/[operationId] route, which does not always have a FalVideoJob
 * row to hand in). Persists completion to any FalVideoJob row keyed by
 * falRequestId === operationId, exactly as the original inline route logic did.
 */
export async function pollVeoOperation(operationId: string): Promise<VeoPollResult> {
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) throw new PollError("Google API key not configured", 500);

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${operationId}`,
    { headers: { "x-goog-api-key": apiKey } }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new PollError(err, res.status);
  }

  const data = await res.json();

  if (data.done) {
    const videos = data.response?.generateVideoResponse?.generatedSamples || [];
    const videoUrl = videos[0]?.video?.uri || null;

    try {
      if (videoUrl) {
        const jobs = await prisma.falVideoJob.findMany({
          where: { falRequestId: operationId, status: { notIn: ["completed", "failed"] } },
          select: { model: true, projectId: true, durationSec: true },
        });
        for (const j of jobs) logPaidVideo(j, "veo", j.durationSec ?? 8);
      }
      await prisma.falVideoJob.updateMany({
        where: { falRequestId: operationId },
        data: {
          status: videoUrl ? "completed" : "failed",
          videoUrl: videoUrl ?? null,
          completedAt: new Date(),
          error: videoUrl ? null : "Veo reported done but no video URL was returned",
        },
      });
    } catch (err) {
      console.error("Failed to persist Veo completion to FalVideoJob:", err);
    }

    return { done: true, videoUrl };
  }

  return { done: false, metadata: data.metadata || null };
}

async function pollFalJob(
  job: FalVideoJob,
  modelDef: ReturnType<typeof getVideoModel>
): Promise<PollResult> {
  const falKey = process.env.FAL_KEY;
  if (!falKey) throw new PollError("FAL_KEY not set", 500);

  if (!modelDef || modelDef.provider !== "fal") {
    throw new PollError(
      `Unknown or non-fal video model "${job.model}" for job ${job.id}`,
      422
    );
  }

  // Per-shot i2v jobs (studio/generate-shots) submit against modelDef.i2vEndpoint
  // instead of submitEndpoint. FalVideoJob has no dedicated "mode"/endpoint
  // column, so generate-shots prefixes job.prompt with a recoverable
  // "[[endpoint:<submitEndpoint>]]" marker. fal.ai's queue status/result paths
  // are scoped to the submit endpoint (not just the base model path), so i2v
  // jobs must poll using that same endpoint rather than modelDef.statusEndpoint.
  const endpointMarkerMatch = ENDPOINT_MARKER_RE.exec(job.prompt);
  const endpoint = endpointMarkerMatch ? endpointMarkerMatch[1] : modelDef.statusEndpoint;

  const statusRes = await fetch(
    `https://queue.fal.run/${endpoint}/requests/${job.falRequestId}/status`,
    { headers: { Authorization: `Key ${falKey}` } }
  );

  if (!statusRes.ok) {
    return {
      job,
      status: job.status,
      error: `fal status ${statusRes.status}`,
    };
  }

  const statusData = await statusRes.json();
  const falStatus: string = statusData.status;

  if (falStatus === "COMPLETED") {
    let video: Record<string, unknown> | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const resultRes = await fetch(
          `https://queue.fal.run/${endpoint}/requests/${job.falRequestId}`,
          { headers: { Authorization: `Key ${falKey}` }, signal: AbortSignal.timeout(10000) }
        );
        if (!resultRes.ok) {
          console.warn(`fal result fetch attempt ${attempt + 1} failed: ${resultRes.status}`);
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        const result = await resultRes.json();
        video = result.video ?? null;
        break;
      } catch (e) {
        console.warn(`fal result fetch attempt ${attempt + 1} error:`, e);
        if (attempt < 2) await new Promise(r => setTimeout(r, 1000));
      }
    }

    if (video?.url) logPaidVideo(job, "fal", (video?.duration as number | undefined) ?? job.durationSec ?? 5);
    const updated = await prisma.falVideoJob.update({
      where: { id: job.id },
      data: {
        status: video?.url ? "completed" : "failed",
        videoUrl: (video?.url as string | undefined) ?? null,
        fileSizeBytes: (video?.file_size as number | undefined) ?? null,
        widthPx: (video?.width as number | undefined) ?? null,
        heightPx: (video?.height as number | undefined) ?? null,
        fpS: (video?.fps as number | undefined) ?? null,
        durationSec: (video?.duration as number | undefined) ?? null,
        completedAt: new Date(),
        error: video?.url ? null : "Video URL not retrieved from fal.ai after 3 attempts",
      },
    });
    return { job: updated, status: updated.status, videoUrl: updated.videoUrl, error: updated.error };
  }

  if (falStatus === "FAILED") {
    const updated = await prisma.falVideoJob.update({
      where: { id: job.id },
      data: { status: "failed", error: statusData.error || "Generation failed" },
    });
    return { job: updated, status: updated.status, error: updated.error };
  }

  // Still processing
  const updated = await prisma.falVideoJob.update({
    where: { id: job.id },
    data: { status: "processing" },
  });
  return { job: updated, status: "processing" };
}

export interface PollAllResult {
  polled: number;
  completed: number;
  failed: number;
  timedOut: number;
  stillPending: number;
  errors: Array<{ id: string; error: string }>;
}

const STUCK_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours
const ACTIVE_STATUSES = ["queued", "processing", "generating"];

/**
 * Sweeps all active (queued/processing/generating) FalVideoJob rows, oldest
 * first, polling each with bounded concurrency. Never throws per-job —
 * failures are collected. Jobs stuck for >2h are marked failed with a
 * timeout error instead of being polled again.
 */
export async function pollAllActiveJobs(limit = 25): Promise<PollAllResult> {
  const jobs = await prisma.falVideoJob.findMany({
    where: { status: { in: ACTIVE_STATUSES } },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  const result: PollAllResult = {
    polled: jobs.length,
    completed: 0,
    failed: 0,
    timedOut: 0,
    stillPending: 0,
    errors: [],
  };

  const now = Date.now();

  await pMap(
    jobs,
    async (job) => {
      try {
        if (now - job.createdAt.getTime() > STUCK_THRESHOLD_MS) {
          await prisma.falVideoJob.update({
            where: { id: job.id },
            data: { status: "failed", error: "timeout: exceeded 2h" },
          });
          result.timedOut++;
          return;
        }

        const outcome = await pollJob(job);
        if (outcome.status === "completed") result.completed++;
        else if (outcome.status === "failed") result.failed++;
        else result.stillPending++;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        result.errors.push({ id: job.id, error: message });
      }
    },
    { concurrency: 4 }
  );

  return result;
}
