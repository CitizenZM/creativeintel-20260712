/**
 * GET /api/projects/{projectId}/jobs?kind=scripts[&active=1]
 * The latest job of a kind (or only a still-running one with active=1), so a
 * page can resume its progress bar after a reload.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { findActiveJob, isJobKind, viewJob } from "@/services/jobs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  if (!isJobKind(kind)) {
    return NextResponse.json({ error: "kind must be angles, scripts, storyboards or analysis" }, { status: 400 });
  }

  if (url.searchParams.get("active") === "1") {
    return NextResponse.json({ job: await findActiveJob(projectId, kind) });
  }

  const job = await prisma.job.findFirst({ where: { projectId, kind }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ job: job ? await viewJob(job) : null });
}
