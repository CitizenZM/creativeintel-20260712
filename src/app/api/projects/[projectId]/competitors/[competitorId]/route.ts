import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const TOP_N = Number(process.env.TOP_N_DEEP) || 5;

/** Rename, fix the URL, or remove (exclude) a competitor. Removal is reversible. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ projectId: string; competitorId: string }> }
) {
  const { projectId, competitorId } = await params;
  const body = (await request.json().catch(() => ({}))) as { name?: unknown; url?: unknown; excluded?: unknown };
  const data: { name?: string; url?: string | null; excluded?: boolean } = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim().slice(0, 120);
  if (body.url === null || typeof body.url === "string") data.url = (body.url as string | null)?.trim() || null;
  if (typeof body.excluded === "boolean") data.excluded = body.excluded;
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const { count } = await prisma.competitor.updateMany({ where: { id: competitorId, projectId }, data });
  if (!count) return NextResponse.json({ error: "Competitor not found" }, { status: 404 });
  return NextResponse.json({ ok: true, ...data });
}

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
