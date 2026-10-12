import { prisma } from "@/lib/db";
import { patchResearchJob } from "@/services/row-patch";

export type JobStepStatus = "pending" | "running" | "complete" | "error";

/** Per-adapter outcome, so the UI can say which sources ran, were skipped for a
 * missing key, failed, or are waiting on the local browser worker. */
export interface JobSourceStatus {
  name: string;
  status: "ran" | "skipped_no_key" | "failed" | "pending_worker" | "blocked";
  count: number;
  note?: string;
}

export interface JobStep {
  name: string;
  status: JobStepStatus;
  progress: number;
  message?: string;
  startedAt?: string;
  completedAt?: string;
  sources?: JobSourceStatus[];
  /** Nested sub-stage entries (e.g. "AI analysis · Brand analysis"), attached
   * under their parent by `nestSteps` for display — never persisted this way. */
  subSteps?: JobStep[];
}

const FLUSH_MS = 1000;
const debounceTimers = new Map<string, NodeJS.Timeout>();
const pendingWrites = new Map<string, () => Promise<void>>();

async function flush(jobId: string) {
  const writer = pendingWrites.get(jobId);
  pendingWrites.delete(jobId);
  debounceTimers.delete(jobId);
  if (writer) await writer().catch(() => {});
}

function scheduleWrite(jobId: string, writer: () => Promise<void>) {
  pendingWrites.set(jobId, writer);
  if (debounceTimers.has(jobId)) return;
  debounceTimers.set(
    jobId,
    setTimeout(() => {
      flush(jobId);
    }, FLUSH_MS)
  );
}

export async function createJob(
  projectId: string,
  stepNames: string[]
): Promise<string> {
  const steps: JobStep[] = stepNames.map((name) => ({
    name,
    status: "pending",
    progress: 0,
  }));
  const row = await prisma.researchJob.create({
    data: {
      projectId,
      status: "running",
      progress: 0,
      startedAt: new Date(),
      steps: steps as never,
    },
  });
  return row.id;
}

// Every steps writer below is a conflict-safe read-modify-write (patchResearchJob: the mutation is applied
// to the CURRENT steps and written only if nobody wrote the job meanwhile, retried otherwise) — per-owner
// tasks run in parallel and would otherwise overwrite each other's step / source updates.
//
// startStep/completeStep/failStep mark step-status transitions and must never
// be lost. They write immediately (read-modify-write against the live row)
// rather than going through scheduleWrite's debounce: scheduleWrite keeps
// only the single latest pending writer per jobId, so a status transition
// queued here would be silently discarded the moment the *next* step's call
// (startStep/updateStep/completeStep, for any step name) reached the same
// job before the 1s flush timer fired — exactly how "Crawl websites" could
// stay "pending" forever even after the job completed. Only the frequent,
// non-authoritative progress ticks from updateStep are still debounced.
export async function startStep(jobId: string, name: string) {
  await flush(jobId);
  await patchResearchJob(jobId, (row) => {
    const steps = (row.steps as unknown as JobStep[] | null) ?? [];
    const next = steps.map((s) =>
      s.name === name
        ? { ...s, status: "running" as const, startedAt: new Date().toISOString() }
        : s
    );
    return { steps: next as never, currentStep: name };
  });
}

export async function updateStep(
  jobId: string,
  name: string,
  progress: number,
  message?: string
) {
  scheduleWrite(jobId, async () => {
    await patchResearchJob(jobId, (row) => {
      const steps = (row.steps as unknown as JobStep[] | null) ?? [];
      const next = steps.map((s) =>
        s.name === name ? { ...s, progress, ...(message ? { message } : {}) } : s
      );
      const completed = next.filter((s) => s.status === "complete").length;
      const total = next.length || 1;
      const cur = next.find((s) => s.name === name)?.progress ?? 0;
      const overall = Math.round(((completed + cur / 100) / total) * 100);
      return { steps: next as never, progress: overall, currentStep: name };
    });
  });
}

/** Merge adapter outcomes into a step, de-duplicating by source name. */
export async function recordStepSources(
  jobId: string,
  name: string,
  sources: JobSourceStatus[]
) {
  if (sources.length === 0) return;
  // Written directly (not debounced): scheduleWrite keeps only the latest
  // pending writer per job, so a queued updateStep would drop these.
  await flush(jobId);
  await patchResearchJob(jobId, (row) => {
    const steps = (row.steps as unknown as JobStep[] | null) ?? [];
    const next = steps.map((s) => {
      if (s.name !== name) return s;
      const merged = new Map<string, JobSourceStatus>();
      for (const prev of s.sources ?? []) merged.set(prev.name, prev);
      for (const cur of sources) {
        const prev = merged.get(cur.name);
        merged.set(
          cur.name,
          prev
            ? {
                ...cur,
                count: prev.count + cur.count,
                // A single success is enough to call the source "ran".
                status: prev.status === "ran" ? "ran" : cur.status,
              }
            : cur
        );
      }
      return { ...s, sources: [...merged.values()] };
    });
    return { steps: next as never };
  });
}

/** Flatten every step's source outcomes for GET /research/status. */
export function collectSources(steps: JobStep[] | null | undefined): JobSourceStatus[] {
  const merged = new Map<string, JobSourceStatus>();
  for (const step of steps ?? []) {
    for (const s of step.sources ?? []) {
      const prev = merged.get(s.name);
      merged.set(
        s.name,
        prev ? { ...s, count: prev.count + s.count } : s
      );
    }
  }
  return [...merged.values()];
}

