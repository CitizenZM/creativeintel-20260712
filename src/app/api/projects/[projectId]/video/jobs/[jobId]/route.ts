import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAccess } from "@/lib/auth/route-guard";

async function unguardedDELETE(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; jobId: string }> }
) {
  const { projectId, jobId } = await params;
  const job = await prisma.renderJob.findUnique({ where: { id: jobId } });
  if (!job || job.projectId !== projectId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Only allow deleting terminal jobs to avoid orphaning live work.
  if (job.status !== "complete" && job.status !== "error") {
    return NextResponse.json(
      { error: "Cannot delete a running job. Wait until it finishes." },
      { status: 409 }
    );
  }
  await prisma.renderJob.delete({ where: { id: jobId } });
  return NextResponse.json({ ok: true });
}

export const DELETE = withAccess(unguardedDELETE);
