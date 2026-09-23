/**
 * Background jobs for long AI operations.
 *
 * A route creates a Job, returns its id at once, and runs the work in
 * `after()` — so the request never hits Cloudflare's ~100s origin timeout and
 * the page can reload and pick the job back up. Every job reports the same
 * shape (done/total, per-item steps, ETA) so one progress component renders
 * them all.
 */
import { prisma } from "@/lib/db";
import { pMapSettled } from "@/lib/parallel";

export const JOB_KINDS = ["angles", "scripts", "storyboards", "analysis"] as const;
export type JobKind = (typeof JOB_KINDS)[number];
export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type StepStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export interface JobStep {
  key: string;
  label: string;
  status: StepStatus;
  error?: string;
  resultId?: string;
}

export interface JobFailure {
  key: string;
  label: string;
  error: string;
}

export const TERMINAL: readonly JobStatus[] = ["completed", "failed", "cancelled"];

// A running job whose heartbeat is older than this died with its function
// (maxDuration is 300s) — report it as failed instead of spinning forever.
const STALE_MS = 6 * 60 * 1000;

// Seconds per item before any history exists, measured on production runs.
const DEFAULT_SECONDS_PER_ITEM: Record<JobKind, number> = {
  angles: 35,
  scripts: 12,
  storyboards: 15,
  analysis: 3,
};

export function isJobKind(value: unknown): value is JobKind {
  return typeof value === "string" && (JOB_KINDS as readonly string[]).includes(value);
}

/**
 * The job already running for this project and kind, if any. Routes call this
 * before starting work so a double click or a second tab joins the running
 * job instead of paying for the same generation twice.
 */
export async function runningJob(projectId: string, kind: JobKind) {
  return findActiveJob(projectId, kind);
}

export async function createJob(
  projectId: string,
  kind: JobKind,
  items: { key: string; label: string }[],
  input?: unknown
) {
  const steps: JobStep[] = items.map((i) => ({ key: i.key, label: i.label, status: "queued" }));
  return prisma.job.create({
    data: {
      projectId,
      kind,
      total: items.length,
      steps: steps as never,
      input: (input ?? null) as never,
    },
  });
}

/**
 * Serialises writes from concurrent workers so step updates land in order —
 * the runner is the only writer, and it always writes its full in-memory copy.
 */
function createWriter(jobId: string) {
  let chain: Promise<unknown> = Promise.resolve();
  return (data: Record<string, unknown>) => {
    chain = chain
      .then(() =>
        prisma.job.update({ where: { id: jobId }, data: { ...data, heartbeatAt: new Date() } as never })
      )
      .catch((err) => console.error(`[jobs] write failed for ${jobId}:`, err));
    return chain;
  };
}

async function cancelRequested(jobId: string): Promise<boolean> {
  const row = await prisma.job.findUnique({ where: { id: jobId }, select: { cancelRequested: true } });
  return !!row?.cancelRequested;
}

class JobCancelled extends Error {}

/**
 * Run one worker per item with bounded concurrency, recording each item's
 * outcome as it happens. Items not yet started when a cancel lands are
 * marked cancelled; items already running finish.
 */
export async function runJobItems<T>(
  jobId: string,
  items: readonly T[],
  describe: (item: T, index: number) => { key: string; label: string },
  worker: (item: T, index: number) => Promise<{ id?: string } | void>,
  options: { concurrency?: number } = {}
) {
  const write = createWriter(jobId);
  const steps: JobStep[] = items.map((item, i) => ({ ...describe(item, i), status: "queued" }));
  let done = 0;
  let failed = 0;
  const ids: string[] = [];
  const failures: JobFailure[] = [];
  let cancelled = false;

  await write({ status: "running", startedAt: new Date(), steps, total: items.length });

  await pMapSettled(
    items,
    async (item, i) => {
      if (cancelled || (await cancelRequested(jobId))) {
        cancelled = true;
        steps[i] = { ...steps[i], status: "cancelled" };
        await write({ steps });
        throw new JobCancelled();
      }
      steps[i] = { ...steps[i], status: "running" };
      await write({ steps, currentStep: steps[i].label });
      try {
        const out = await worker(item, i);
        done += 1;
        if (out && out.id) ids.push(out.id);
        steps[i] = { ...steps[i], status: "done", resultId: out ? out.id : undefined };
      } catch (err) {
        failed += 1;
        const error = err instanceof Error ? err.message : String(err);
        failures.push({ key: steps[i].key, label: steps[i].label, error });
        steps[i] = { ...steps[i], status: "failed", error };
      }
      await write({ steps, done, failed });
    },
    { concurrency: options.concurrency ?? 4 }
  );

  const status: JobStatus = cancelled ? "cancelled" : done === 0 && failed > 0 ? "failed" : "completed";
  await write({
    status,
    done,
    failed,
    steps,
    currentStep: null,
    completedAt: new Date(),
    result: { ids, failures },
    error: status === "failed" ? failures[0]?.error ?? "Every item failed" : null,
  });
}

