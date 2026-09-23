/**
 * Ask a running job to stop. Items already in flight finish (their model call
 * is paid for); items not yet started are skipped.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; jobId: string }> }
) {
  const { projectId, jobId } = await params;
  const { count } = await prisma.job.updateMany({
    where: { id: jobId, projectId, status: { in: ["queued", "running"] } },
    data: { cancelRequested: true },
  });
  if (!count) return NextResponse.json({ error: "No running job with that id" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
