import { prisma } from "@/lib/db";

export type JobStepStatus = "pending" | "running" | "complete" | "error";

/** Per-adapter outcome, so the UI can say which sources ran, were skipped for a
 * missing key, failed, or are waiting on the local browser worker. */
export interface JobSourceStatus {
  name: string;
  status: "ran" | "skipped_no_key" | "failed" | "pending_worker";
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

export async function startStep(jobId: string, name: string) {
  scheduleWrite(jobId, async () => {
    const row = await prisma.researchJob.findUnique({ where: { id: jobId } });
    if (!row) return;
    const steps = (row.steps as unknown as JobStep[] | null) ?? [];
    const next = steps.map((s) =>
      s.name === name
        ? { ...s, status: "running" as const, startedAt: new Date().toISOString() }
        : s
    );
    await prisma.researchJob.update({
      where: { id: jobId },
      data: { steps: next as never, currentStep: name },
    });
  });
}

export async function updateStep(
  jobId: string,
  name: string,
  progress: number,
  message?: string
) {
  scheduleWrite(jobId, async () => {
    const row = await prisma.researchJob.findUnique({ where: { id: jobId } });
    if (!row) return;
    const steps = (row.steps as unknown as JobStep[] | null) ?? [];
    const next = steps.map((s) =>
      s.name === name ? { ...s, progress, ...(message ? { message } : {}) } : s
    );
    const completed = next.filter((s) => s.status === "complete").length;
    const total = next.length || 1;
    const cur = next.find((s) => s.name === name)?.progress ?? 0;
    const overall = Math.round(((completed + cur / 100) / total) * 100);
    await prisma.researchJob.update({
      where: { id: jobId },
      data: { steps: next as never, progress: overall, currentStep: name },
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
  {
    const row = await prisma.researchJob.findUnique({ where: { id: jobId } });
    if (!row) return;
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
    await prisma.researchJob.update({
      where: { id: jobId },
      data: { steps: next as never },
    });
  }
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
  scheduleWrite(jobId, async () => {
    const row = await prisma.researchJob.findUnique({ where: { id: jobId } });
    if (!row) return;
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
    await prisma.researchJob.update({
      where: { id: jobId },
      data: { steps: next as never, progress: overall },
    });
  });
}

export async function failStep(jobId: string, name: string, error: string) {
  await flush(jobId);
  const row = await prisma.researchJob.findUnique({ where: { id: jobId } });
  if (!row) return;
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
  await prisma.researchJob.update({
    where: { id: jobId },
    data: { steps: next as never, error },
  });
}

export async function completeJob(jobId: string) {
  await flush(jobId);
  await prisma.researchJob.update({
    where: { id: jobId },
    data: { status: "complete", progress: 100, completedAt: new Date() },
  });
}

export async function failJob(jobId: string, error: string) {
  await flush(jobId);
  await prisma.researchJob.update({
    where: { id: jobId },
    data: { status: "error", error, completedAt: new Date() },
  });
}

export async function getActiveJobForProject(projectId: string) {
  return prisma.researchJob.findFirst({
    where: { projectId, status: { in: ["pending", "running"] } },
    orderBy: { createdAt: "desc" },
  });
}

export async function getJob(jobId: string) {
  return prisma.researchJob.findUnique({ where: { id: jobId } });
}
