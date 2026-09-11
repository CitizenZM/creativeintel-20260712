import { NextResponse } from "next/server";
import { cancelRun, getRunWithJobs } from "@/services/video-gen/libtv-queue";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; runId: string }> }
) {
  const { projectId, runId } = await params;

  const existing = await getRunWithJobs(runId);
  if (!existing || existing.projectId !== projectId) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const run = await cancelRun(runId);
  if (!run) {
    return NextResponse.json(
      { error: `Run cannot be cancelled from status "${existing.status}"` },
      { status: 409 }
    );
  }
  return NextResponse.json({ run });
}
