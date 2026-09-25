import { NextResponse, after } from "next/server";
import { driveGlmRun } from "@/services/video-gen/glm-executor";
import { getRunWithJobs } from "@/services/video-gen/libtv-queue";

export const dynamic = "force-dynamic";

export const maxDuration = 90;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; runId: string }> }
) {
  const { projectId, runId } = await params;
  const run = await getRunWithJobs(runId);
  if (!run || run.projectId !== projectId) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  // Studio polls this while a run renders: keep a GLM run moving between cron
  // sweeps when nothing has touched it for a while.
  if (
    run.executor === "glm" &&
    ["approved", "claimed", "running"].includes(run.status) &&
    Date.now() - new Date(run.updatedAt).getTime() > 20_000
  ) {
    after(() => driveGlmRun(runId, 60_000).then(() => undefined));
  }
  return NextResponse.json({ run });
}
