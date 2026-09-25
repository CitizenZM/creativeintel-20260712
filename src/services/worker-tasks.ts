/**
 * Queue helpers for WorkerTask — generic browser-only jobs run by the local
 * research worker on the operator's Mac (public ad libraries that block
 * server-side fetches: Meta Ad Library media, TikTok Ad Library, Google Ads
 * Transparency Center).
 *
 * The worker never touches the DB; it speaks HTTPS to /api/worker/tasks.
 *
 * Claim uses the same optimistic conditional-UPDATE pattern as
 * video-gen/browser-queue.ts:90-119 (updateMany with the status still in the
 * WHERE clause is the atomic transition), but attempts is incremented exactly
 * once — at claim — instead of a second time on failure.
 */
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";

export const MAX_ATTEMPTS = 3;
const STALE_AFTER_MS = 20 * 60 * 1000;
const REUSE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type WorkerTaskKind = "ad_library_fetch" | "browser_fetch";

export interface AdLibraryFetchPayload {
  source: "meta" | "tiktok" | "google";
  advertiser: string;
  competitorId: string | null;
  countries: string[];
  mediaType: "video";
  limit: number;
}

/**
 * Fetch one URL through the operator's real browser. Exists because a growing
 * list of sites answer this app's datacentre IP with a block while serving the
 * same URL normally from a residential one — DuckDuckGo replies 202 with an
 * anti-bot challenge, and many DTC storefronts reply 403.
 */
export interface BrowserFetchPayload {
  url: string;
  /** Extra settle time for client-rendered pages. */
  waitMs?: number;
}

export interface BrowserFetchResult {
  finalUrl: string;
  status: number;
  title: string;
  html: string;
  text: string;
}

/** Stable hash over the semantic payload, stored inside payload for lookup. */
export function payloadHash(payload: AdLibraryFetchPayload | BrowserFetchPayload): string {
  if ("url" in payload) {
    return createHash("sha1").update(JSON.stringify({ url: payload.url })).digest("hex");
  }
  const canonical = JSON.stringify({
    source: payload.source,
    advertiser: payload.advertiser.trim().toLowerCase(),
    competitorId: payload.competitorId ?? null,
    countries: [...payload.countries].map((c) => c.toUpperCase()).sort(),
    mediaType: payload.mediaType,
    limit: payload.limit,
  });
  return createHash("sha1").update(canonical).digest("hex");
}

export type StoredPayload = (AdLibraryFetchPayload | BrowserFetchPayload) & {
  hash: string;
};

// ─── Enqueue + reuse ─────────────────────────────────────────────────────────

/** A completed task with the same payload hash inside the reuse window. */
export async function findRecentCompletedTask(
  kind: WorkerTaskKind,
  hash: string,
  withinMs: number = REUSE_WINDOW_MS
) {
  return prisma.workerTask.findFirst({
    where: {
      kind,
      status: "completed",
      completedAt: { gte: new Date(Date.now() - withinMs) },
      payload: { path: ["hash"], equals: hash },
    },
    orderBy: { completedAt: "desc" },
  });
}

export interface EnqueueResult {
  taskId: string | null;
  deduped: boolean;
}

/**
 * Enqueue a task unless an identical one is already queued/claimed/running.
 * Callers check findRecentCompletedTask first to reuse a fresh result.
 */
export async function enqueueWorkerTask(params: {
  projectId: string | null;
  kind: WorkerTaskKind;
  payload: AdLibraryFetchPayload | BrowserFetchPayload;
  priority?: number;
}): Promise<EnqueueResult> {
  const hash = payloadHash(params.payload);
  const pending = await prisma.workerTask.findFirst({
    where: {
      kind: params.kind,
      status: { in: ["queued", "claimed", "running"] },
      payload: { path: ["hash"], equals: hash },
    },
    select: { id: true },
  });
  if (pending) return { taskId: pending.id, deduped: true };

  const stored: StoredPayload = { ...params.payload, hash };
  const row = await prisma.workerTask.create({
    data: {
      projectId: params.projectId,
      kind: params.kind,
      payload: stored as never,
      priority: params.priority ?? 0,
      status: "queued",
    },
    select: { id: true },
  });
  return { taskId: row.id, deduped: false };
}

// ─── Claim ───────────────────────────────────────────────────────────────────

/**
 * Atomically claim one queued task. `updateMany`'s WHERE re-evaluates the row's
 * current state, so count === 1 proves this call performed the transition.
 * attempts is incremented here and nowhere else.
 */
