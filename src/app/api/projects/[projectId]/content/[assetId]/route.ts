/**
 * Curate one collected ad: pin it (always analysed, shown first) or exclude
 * it (hidden, never analysed or used as evidence). Both are reversible.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ projectId: string; assetId: string }> }
) {
  const { projectId, assetId } = await params;
  const body = (await request.json().catch(() => ({}))) as { pinned?: unknown; excluded?: unknown };
  const data: { pinned?: boolean; excluded?: boolean } = {};
  if (typeof body.pinned === "boolean") data.pinned = body.pinned;
  if (typeof body.excluded === "boolean") data.excluded = body.excluded;
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Send pinned and/or excluded as booleans" }, { status: 400 });
  }
  // An excluded ad cannot also be pinned.
  if (data.excluded) data.pinned = false;

  const { count } = await prisma.contentAsset.updateMany({ where: { id: assetId, projectId }, data });
  if (!count) return NextResponse.json({ error: "Ad not found" }, { status: 404 });
  return NextResponse.json({ ok: true, ...data });
}
