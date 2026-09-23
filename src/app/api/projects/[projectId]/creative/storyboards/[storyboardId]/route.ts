/**
 * Switch which storyboard version is active for its script, or archive one.
 */
import { NextResponse } from "next/server";
import { activateStoryboard, archiveStoryboard } from "@/services/creative-library";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ projectId: string; storyboardId: string }> }
) {
  const { projectId, storyboardId } = await params;
  const body = (await request.json().catch(() => ({}))) as { isActive?: unknown };
  if (body.isActive !== true) {
    return NextResponse.json({ error: "Only { isActive: true } is supported" }, { status: 400 });
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
