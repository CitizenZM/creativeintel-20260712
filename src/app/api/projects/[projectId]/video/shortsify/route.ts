import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createRenderJob, runShortsify } from "@/services/video/runner";
import { withAccess } from "@/lib/auth/route-guard";

export const maxDuration = 60;

const bodySchema = z
  .object({
    videoReferenceId: z.string().optional(),
    sourceUrl: z.string().url().optional(),
    targetDurationSec: z.number().min(10).max(120).optional(),
    aspectRatio: z.enum(["9:16", "16:9", "1:1"]).optional(),
  })
  .refine((v) => v.videoReferenceId || v.sourceUrl, {
    message: "videoReferenceId or sourceUrl required",
  });

async function unguardedPOST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.format() }, { status: 400 });
  }

  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const jobId = await createRenderJob(projectId, "shortsify", parsed.data);
  waitUntil(runShortsify(jobId, projectId, parsed.data));
  return NextResponse.json({ jobId, status: "running" }, { status: 202 });
}

export const POST = withAccess(unguardedPOST);
