import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const TOP_N = Number(process.env.TOP_N_DEEP) || 5;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; competitorId: string }> }
) {
  const { projectId, competitorId } = await params;

  const competitor = await prisma.competitor.findUnique({
    where: { id: competitorId },
    include: {
      rollup: true,
      insights: { orderBy: { importance: "desc" } },
    },
  });

  if (!competitor || competitor.projectId !== projectId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const assets = await prisma.contentAsset.findMany({
    where: { projectId, competitorId },
    orderBy: [{ rankInOwner: "asc" }, { overallScore: "desc" }],
    take: TOP_N,
    include: { teardown: true },
  });

  return NextResponse.json({
    competitor: {
      id: competitor.id,
      name: competitor.name,
      url: competitor.url,
      brandPromise: competitor.brandPromise,
      valueProposition: competitor.valueProposition,
      toneOfVoice: competitor.toneOfVoice,
      pricingTheme: competitor.pricingTheme,
      productFeatures: competitor.productFeatures,
      ctaLanguage: competitor.ctaLanguage,
      strengths: competitor.strengths,
      weaknesses: competitor.weaknesses,
    },
    rollup: competitor.rollup,
    insights: competitor.insights,
    assets,
  });
}