export async function claimNextTask(workerId: string, kinds?: string[]) {
  const kindFilter = kinds && kinds.length > 0 ? { kind: { in: kinds } } : {};

  const candidates = await prisma.workerTask.findMany({
    where: { status: "queued", attempts: { lt: MAX_ATTEMPTS }, ...kindFilter },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    take: 10,
    select: { id: true },
  });

  for (const candidate of candidates) {
    const { count } = await prisma.workerTask.updateMany({
      where: { id: candidate.id, status: "queued" },
      data: {
        status: "claimed",
        workerId,
        claimedAt: new Date(),
        startedAt: new Date(),
        attempts: { increment: 1 },
      },
    });
    if (count === 1) {
      return prisma.workerTask.findUnique({ where: { id: candidate.id } });
    }
  }

  return null;
}

// ─── Complete / fail / heartbeat ─────────────────────────────────────────────

export async function completeTask(id: string, result: unknown) {
  return prisma.workerTask.update({
    where: { id },
    data: {
      status: "completed",
      result: (result ?? null) as never,
      error: null,
      completedAt: new Date(),
    },
  });
}

/**
 * Marks a task failed. attempts was already incremented at claim time, so it is
 * NOT bumped again here — the task returns to "queued" for another try until
 * attempts reaches MAX_ATTEMPTS, then stays terminally "failed".
 */
export async function failTask(id: string, error: string) {
  const task = await prisma.workerTask.findUnique({ where: { id } });
  if (!task) return null;

  const terminal = task.attempts >= MAX_ATTEMPTS;
  return prisma.workerTask.update({
    where: { id },
    data: {
      error: error.slice(0, 2000),
      status: terminal ? "failed" : "queued",
      workerId: terminal ? task.workerId : null,
      claimedAt: terminal ? task.claimedAt : null,
      completedAt: terminal ? new Date() : null,
    },
  });
}

export async function heartbeatTask(id: string) {
  // Bumps updatedAt (via @updatedAt) so requeueStaleTasks' clock resets.
  return prisma.workerTask.update({
    where: { id },
    data: { status: "running", claimedAt: new Date() },
  });
}

// ─── Worker liveness ─────────────────────────────────────────────────────────

/** A worker that polled within this window is considered online. */
const WORKER_ONLINE_MS = 3 * 60 * 1000;
const ONLINE_CACHE_MS = 30 * 1000;
let onlineCache: { at: number; online: boolean } | null = null;

export async function recordWorkerSeen(workerId: string) {
  await prisma.workerHeartbeat
    .upsert({
      where: { workerId },
      create: { workerId, lastSeenAt: new Date() },
      update: { lastSeenAt: new Date() },
    })
    .catch(() => null);
}

/**
 * True when a local worker polled or touched a task recently. Callers that
 * block waiting on the worker check this first so an offline Mac costs nothing
 * instead of minutes of polling a task nobody will claim.
 */
export async function isWorkerOnline(): Promise<boolean> {
  if (onlineCache && Date.now() - onlineCache.at < ONLINE_CACHE_MS) return onlineCache.online;
  const since = new Date(Date.now() - WORKER_ONLINE_MS);
  const [beat, task] = await Promise.all([
    prisma.workerHeartbeat.findFirst({ where: { lastSeenAt: { gte: since } }, select: { workerId: true } }),
    prisma.workerTask.findFirst({
      where: { status: { in: ["claimed", "running", "completed"] }, updatedAt: { gte: since } },
      select: { id: true },
    }),
  ]).catch(() => [null, null] as const);
  const online = !!(beat || task);
  onlineCache = { at: Date.now(), online };
  return online;
}

/** Bounces tasks stuck in claimed/running for over 20 minutes back to queued. */
export async function requeueStaleTasks() {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);
  return prisma.workerTask.updateMany({
    where: {
      status: { in: ["claimed", "running"] },
      updatedAt: { lt: cutoff },
    },
    data: { status: "queued", workerId: null, claimedAt: null },
  });
}

// ─── Reporting ───────────────────────────────────────────────────────────────

export async function getTaskStatusCounts(projectId: string, kind: WorkerTaskKind) {
  const rows = await prisma.workerTask.groupBy({
    by: ["status"],
    where: { projectId, kind },
    _count: { _all: true },
  });
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = r._count._all;
  return counts;
}
