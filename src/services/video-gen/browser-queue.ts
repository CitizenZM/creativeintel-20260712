/**
 * Queue helpers for BrowserGenJob — browser-driven generation jobs executed
 * by a local worker on the operator's Mac, driving logged-in web UIs (Google
 * AI Studio for Nano Banana image gen, Flow for Veo video, Kling web) via
 * browser-harness. This trades API tokens for subscription/browser-session
 * quota; see prisma/schema.prisma's BrowserGenJob model comment.
 *
 * This module owns:
 *  - enqueueBrowserJob / claimNextJob / completeJob / failJob / requeueStale
 *  - the small keyframe-lookup reimplementation used by the enqueue route
 *    (deliberately NOT imported from studio/generate-shots/route.ts — see
 *    that file's header, which says not to edit it; the lookup logic is
 *    small enough to duplicate rather than couple the two routes together).
 */
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_ATTEMPTS = 3;
const STALE_AFTER_MS = 15 * 60 * 1000; // 15 minutes

// ─── enqueueBrowserJob ───────────────────────────────────────────────────────

export interface EnqueueBrowserJobInput {
  projectId: string;
  kind: "image_keyframe" | "video";
  site: "ai_studio" | "flow" | "kling";
  model?: string | null;
  prompt: string;
  negativePrompt?: string | null;
  inputImageUrl?: string | null;
  aspectRatio?: string;
  durationSec?: number | null;
  scriptId?: string | null;
  shotIndex?: number | null;
  promptVersion?: number;
}

export async function enqueueBrowserJob(data: EnqueueBrowserJobInput) {
  return prisma.browserGenJob.create({
    data: {
      projectId: data.projectId,
      kind: data.kind,
      site: data.site,
      model: data.model ?? null,
      prompt: data.prompt,
      negativePrompt: data.negativePrompt ?? null,
      inputImageUrl: data.inputImageUrl ?? null,
      aspectRatio: data.aspectRatio ?? "9:16",
      durationSec: data.durationSec ?? null,
      scriptId: data.scriptId ?? null,
      shotIndex: data.shotIndex ?? null,
      promptVersion: data.promptVersion ?? 1,
      status: "queued",
    },
  });
}

// ─── claimNextJob ────────────────────────────────────────────────────────────

/**
 * Atomically claims one queued job for a worker.
 *
 * Race-safety approach (no raw SQL, no SELECT ... FOR UPDATE):
 *   1. Fetch a small batch of candidate ids that are currently `status:
 *      "queued"` and (if `sites` given) match one of the requested sites,
 *      ordered oldest-first (FIFO).
 *   2. For each candidate in order, run
 *        prisma.browserGenJob.updateMany({
 *          where: { id: candidate.id, status: "queued" },
 *          data: { status: "claimed", workerId, claimedAt: now, attempts: { increment: 1 } },
 *        })
 *      and check the returned `count`. `updateMany`'s WHERE clause is
 *      re-evaluated by Postgres against the row's *current* state at
 *      execution time, so if another worker already claimed this row
 *      between our SELECT and our UPDATE, `status` is no longer "queued"
 *      and the predicate matches zero rows — count === 0. Only when
 *      count === 1 do we know *this* call performed the transition, so we
 *      re-fetch the row and return it.
 *   3. If count === 0 (lost the race), move to the next candidate in the
 *      batch. If the whole batch is exhausted, return null (no job).
 *
 * This is the standard "optimistic conditional UPDATE" pattern for
 * work-queues on top of an ORM that doesn't expose SELECT ... FOR UPDATE
 * SKIP LOCKED directly — it's safe under concurrent claims because the
 * status transition itself is the atomic operation (a single UPDATE
 * statement is always atomic in Postgres), not the preceding SELECT.
 */
export async function claimNextJob(workerId: string, sites?: string[]) {
  const siteFilter =
    sites && sites.length > 0 ? { site: { in: sites } } : {};

  const candidates = await prisma.browserGenJob.findMany({
    where: { status: "queued", ...siteFilter },
    orderBy: { createdAt: "asc" },
    take: 10,
    select: { id: true },
  });

  for (const candidate of candidates) {
    const { count } = await prisma.browserGenJob.updateMany({
      where: { id: candidate.id, status: "queued" },
      data: {
        status: "claimed",
        workerId,
        claimedAt: new Date(),
        attempts: { increment: 1 },
      },
    });

    if (count === 1) {
      return prisma.browserGenJob.findUnique({ where: { id: candidate.id } });
    }
    // count === 0: another worker won the race for this candidate — try the next one.
  }

  return null;
}

