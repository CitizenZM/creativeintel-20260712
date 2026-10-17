import { safePublicError } from "@/lib/public-error";
import { NextResponse } from "next/server";
import { getRunWithJobs } from "@/services/video-gen/libtv-queue";
import { withAccess } from "@/lib/auth/route-guard";

export const dynamic = "force-dynamic";

// A run whose clips are all done is assembled from here, which needs a full budget.
export const maxDuration = 300;

async function unguardedGET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; runId: string }> }
) {
  const { projectId, runId } = await params;
  const run = await getRunWithJobs(runId);
  if (!run || run.projectId !== projectId) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  return NextResponse.json({ run: { ...run, error: run.error ? safePublicError(run.error) : null, jobs: run.jobs.map((job) => ({ ...job, error: job.error ? safePublicError(job.error) : null })) } });
}

export const GET = withAccess(unguardedGET);
