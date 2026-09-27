import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { buildManualScript } from "@/lib/manual-script";

const bodySchema = z.object({
  title: z.string().trim().min(1).max(120),
  hook: z.string().trim().min(1).max(300),
  lines: z.array(z.string().trim().max(400)).min(1).max(10),
  cta: z.string().trim().min(1).max(160),
  totalDurationSec: z.number().int().min(10).max(90).default(30),
});

/** A hand-written script (Plan B) — no AI call, stored in the generated shape. */
export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid script" }, { status: 400 });
  }
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const s = buildManualScript(parsed.data);
  const script = await prisma.script.create({
    data: {
      projectId,
      title: s.title,
      angle: "Written by hand",
      format: "MANUAL",
      duration: `${s.totalDurationSec}s`,
      totalDurationSec: s.totalDurationSec,
      template: s.template,
      hook: s.hook as never,
      bodyBeats: s.bodyBeats as never,
      cta: s.cta as never,
      hookVariants: [s.hook.text ?? ""],
      body: s.body,
      ctaVariants: [s.cta.text ?? ""],
    },
  });
  return NextResponse.json(script, { status: 201 });
}
