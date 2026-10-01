/**
 * GET — the structure this project's scripts follow (null = automatic).
 * PUT { structureId: string | null } — pick one from the library, or go back to automatic.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const sel = await prisma.campaignSelection.findUnique({ where: { projectId }, select: { structureId: true } });
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { category: true } });
  return NextResponse.json({ structureId: sel?.structureId ?? null, category: project?.category ?? null });
}

export async function PUT(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const body = (await req.json().catch(() => ({}))) as { structureId?: unknown };
  const structureId = typeof body.structureId === "string" && body.structureId ? body.structureId : null;
  if (structureId && !(await prisma.adStructure.findUnique({ where: { id: structureId }, select: { id: true } }))) {
    return NextResponse.json({ error: "Structure not found" }, { status: 404 });
  }
  await prisma.campaignSelection.upsert({
    where: { projectId },
    create: { projectId, structureId },
    update: { structureId },
  });
  return NextResponse.json({ ok: true, structureId });
}