export async function completeStep(jobId: string, name: string) {
  await flush(jobId);
  await patchResearchJob(jobId, (row) => {
    const steps = (row.steps as unknown as JobStep[] | null) ?? [];
    const next = steps.map((s) =>
      s.name === name
        ? {
            ...s,
            status: "complete" as const,
            progress: 100,
            completedAt: new Date().toISOString(),
          }
        : s
    );
    const completed = next.filter((s) => s.status === "complete").length;
    const overall = Math.round((completed / (next.length || 1)) * 100);
    return { steps: next as never, progress: overall };
  });
}

export async function failStep(jobId: string, name: string, error: string) {
  await flush(jobId);
  await patchResearchJob(jobId, (row) => {
    const steps = (row.steps as unknown as JobStep[] | null) ?? [];
    const next = steps.map((s) =>
      s.name === name
        ? {
            ...s,
            status: "error" as const,
            message: error,
            completedAt: new Date().toISOString(),
          }
        : s
    );
    return { steps: next as never, error };
  });
}

/** Any step (including AI-analysis sub-stages) still pending/running when the
 * job ends never got its own terminal transition — finalize it here so the
 * status API never reports a "pending"/"running" step next to a finished job. */
function finalizeDanglingSteps(
  steps: JobStep[],
  terminal: "complete" | "error",
  error?: string
): JobStep[] {
  const completedAt = new Date().toISOString();
  return steps.map((s) =>
    s.status === "pending" || s.status === "running"
      ? {
          ...s,
          status: terminal,
          progress: terminal === "complete" ? 100 : s.progress,
          ...(terminal === "error" && error ? { message: error } : {}),
          completedAt: s.completedAt ?? completedAt,
        }
      : s
  );
}

export async function completeJob(jobId: string) {
  await flush(jobId);
  await patchResearchJob(jobId, (row) => {
    const steps = (row.steps as unknown as JobStep[] | null) ?? [];
    const next = finalizeDanglingSteps(steps, "complete");
    return { steps: next as never, status: "complete", progress: 100, completedAt: new Date() };
  });
}

export async function failJob(jobId: string, error: string) {
  await flush(jobId);
  await patchResearchJob(jobId, (row) => {
    const steps = (row.steps as unknown as JobStep[] | null) ?? [];
    const next = finalizeDanglingSteps(steps, "error", error);
    return { steps: next as never, status: "error", error, completedAt: new Date() };
  });
}

/** Group flat "Parent · Child" sub-stage entries (written by the AI analysis
 * pipeline as separate array elements) under their parent step for display,
 * without changing what's persisted to the DB. Orphaned sub-steps (no
 * matching parent name) are kept visible at the top level. */
export function nestSteps(steps: JobStep[]): JobStep[] {
  const top: JobStep[] = [];
  const bySimpleName = new Map<string, JobStep>();

  for (const s of steps) {
    if (s.name.includes(" · ")) continue;
    const clone: JobStep = { ...s };
    bySimpleName.set(s.name, clone);
    top.push(clone);
  }

  for (const s of steps) {
    const sepIdx = s.name.indexOf(" · ");
    if (sepIdx === -1) continue;
    const parentName = s.name.slice(0, sepIdx);
    const parent = bySimpleName.get(parentName);
    if (parent) {
      parent.subSteps = [...(parent.subSteps ?? []), s];
    } else {
      top.push(s);
    }
  }

  return top;
}

/**
 * A run executes inside one serverless invocation, which Vercel caps at
 * maxDuration (300s). Anything still "running" well past that had its function
 * killed and will never progress — but it kept satisfying
 * getActiveJobForProject, so every subsequent "Re-run research" silently
 * attached to the corpse and sat at 0% forever. Bury them first.
 */
const JOB_STALE_AFTER_MS = 6 * 60 * 1000;

export async function failStaleJobs(projectId: string) {
  // The project's own status has to come back with the job, or it sits on
  // RESEARCHING forever — 11 of 27 projects were stuck that way.
  const { count } = await prisma.researchJob.updateMany({
    where: {
      projectId,
      status: { in: ["pending", "running"] },
      createdAt: { lt: new Date(Date.now() - JOB_STALE_AFTER_MS) },
    },
    data: {
      status: "error",
      error: "Run stopped before it finished (server time limit). Start a new run.",
      completedAt: new Date(),
    },
  });

  if (count > 0) {
    const assets = await prisma.contentAsset.count({ where: { projectId } });
    await prisma.project
      .updateMany({
        where: { id: projectId, status: "RESEARCHING" },
        // Keep whatever was collected — a partial run is still usable.
        data: { status: assets > 0 ? "ANALYZED" : "ERROR" },
      })
      .catch(() => null);
  }
  return count;
}

export async function getActiveJobForProject(projectId: string) {
  await failStaleJobs(projectId).catch(() => 0);
  return prisma.researchJob.findFirst({
    where: { projectId, status: { in: ["pending", "running"] } },
    orderBy: { createdAt: "desc" },
  });
}

export async function getJob(jobId: string) {
  return prisma.researchJob.findUnique({ where: { id: jobId } });
}
