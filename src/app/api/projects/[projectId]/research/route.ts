import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/db";
import { withIdempotency, purgeExpiredIdempotencyKeys } from "@/lib/idempotency";
import {
  createJob,
  getActiveJobForProject,
} from "@/services/research/job-progress";
import { runResearch, STEP_NAMES } from "@/services/research/runner";

export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  const idem = await withIdempotency<unknown>(request, {
    route: "POST /research",
    projectId,
  });
  if (idem.replay && idem.response) return idem.response;

  // No cron sweeps idempotencyKey rows anywhere — piggyback a best-effort purge
  // here since this is the only route that writes to the table. Fire-and-forget:
  // failure here must never block starting research.
  waitUntil(purgeExpiredIdempotencyKeys().catch(() => {}));

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const existing = await getActiveJobForProject(projectId);
  if (existing) {
    const body = {
      jobId: existing.id,
      status: existing.status,
      message: "Research already running",
    };
    await idem.commit?.(body, 200);
    return NextResponse.json(body);
  }

  await prisma.project.update({
    where: { id: projectId },
    data: { status: "RESEARCHING" },
  });

  const jobId = await createJob(projectId, [...STEP_NAMES]);

  // Background execution — function may return before runResearch resolves.
  waitUntil(runResearch(projectId, jobId));

  const body = { jobId, status: "running" as const };
  await idem.commit?.(body, 202);
  return NextResponse.json(body, { status: 202 });
}
