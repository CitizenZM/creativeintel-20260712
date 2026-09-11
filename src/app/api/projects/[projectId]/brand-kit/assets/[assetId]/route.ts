import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { refreshCompleteness } from "@/services/brand-kit";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ projectId: string; assetId: string }> }
) {
  const { projectId, assetId } = await params;

  const asset = await prisma.brandAsset.findUnique({
    where: { id: assetId },
    include: { brandKit: { select: { projectId: true } } },
  });

  if (!asset || asset.brandKit.projectId !== projectId) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }

  await prisma.brandAsset.delete({ where: { id: assetId } });
  const completeness = await refreshCompleteness(projectId);

  return NextResponse.json({ deleted: assetId, completeness });
}
