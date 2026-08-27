import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createRenderJob, runGenerate } from "@/services/video/runner";

export const maxDuration = 60;

const bodySchema = z
  .object({
    scriptId: z.string().optional(),
    script: z.string().optional(),
    aspectRatio: z.enum(["9:16", "16:9", "1:1"]).optional(),
  })
  .refine((v) => v.scriptId || v.script, {
    message: "scriptId or script required",
  });

export async function POST(
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

  // runGenerate ultimately shells out to a local MoneyPrinterTurbo checkout via
  // MONEYPRINTER_PATH — this cannot exist on Vercel's serverless filesystem.
  // Fail fast here instead of creating a job that's guaranteed to error a few
  // seconds later once runGenerate actually reaches generateProductVideo().
  if (!process.env.MONEYPRINTER_PATH) {
    return NextResponse.json(
      {
        error:
          "Product video generation is not configured on this deployment (MONEYPRINTER_PATH is unset). This feature requires a companion worker with a local MoneyPrinterTurbo checkout.",
      },
      { status: 503 }
    );
  }

  const jobId = await createRenderJob(projectId, "generate", parsed.data);
  waitUntil(runGenerate(jobId, projectId, parsed.data));
  return NextResponse.json({ jobId, status: "running" }, { status: 202 });
}