// ─── completeJob / failJob ───────────────────────────────────────────────────

export async function completeJob(id: string, resultUrl: string) {
  return prisma.browserGenJob.update({
    where: { id },
    data: {
      status: "completed",
      resultUrl,
      error: null,
      completedAt: new Date(),
    },
  });
}

/**
 * Marks a job failed. `attempts` is already incremented by claimNextJob, so it
 * is NOT bumped again here — incrementing in both places counted every attempt
 * twice and cut the effective retry budget from 3 to 1.
 */
export async function failJob(id: string, error: string) {
  const job = await prisma.browserGenJob.findUnique({ where: { id } });
  if (!job) return null;

  const terminal = job.attempts >= MAX_ATTEMPTS;

  return prisma.browserGenJob.update({
    where: { id },
    data: {
      error,
      status: terminal ? "failed" : "queued",
      workerId: terminal ? job.workerId : null,
      claimedAt: terminal ? job.claimedAt : null,
    },
  });
}

// ─── requeueStale ────────────────────────────────────────────────────────────

/**
 * Reclaims jobs stuck in "claimed" or "running" for longer than 15 minutes
 * (worker crashed / lost connection to the browser) by bouncing them back
 * to "queued". Uses updatedAt as the staleness clock since claimedAt is not
 * bumped by heartbeat (heartbeat bumps updatedAt — see worker route).
 */
export async function requeueStale() {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);
  return prisma.browserGenJob.updateMany({
    where: {
      status: { in: ["claimed", "running"] },
      updatedAt: { lt: cutoff },
    },
    data: {
      status: "queued",
      workerId: null,
      claimedAt: null,
    },
  });
}

// ─── Keyframe lookup (reimplemented — do not import from generate-shots) ────

/**
 * Reimplements the small keyframe lookup from
 * studio/generate-shots/route.ts (that file is explicitly off-limits to
 * edit or import from). Keyframes are persisted as PreviewAsset rows tagged
 * style = "keyframe-{shotNumber}-script-{scriptId}" (shotNumber is 1-based;
 * shotIndex = shotNumber - 1). Rows are read newest-first so the first hit
 * per shotIndex wins, and a scriptId-tagged hit always overrides an
 * untagged one for the same shotIndex.
 */
export async function lookupKeyframesByShotIndex(
  projectId: string,
  scriptId: string
): Promise<Map<number, string>> {
  const keyframesByShotIndex = new Map<number, string>();

  const previewAssets = await prisma.previewAsset.findMany({
    where: {
      projectId,
      style: { startsWith: "keyframe-" },
      imageUrl: { not: null },
    },
    orderBy: { createdAt: "desc" },
  });

  for (const asset of previewAssets) {
    const match = /^keyframe-(\d+)(?:-script-(.+))?$/.exec(asset.style || "");
    if (!match) continue;
    const shotNumber = Number(match[1]);
    const taggedScriptId = match[2];
    if (taggedScriptId && taggedScriptId !== scriptId) continue;
    const shotIndex = shotNumber - 1;
    if (!asset.imageUrl) continue;
    const alreadyTagged =
      keyframesByShotIndex.has(shotIndex) && taggedScriptId === scriptId;
    if (!keyframesByShotIndex.has(shotIndex) || alreadyTagged) {
      keyframesByShotIndex.set(shotIndex, asset.imageUrl);
    }
  }

  return keyframesByShotIndex;
}

// ─── Idempotency check for from-script enqueue ──────────────────────────────

/**
 * Idempotent per (scriptId, shotIndex, kind, site): returns the existing
 * non-failed job for this combination, if any, unless `force` is true.
 */
export async function findExistingShotJob(params: {
  projectId: string;
  scriptId: string;
  shotIndex: number;
  kind: string;
  site: string;
}) {
  return prisma.browserGenJob.findFirst({
    where: {
      projectId: params.projectId,
      scriptId: params.scriptId,
      shotIndex: params.shotIndex,
      kind: params.kind,
      site: params.site,
      status: { not: "failed" },
    },
  });
}

// ─── Status counts for GET ───────────────────────────────────────────────────

export async function getJobsWithStatusCounts(scriptId: string) {
  const jobs = await prisma.browserGenJob.findMany({
    where: { scriptId },
    orderBy: [{ shotIndex: "asc" }, { createdAt: "asc" }],
  });

  const statusCounts: Record<string, number> = {};
  for (const job of jobs) {
    statusCounts[job.status] = (statusCounts[job.status] ?? 0) + 1;
  }

  return { jobs, statusCounts };
}

export type { Prisma };
