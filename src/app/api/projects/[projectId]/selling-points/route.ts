/**
 * Add a selling point the analysis missed. It is saved as already sent to
 * script context — someone typing it in wants it used.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const body = (await request.json().catch(() => ({}))) as { point?: unknown; category?: unknown };
  const point = typeof body.point === "string" ? body.point.trim().slice(0, 300) : "";
  if (!point) return NextResponse.json({ error: "point is required" }, { status: 400 });
  const category =
    typeof body.category === "string" && body.category.trim() ? body.category.trim().slice(0, 40) : "user";

  const exists = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const sellingPoint = await prisma.sellingPoint.create({
    data: { projectId, point, category, strength: 70, selected: true, addedByUser: true },
  });
  return NextResponse.json({ sellingPoint }, { status: 201 });
}
