import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const TOP_TEARDOWNS_PER_COMPETITOR = Number(process.env.TOP_N_DEEP) || 5;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  const [insights, patterns, sellingPoints, rollups, teardowns] = await Promise.all([
    prisma.insight.findMany({
      where: { projectId },
      orderBy: { importance: "desc" },
      include: { competitor: { select: { id: true, name: true } } },
    }),
    prisma.narrativePattern.findMany({
      where: { projectId },
      orderBy: { avgPerformance: "desc" },
    }),
    prisma.sellingPoint.findMany({
      where: { projectId },
      orderBy: { strength: "desc" },
    }),
    prisma.competitorRollup.findMany({
      where: { projectId },
      include: { competitor: { select: { id: true, name: true, url: true } } },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.adTeardown.findMany({
      where: { projectId },
      orderBy: [{ rank: "asc" }, { updatedAt: "desc" }],
      include: {
        competitor: { select: { id: true, name: true } },
        contentAsset: {
          select: {
            id: true, title: true, url: true, thumbnailUrl: true, platform: true,
            adSource: true, isPaidMedia: true, durationSec: true, viewCount: true,
            overallScore: true, rankInOwner: true,
          },
        },
      },
    }),
  ]);

  const grouped = new Map<string, typeof insights>();
  for (const insight of insights) {
    const key = insight.competitorId ?? "general";
    const list = grouped.get(key) ?? [];
    list.push(insight);
    grouped.set(key, list);
  }

  const topPerOwner = new Map<string, typeof teardowns>();
  for (const t of teardowns) {
    const key = t.competitorId ?? "brand";
    const list = topPerOwner.get(key) ?? [];
    if (list.length < TOP_TEARDOWNS_PER_COMPETITOR) list.push(t);
    topPerOwner.set(key, list);
  }

  return NextResponse.json({
    insights: {
      general: grouped.get("general") ?? [],
      byCompetitor: Object.fromEntries(
        [...grouped.entries()].filter(([key]) => key !== "general")
      ),
    },
    rollups,
    teardowns: Object.fromEntries(topPerOwner.entries()),
    patterns,
    sellingPoints,
  });
}
