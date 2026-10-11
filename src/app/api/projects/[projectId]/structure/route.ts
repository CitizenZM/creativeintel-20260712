/**
 * GET — the structure this project's scripts follow (null = automatic).
 * PUT { structureId: string | null } — pick one from the library, or go back to automatic.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { findStructureForProject } from "@/services/structures";
import { withAccess } from "@/lib/auth/route-guard";

export const dynamic = "force-dynamic";

async function unguardedGET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const sel = await prisma.campaignSelection.findUnique({ where: { projectId }, select: { structureId: true } });
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { category: true } });
  return NextResponse.json({ structureId: sel?.structureId ?? null, category: project?.category ?? null });
}

async function unguardedPUT(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const body = (await req.json().catch(() => ({}))) as { structureId?: unknown };
  const structureId = typeof body.structureId === "string" && body.structureId ? body.structureId : null;
  if (structureId && !(await findStructureForProject(projectId, structureId))) {
    return NextResponse.json({ error: "Structure not found" }, { status: 404 });
  }
  await prisma.campaignSelection.upsert({
    where: { projectId },
    create: { projectId, structureId },
    update: { structureId },
  });
  return NextResponse.json({ ok: true, structureId });
}

export const GET = withAccess(unguardedGET);
export const PUT = withAccess(unguardedPUT);
