/**
 * Claim/lease machinery for LibtvRun and its LibtvJob nodes.
 *
 * The unit of work is a whole run, not a node: a canvas is bound once, nodes
 * reference each other by name, and `--run` blocks, so two workers on one run
 * would collide on the canvas. Claiming uses the conditional-updateMany pattern
 * from browser-queue.ts — a single UPDATE whose WHERE re-checks `status` is
 * atomic in Postgres, so exactly one caller wins.
 *
 * `attempts` is incremented in exactly one place (jobStarted); the browser
 * queue's double increment at claim *and* fail is the bug this replaces.
 */
import { prisma } from "@/lib/db";
import { canvasUrlFor } from "./libtv-compile";

const STALE_AFTER_MS = 30 * 60 * 1000;
const MAX_JOB_ATTEMPTS = 3;
const ACTIVE_RUN_STATUSES = ["claimed", "running", "assembling"] as const;

export const RUN_STATUSES = [
  "draft",
  "awaiting_approval",
  "approved",
  "claimed",
  "running",
  "assembling",
  "completed",
  "failed",
  "cancelled",
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export function isActiveRunStatus(status: string): boolean {
  return (ACTIVE_RUN_STATUSES as readonly string[]).includes(status) || status === "approved";
}

// ─── Reads ───────────────────────────────────────────────────────────────────

export async function getRunWithJobs(runId: string) {
  return prisma.libtvRun.findUnique({
    where: { id: runId },
    include: { jobs: { orderBy: [{ kind: "asc" }, { shotIndex: "asc" }, { createdAt: "asc" }] } },
  });
}

export async function listRuns(projectId: string, limit = 20) {
  return prisma.libtvRun.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { jobs: { orderBy: [{ shotIndex: "asc" }, { createdAt: "asc" }] } },
  });
}

/** Nodes execute in dependency order: uploads, then every K, then every V. */
function orderJobs<T extends { kind: string; shotIndex: number; nodeName: string }>(jobs: T[]): T[] {
  const rank = (kind: string) => (kind === "upload" ? 0 : kind === "image" ? 1 : 2);
  return [...jobs].sort(
    (a, b) => rank(a.kind) - rank(b.kind) || a.shotIndex - b.shotIndex || a.nodeName.localeCompare(b.nodeName)
  );
}

// ─── Approval ────────────────────────────────────────────────────────────────

export async function approveRun(runId: string, creditCap?: number | null) {
  const { count } = await prisma.libtvRun.updateMany({
    where: { id: runId, status: { in: ["draft", "awaiting_approval"] } },
    data: {
      status: "approved",
      approvedAt: new Date(),
      creditCap: creditCap ?? undefined,
      error: null,
    },
  });
  if (count !== 1) return null;
  return getRunWithJobs(runId);
}

export async function cancelRun(runId: string) {
  const { count } = await prisma.libtvRun.updateMany({
    where: { id: runId, status: { notIn: ["completed", "cancelled"] } },
    data: { status: "cancelled", completedAt: new Date(), workerId: null, claimedAt: null },
  });
  if (count !== 1) return null;
  await prisma.libtvJob.updateMany({
    where: { runId, status: { in: ["queued", "running"] } },
    data: { status: "skipped" },
  });
  return getRunWithJobs(runId);
}

// ─── Claim ───────────────────────────────────────────────────────────────────

export interface ClaimedRunPayload {
  run: {
    id: string;
    projectId: string;
    scriptId: string | null;
    storyboardId: string | null;
    canvasUuid: string | null;
    canvasUrl: string | null;
    canvasName: string | null;
    imageModel: string;
    videoModel: string;
    aspectRatio: string;
    clipDurationSec: number;
    creditsEstimated: number;
    creditCap: number | null;
  };
  project: { brandName: string; libtvCanvasUuid: string | null };
  scriptTitle: string | null;
  storyboardTitle: string | null;
  frames: unknown[];
  jobs: Array<{
    id: string;
    kind: string;
    shotIndex: number;
    nodeName: string;
    leftRefs: string[];
    prompt: string;
    modelName: string | null;
    settings: Record<string, unknown>;
    sourceUrl: string | null;
    creditsEstimated: number;
    status: string;
  }>;
}

