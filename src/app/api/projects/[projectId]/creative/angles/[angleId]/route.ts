/**
 * Pick (status) or archive one saved angle. Archived angles are hidden, never
 * hard-deleted, so a mistaken archive can be recovered from the database.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { LIVE, isSelectionStatus } from "@/services/creative-library";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ projectId: string; angleId: string }> }
) {
  const { projectId, angleId } = await params;
  const body = (await request.json().catch(() => ({}))) as { status?: unknown };
  if (!isSelectionStatus(body.status)) {
    return NextResponse.json({ error: "status must be draft or selected" }, { status: 400 });
  }

  const { count } = await prisma.angle.updateMany({
    where: { id: angleId, projectId, ...LIVE },
    data: { status: body.status },
  });
  if (!count) return NextResponse.json({ error: "Angle not found" }, { status: 404 });
  return NextResponse.json({ ok: true, status: body.status });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; angleId: string }> }
) {
  const { projectId, angleId } = await params;
  const { count } = await prisma.angle.updateMany({
    where: { id: angleId, projectId, ...LIVE },
    data: { deletedAt: new Date(), status: "draft" },
  });
  if (!count) return NextResponse.json({ error: "Angle not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