/** Mark a job failed from outside the item loop (setup errors, crashes). */
export async function failJob(jobId: string, err: unknown) {
  await prisma.job
    .update({
      where: { id: jobId },
      data: {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        completedAt: new Date(),
        currentStep: null,
      },
    })
    .catch(() => {});
}

/** Low-level progress write for jobs that are not a flat item list (analysis). */
export function jobWriter(jobId: string) {
  return createWriter(jobId);
}

export { JobCancelled, cancelRequested };

type JobRow = Awaited<ReturnType<typeof prisma.job.findFirst>> & object;

/** Average wall-clock seconds per item across recent finished jobs of a kind. */
async function historicalSecondsPerItem(projectId: string, kind: JobKind): Promise<number> {
  const recent = await prisma.job.findMany({
    where: { kind, status: "completed", startedAt: { not: null }, completedAt: { not: null }, done: { gt: 0 } },
    orderBy: { completedAt: "desc" },
    take: 10,
    select: { startedAt: true, completedAt: true, done: true, projectId: true },
  });
  // Prefer this project's history (same brand, similar prompt sizes).
  const own = recent.filter((r) => r.projectId === projectId);
  const sample = own.length >= 2 ? own : recent;
  if (sample.length === 0) return DEFAULT_SECONDS_PER_ITEM[kind];
  const rates = sample.map((r) => (r.completedAt!.getTime() - r.startedAt!.getTime()) / 1000 / r.done);
  return rates.reduce((a, b) => a + b, 0) / rates.length;
}

export interface JobView {
  id: string;
  kind: string;
  status: JobStatus;
  total: number;
  done: number;
  failed: number;
  percent: number;
  currentStep: string | null;
  steps: JobStep[];
  result: { ids: string[]; failures: JobFailure[]; partial?: boolean; remaining?: number | null } | null;
  error: string | null;
  etaSeconds: number | null;
  elapsedSeconds: number | null;
  createdAt: string;
  completedAt: string | null;
}

/**
 * The API/UI shape of a job, with stale detection and an ETA. Once a job has
 * finished at least one item its own observed rate is used; before that, the
 * historical average for the kind.
 */
export async function viewJob(job: JobRow): Promise<JobView> {
  let status = job.status as JobStatus;
  let error = job.error;
  const heartbeat = job.heartbeatAt ?? job.startedAt ?? job.createdAt;
  if (!TERMINAL.includes(status) && Date.now() - heartbeat.getTime() > STALE_MS) {
    status = "failed";
    error = "The server stopped before this finished — retry to pick up the remaining items.";
    await prisma.job
      .update({ where: { id: job.id }, data: { status, error, completedAt: new Date() } })
      .catch(() => {});
  }

  const settled = job.done + job.failed;
  const remaining = Math.max(0, job.total - settled);
  const elapsedSeconds = job.startedAt
    ? Math.round(((job.completedAt ?? new Date()).getTime() - job.startedAt.getTime()) / 1000)
    : null;

  let etaSeconds: number | null = null;
  if (!TERMINAL.includes(status) && remaining > 0) {
    const perItem =
      settled > 0 && elapsedSeconds
        ? elapsedSeconds / settled
        : await historicalSecondsPerItem(job.projectId, job.kind as JobKind);
    etaSeconds = Math.max(1, Math.round(perItem * remaining));
  }

  return {
    id: job.id,
    kind: job.kind,
    status,
    total: job.total,
    done: job.done,
    failed: job.failed,
    percent: job.total ? Math.round((settled / job.total) * 100) : 0,
    currentStep: job.currentStep,
    steps: (job.steps as unknown as JobStep[] | null) ?? [],
    result: (job.result as JobView["result"]) ?? null,
    error,
    etaSeconds,
    elapsedSeconds,
    createdAt: job.createdAt.toISOString(),
    completedAt: job.completedAt?.toISOString() ?? null,
  };
}

/** The latest job of a kind for a project, if it is still running. */
export async function findActiveJob(projectId: string, kind: JobKind) {
  const job = await prisma.job.findFirst({
    where: { projectId, kind, status: { in: ["queued", "running"] } },
    orderBy: { createdAt: "desc" },
  });
  if (!job) return null;
  const view = await viewJob(job);
  return TERMINAL.includes(view.status) ? null : view;
}