export async function claimNextRun(workerId: string): Promise<ClaimedRunPayload | null> {
  const candidates = await prisma.libtvRun.findMany({
    where: { status: "approved" },
    orderBy: { approvedAt: "asc" },
    take: 10,
    select: { id: true },
  });

  for (const candidate of candidates) {
    const { count } = await prisma.libtvRun.updateMany({
      where: { id: candidate.id, status: "approved" },
      data: { status: "claimed", workerId, claimedAt: new Date(), startedAt: new Date(), error: null },
    });
    if (count !== 1) continue;
    return buildClaimPayload(candidate.id);
  }

  return null;
}

async function buildClaimPayload(runId: string): Promise<ClaimedRunPayload | null> {
  const run = await prisma.libtvRun.findUnique({
    where: { id: runId },
    include: { jobs: true, project: { select: { brandName: true, libtvCanvasUuid: true } } },
  });
  if (!run) return null;

  const [script, storyboard] = await Promise.all([
    run.scriptId ? prisma.script.findUnique({ where: { id: run.scriptId }, select: { title: true } }) : null,
    run.storyboardId
      ? prisma.storyboard.findUnique({ where: { id: run.storyboardId }, select: { title: true, frames: true } })
      : null,
  ]);

  return {
    run: {
      id: run.id,
      projectId: run.projectId,
      scriptId: run.scriptId,
      storyboardId: run.storyboardId,
      canvasUuid: run.canvasUuid,
      canvasUrl: run.canvasUrl,
      canvasName: run.canvasName,
      imageModel: run.imageModel,
      videoModel: run.videoModel,
      aspectRatio: run.aspectRatio,
      clipDurationSec: run.clipDurationSec,
      creditsEstimated: run.creditsEstimated,
      creditCap: run.creditCap,
    },
    project: run.project,
    scriptTitle: script?.title ?? null,
    storyboardTitle: storyboard?.title ?? null,
    frames: Array.isArray(storyboard?.frames) ? (storyboard.frames as unknown[]) : [],
    jobs: orderJobs(
      run.jobs.filter((j) => j.status === "queued" || j.status === "running" || j.status === "failed")
    ).map((j) => ({
      id: j.id,
      kind: j.kind,
      shotIndex: j.shotIndex,
      nodeName: j.nodeName,
      leftRefs: Array.isArray(j.leftRefs) ? (j.leftRefs as string[]) : [],
      prompt: j.prompt,
      modelName: j.modelName,
      settings: (j.settings as Record<string, unknown>) ?? {},
      sourceUrl: j.sourceUrl,
      creditsEstimated: j.creditsEstimated,
      status: j.status,
    })),
  };
}

// ─── Canvas binding ──────────────────────────────────────────────────────────

export async function bindCanvas(runId: string, canvasUuid: string, canvasName?: string | null) {
  const run = await prisma.libtvRun.update({
    where: { id: runId },
    data: {
      canvasUuid,
      canvasUrl: canvasUrlFor(canvasUuid),
      canvasName: canvasName ?? undefined,
      status: "running",
    },
  });
  await prisma.project
    .update({ where: { id: run.projectId }, data: { libtvCanvasUuid: canvasUuid } })
    .catch(() => null);
  return run;
}

// ─── Node-level transitions ──────────────────────────────────────────────────

export async function jobStarted(jobId: string) {
  const job = await prisma.libtvJob.update({
    where: { id: jobId },
    data: { status: "running", startedAt: new Date(), attempts: { increment: 1 }, error: null },
  });
  await prisma.libtvRun.updateMany({
    where: { id: job.runId, status: { in: ["claimed", "approved"] } },
    data: { status: "running" },
  });
  return job;
}

