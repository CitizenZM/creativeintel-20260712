import { prisma } from "@/lib/db";

export type JobStepStatus = "pending" | "running" | "complete" | "error";

export interface JobStep {
  name: string;
  status: JobStepStatus;
  progress: number;
  message?: string;
  startedAt?: string;
  completedAt?: string;
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

// A research POST route runs with maxDuration=60. If the waitUntil()
// background function is evicted mid-run (timeout, deploy, crash), the
// ResearchJob row sticks at status "running" forever — and because this
// function is what /api/projects/[id]/research checks before starting new
// work, an orphaned row silently blocks all future research on that project
// (the client's own stuck-status recovery in research/page.tsx calls this
// same route again, which just replies "already running" and does nothing).
// Self-heal here: treat a job unstarted for 10+ minutes as orphaned.
const STALE_MS = 10 * 60 * 1000;

export async function getActiveJobForProject(projectId: string) {
  const job = await prisma.researchJob.findFirst({
    where: { projectId, status: { in: ["pending", "running"] } },
    orderBy: { createdAt: "desc" },
  });

  if (job && job.startedAt && Date.now() - job.startedAt.getTime() > STALE_MS) {
    await prisma.researchJob.update({
      where: { id: job.id },
      data: { status: "error", error: "Job timed out or the server process was interrupted before it could finish." },
    });
    return null;
  }

  return job;
}

export async function getJob(jobId: string) {
  return prisma.researchJob.findUnique({ where: { id: jobId } });
}
