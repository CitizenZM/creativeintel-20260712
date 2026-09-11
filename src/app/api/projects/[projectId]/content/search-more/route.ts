/**
 * "Load more" — runs the same adapter dispatch as the research runner so the
 * results honour the campaign platform. The old version was hardcoded to
 * YouTube TVC queries regardless of what the user picked (audit §1).
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { searchVerifiedVideos } from "@/services/research/video-search";
import { extractSearchKeywords, quickBrandUnderstanding } from "@/services/research/keyword-extractor";
import { getCampaignPlatform } from "@/lib/campaign-platform";
import { gateCandidates } from "@/services/research/ranking";
import { saveUnrankedCandidates } from "@/services/research/persist";

export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    offset?: number;
    competitorId?: string | null;
  };

  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { competitors: true },
    });
    if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const campaignSelection = await prisma.campaignSelection
      .findUnique({ where: { projectId }, select: { platform: true } })
      .catch(() => null);
    const campaign = getCampaignPlatform(campaignSelection?.platform);

    const owner = body.competitorId
      ? project.competitors.find((c) => c.id === body.competitorId)
      : null;
    const ownerName = owner?.name ?? project.brandName;

    const brandContext = await quickBrandUnderstanding(project.brandName, null);
    const keywords = await extractSearchKeywords(
      project.brandName,
      null,
      project.competitors.map((c) => c.name),
      undefined,
      brandContext
    );

    const { candidates, reports } = await searchVerifiedVideos(ownerName, keywords, {
      projectId,
      competitorId: owner?.id ?? null,
      productName: project.productPageTitle || project.productName || undefined,
      campaign,
      countries: ["US"],
      limit: 15,
    });

    const { passed } = gateCandidates(candidates, { campaign });

    const existing = await prisma.contentAsset.findMany({
      where: { projectId },
      select: { url: true },
    });
    const existingUrls = new Set(existing.map((a) => a.url));
    const fresh = passed.filter((c) => !existingUrls.has(c.permalink));

    if (fresh.length === 0) {
      return NextResponse.json({
        added: 0,
        message: "No new paid candidates found",
        sources: reports,
      });
    }

    const { saved } = await saveUnrankedCandidates(projectId, fresh);
    return NextResponse.json({ added: saved, sources: reports });
  } catch (err) {
    console.error("Search-more failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}
