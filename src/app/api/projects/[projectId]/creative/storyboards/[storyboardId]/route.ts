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
    const board = await prisma.storyboard.findFirst({
      where: { id: storyboardId, projectId, deletedAt: { not: null } },
      select: { scriptId: true },
    });
    if (!board) return NextResponse.json({ error: "No archived storyboard with that id" }, { status: 404 });
    // If its script has no live active version, the restored one takes that role.
    const activeSibling = board.scriptId
      ? await prisma.storyboard.count({
          where: { projectId, scriptId: board.scriptId, deletedAt: null, isActive: true },
        })
      : 0;
    await prisma.storyboard.update({
      where: { id: storyboardId },
      data: { deletedAt: null, isActive: activeSibling === 0 },
    });
    return NextResponse.json({ ok: true, isActive: activeSibling === 0 });
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
