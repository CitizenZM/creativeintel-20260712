import { NextResponse } from "next/server";
import { getRunWithJobs } from "@/services/video-gen/libtv-queue";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; runId: string }> }
) {
  const { projectId, runId } = await params;
  const run = await getRunWithJobs(runId);
  if (!run || run.projectId !== projectId) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  return NextResponse.json({ run });
}
