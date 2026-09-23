import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  getActiveJobForProject,
  getJob,
  collectSources,
  nestSteps,
  type JobStep,
} from "@/services/research/job-progress";
import { getTaskStatusCounts } from "@/services/worker-tasks";

const DEFAULT_RESEARCH_SECONDS = 180;

/**
 * Seconds left on a running research job. Past ~10% the job's own pace is the
 * best predictor; before that, the average length of recent finished runs.
 */
async function estimateResearchEta(
  projectId: string,
  job: { status: string; progress: number; startedAt: Date | null; createdAt: Date }
): Promise<number | null> {
  if (job.status !== "running" && job.status !== "pending") return null;
  const elapsed = (Date.now() - (job.startedAt ?? job.createdAt).getTime()) / 1000;
  if (job.progress >= 10 && job.progress < 100) {
    return Math.max(5, Math.round((elapsed * (100 - job.progress)) / job.progress));
  }
  const recent = await prisma.researchJob.findMany({
    where: { status: "complete", completedAt: { not: null } },
    orderBy: { completedAt: "desc" },
    take: 10,
    select: { projectId: true, startedAt: true, createdAt: true, completedAt: true },
  });
  const own = recent.filter((r) => r.projectId === projectId);
  const sample = own.length >= 2 ? own : recent;
  const typical = sample.length
    ? sample.reduce((s, r) => s + (r.completedAt!.getTime() - (r.startedAt ?? r.createdAt).getTime()) / 1000, 0) /
      sample.length
    : DEFAULT_RESEARCH_SECONDS;
  return Math.max(10, Math.round(typical - elapsed));
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");

  const job =
    (jobId ? await getJob(jobId) : null) ??
    (await getActiveJobForProject(projectId)) ??
    (await prisma.researchJob.findFirst({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    }));

  if (!job) {
    return NextResponse.json({ status: "idle", sources: [] });
  }

  const rawSteps = (job.steps as unknown as JobStep[] | null) ?? [];
  const sources = collectSources(rawSteps);
  const workerCounts = await getTaskStatusCounts(projectId, "ad_library_fetch").catch(
    () => ({}) as Record<string, number>
  );

  return NextResponse.json({
    etaSeconds: await estimateResearchEta(projectId, job),
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    currentStep: job.currentStep,
    steps: nestSteps(rawSteps),
    sources,
    workerTasks: workerCounts,
    error: job.error,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
  });
}
