import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      brand: true,
      competitors: {
        include: {
          _count: { select: { contentAssets: true } },
        },
      },
    },
  });

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Per-owner paid/ranked counts so the Content page can show how full each
  // competitor's Top-N actually is rather than a raw asset total.
  const grouped = await prisma.contentAsset.groupBy({
    by: ["competitorId"],
    where: { projectId, isPaidMedia: true },
    _count: { _all: true },
  });
  const rankedGrouped = await prisma.contentAsset.groupBy({
    by: ["competitorId"],
    where: { projectId, rankInOwner: { not: null } },
    _count: { _all: true },
  });

  const paidByOwner = new Map(grouped.map((g) => [g.competitorId ?? "brand", g._count._all]));
  const rankedByOwner = new Map(
    rankedGrouped.map((g) => [g.competitorId ?? "brand", g._count._all])
  );

  return NextResponse.json({
    brand: project.brand,
    brandPaidCount: paidByOwner.get("brand") ?? 0,
    brandRankedCount: rankedByOwner.get("brand") ?? 0,
    competitors: project.competitors.map((c) => ({
      ...c,
      paidCount: paidByOwner.get(c.id) ?? 0,
      rankedCount: rankedByOwner.get(c.id) ?? 0,
    })),
  });
}