export interface JobDoneInput {
  jobId: string;
  nodeId?: string | null;
  resultUrl?: string | null;
  remoteUrl?: string | null;
  localPath?: string | null;
  creditsSpent?: number | null;
  skipped?: boolean;
}

export async function jobDone(input: JobDoneInput) {
  return prisma.libtvJob.update({
    where: { id: input.jobId },
    data: {
      status: input.skipped ? "skipped" : "completed",
      nodeId: input.nodeId ?? undefined,
      resultUrl: input.resultUrl ?? undefined,
      remoteUrl: input.remoteUrl ?? undefined,
      localPath: input.localPath ?? undefined,
      creditsSpent: input.creditsSpent ?? undefined,
      error: null,
      completedAt: new Date(),
    },
  });
}

export async function jobFailed(jobId: string, error: string) {
  const job = await prisma.libtvJob.findUnique({ where: { id: jobId } });
  if (!job) return null;
  const terminal = job.attempts >= MAX_JOB_ATTEMPTS;
  return prisma.libtvJob.update({
    where: { id: jobId },
    data: {
      status: terminal ? "failed" : "queued",
      error: error.slice(0, 2000),
      completedAt: terminal ? new Date() : null,
    },
  });
}

// ─── Run-level transitions ───────────────────────────────────────────────────

export interface RunDoneInput {
  runId: string;
  masterMp4Url?: string | null;
  previewMp4Url?: string | null;
  contactSheetUrl?: string | null;
  creditsSpent?: number | null;
}

export async function runDone(input: RunDoneInput) {
  const spent =
    input.creditsSpent ??
    (await prisma.libtvJob
      .aggregate({ where: { runId: input.runId }, _sum: { creditsSpent: true } })
      .then((r) => r._sum.creditsSpent ?? 0));

  return prisma.libtvRun.update({
    where: { id: input.runId },
    data: {
      status: "completed",
      masterMp4Url: input.masterMp4Url ?? undefined,
      previewMp4Url: input.previewMp4Url ?? undefined,
      contactSheetUrl: input.contactSheetUrl ?? undefined,
      creditsSpent: spent,
      error: null,
      completedAt: new Date(),
      workerId: null,
      claimedAt: null,
    },
  });
}

export async function runAssembling(runId: string) {
  return prisma.libtvRun.update({ where: { id: runId }, data: { status: "assembling" } });
}

export async function runFailed(runId: string, error: string, opts: { needsLogin?: boolean } = {}) {
  const prefix = opts.needsLogin ? "needs libtv login web: " : "";
  return prisma.libtvRun.update({
    where: { id: runId },
    data: {
      status: "failed",
      error: `${prefix}${error}`.slice(0, 2000),
      completedAt: new Date(),
      workerId: null,
      claimedAt: null,
    },
  });
}

// ─── Heartbeat / staleness ───────────────────────────────────────────────────

export async function heartbeat(runId: string, workerId: string) {
  const { count } = await prisma.libtvRun.updateMany({
    where: { id: runId, workerId, status: { in: [...ACTIVE_RUN_STATUSES] } },
    data: { claimedAt: new Date() },
  });
  return count === 1;
}

/** A run whose worker died for 30 minutes goes back to `approved`, not to the approval gate. */
export async function requeueStale() {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);
  const stale = await prisma.libtvRun.findMany({
    where: { status: { in: [...ACTIVE_RUN_STATUSES] }, updatedAt: { lt: cutoff } },
    select: { id: true },
  });
  if (!stale.length) return { count: 0 };

  const ids = stale.map((r) => r.id);
  await prisma.libtvJob.updateMany({
    where: { runId: { in: ids }, status: "running" },
    data: { status: "queued" },
  });
  return prisma.libtvRun.updateMany({
    where: { id: { in: ids } },
    data: { status: "approved", workerId: null, claimedAt: null },
  });
}
