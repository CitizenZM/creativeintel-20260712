import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createRenderJob, runImport } from "@/services/video/runner";
import { withAccess } from "@/lib/auth/route-guard";

export const maxDuration = 60;

const bodySchema = z.object({
  url: z.string().url(),
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

  const jobId = await createRenderJob(projectId, "import", parsed.data);
  waitUntil(runImport(jobId, projectId, parsed.data));
  return NextResponse.json({ jobId, status: "running" }, { status: 202 });
}

export const POST = withAccess(unguardedPOST);
