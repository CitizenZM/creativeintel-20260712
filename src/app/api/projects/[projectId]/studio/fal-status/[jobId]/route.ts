import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { stripEndpointMarker } from "@/services/video-gen/poll";
import { withAccess } from "@/lib/auth/route-guard";

export const maxDuration = 30;

async function unguardedGET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; jobId: string }> }
) {
  const { projectId, jobId } = await params;

  const job = await prisma.falVideoJob.findFirst({ where: { id: jobId, projectId } });
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  return NextResponse.json({ ...job, prompt: stripEndpointMarker(job.prompt) });
}

async function unguardedDELETE(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; jobId: string }> }
) {
  const { projectId, jobId } = await params;
  await prisma.falVideoJob.deleteMany({ where: { id: jobId, projectId } }).catch(() => {});
  return NextResponse.json({ ok: true });
}

export const GET = withAccess(unguardedGET);
export const DELETE = withAccess(unguardedDELETE);
