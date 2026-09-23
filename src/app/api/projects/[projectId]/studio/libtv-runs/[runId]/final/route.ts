/** POST {final: boolean} — pick (or unpick) this run as its script's deliverable. */
import { NextResponse } from "next/server";
import { getRunWithJobs, setRunFinal } from "@/services/video-gen/libtv-queue";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string; runId: string }> }
) {
  const { projectId, runId } = await params;
  const existing = await getRunWithJobs(runId);
  if (!existing || existing.projectId !== projectId) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  const body = (await request.json().catch(() => ({}))) as { final?: unknown };
  if (typeof body.final !== "boolean") {
    return NextResponse.json({ error: "final must be a boolean" }, { status: 400 });
  }
  const result = await setRunFinal(runId, body.final);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ run: await getRunWithJobs(runId) });
}
