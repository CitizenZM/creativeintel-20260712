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
