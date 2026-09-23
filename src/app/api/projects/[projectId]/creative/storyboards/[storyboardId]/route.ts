/**
 * Switch which storyboard version is active for its script, or archive one.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { activateStoryboard, archiveStoryboard } from "@/services/creative-library";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ projectId: string; storyboardId: string }> }
) {
  const { projectId, storyboardId } = await params;
  const body = (await request.json().catch(() => ({}))) as { isActive?: unknown; restore?: unknown };
  if (body.restore === true) {
    const { count } = await prisma.storyboard.updateMany({
      where: { id: storyboardId, projectId, deletedAt: { not: null } },
      data: { deletedAt: null },
    });
    if (!count) return NextResponse.json({ error: "No archived storyboard with that id" }, { status: 404 });
    return NextResponse.json({ ok: true });
  }
  if (body.isActive !== true) {
    return NextResponse.json({ error: "Send { isActive: true } or { restore: true }" }, { status: 400 });
  }
  const board = await activateStoryboard(projectId, storyboardId);
  if (!board) return NextResponse.json({ error: "Storyboard not found" }, { status: 404 });
  return NextResponse.json({ ok: true, storyboard: board });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; storyboardId: string }> }
) {
  const { projectId, storyboardId } = await params;
  const board = await archiveStoryboard(projectId, storyboardId);
  if (!board) return NextResponse.json({ error: "Storyboard not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
