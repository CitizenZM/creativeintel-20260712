import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { RenderJob } from "@/generated/prisma/client";

// RenderJob rows have no server-side recovery (no cron, no requeue) — if the
// waitUntil() background function running the job is evicted mid-render
// (function timeout, deploy, crash), the row is stuck at status "running"
// forever with nothing to flip it. Self-heal on read instead: any job still
// "running"/"pending" long past every route's maxDuration (max 300s) is
// almost certainly orphaned, so mark it errored on the next poll.
const STALE_MS = 10 * 60 * 1000; // generous margin over the 300s assemble maxDuration

async function healStale(job: RenderJob): Promise<RenderJob> {
  if (
    (job.status === "running" || job.status === "pending") &&
    job.startedAt &&
    Date.now() - job.startedAt.getTime() > STALE_MS
  ) {
    return prisma.renderJob.update({
      where: { id: job.id },
      data: { status: "error", error: "Job timed out or the server process was interrupted before it could finish." },
    });
  }
  return job;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");

  if (jobId) {
    const job = await prisma.renderJob.findUnique({ where: { id: jobId } });
    if (!job || job.projectId !== projectId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(await healStale(job));
  }

  const jobs = await prisma.renderJob.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const healed = await Promise.all(jobs.map(healStale));
  return NextResponse.json({ jobs: healed });
}
