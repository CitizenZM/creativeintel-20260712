import { NextResponse, after } from "next/server";
import { driveServerRun } from "@/services/video-gen/server-engines";
import { isServerEngine } from "@/services/video-gen/libtv-pricing";
import { getRunWithJobs } from "@/services/video-gen/libtv-queue";
import { STALE_ASSEMBLY_MS } from "@/services/video-gen/server-executor";

export const dynamic = "force-dynamic";

// A run whose clips are all done is assembled from here, which needs a full budget.
export const maxDuration = 300;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; runId: string }> }
) {
  const { projectId, runId } = await params;
  const run = await getRunWithJobs(runId);
  if (!run || run.projectId !== projectId) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  // Studio polls this while a run renders: keep a server-rendered (GLM /
  // ComfyUI) run moving between cron sweeps when nothing has touched it for a while.
  const idleMs = Date.now() - new Date(run.updatedAt).getTime();
  if (
    isServerEngine(run.executor) &&
    ((["approved", "claimed", "running"].includes(run.status) && idleMs > 20_000) ||
      (run.status === "assembling" && idleMs > STALE_ASSEMBLY_MS))
  ) {
    // Clips all done (or a stuck assembly): give this invocation room to assemble.
    const readyToAssemble = run.status === "assembling" || (run.jobs ?? []).every((j) => ["completed", "skipped", "failed"].includes(j.status));
    after(() => driveServerRun(run.executor, runId, readyToAssemble ? 280_000 : 60_000).then(() => undefined));
  }
  return NextResponse.json({ run });
}
