/**
 * POST {shotIndexes: number[]} — re-render those scenes as a new run version.
 * Only the chosen scenes are queued (and paid for) again; the new run waits
 * for approval with its own credit estimate.
 */
import { NextResponse } from "next/server";
import { cloneRunForRerender, getRunWithJobs } from "@/services/video-gen/libtv-queue";

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
  const body = (await request.json().catch(() => ({}))) as { shotIndexes?: unknown };
  const shots = Array.isArray(body.shotIndexes)
    ? body.shotIndexes.filter((n): n is number => Number.isInteger(n) && (n as number) >= 0)
    : [];
  const result = await cloneRunForRerender(runId, shots);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ run: result.run }, { status: 201 });
}
