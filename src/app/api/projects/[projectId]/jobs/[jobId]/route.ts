import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { viewJob } from "@/services/jobs";
import { withAccess } from "@/lib/auth/route-guard";

async function unguardedGET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; jobId: string }> }
) {
  const { projectId, jobId } = await params;
  const job = await prisma.job.findFirst({ where: { id: jobId, projectId } });
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  return NextResponse.json({ job: await viewJob(job) });
}

export const GET = withAccess(unguardedGET);
