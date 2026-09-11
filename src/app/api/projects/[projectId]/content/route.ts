import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const url = new URL(request.url);

  // Allowlist query params — they flow into Prisma orderBy/where, so raw values
  // would let a malformed query trigger a PrismaClientValidationError (500).
  const SORTABLE = new Set([
    "overallScore",
    "viewCount",
    "likeCount",
    "commentCount",
    "publishedAt",
    "createdAt",
    "rankInOwner",
  ]);
  const CONTENT_TYPES = new Set([
    "YOUTUBE_VIDEO",
    "YOUTUBE_SHORT",
    "TIKTOK_VIDEO",
    "VIMEO_VIDEO",
    "WEBSITE_PAGE",
    "SOCIAL_POST",
    "WEB_MENTION",
    "REVIEW",
    "META_AD",
    "TIKTOK_AD",
    "GOOGLE_AD",
    "INSTAGRAM_REEL",
  ]);

  const typeParam = url.searchParams.get("type");
  const sortByParam = url.searchParams.get("sortBy") || "overallScore";
  const orderParam = url.searchParams.get("order") || "desc";
  // Paid-only is the default view; ?paid=all opts out.
  const paidParam = url.searchParams.get("paid") || "paid";
  const competitorParam = url.searchParams.get("competitorId");
  const rankedOnly = url.searchParams.get("ranked") === "1";

  const sortBy = SORTABLE.has(sortByParam) ? sortByParam : "overallScore";
  const order = orderParam === "asc" ? "asc" : "desc";

  const where: Record<string, unknown> = { projectId };
  if (typeParam && CONTENT_TYPES.has(typeParam)) where.type = typeParam;
  if (paidParam !== "all") where.isPaidMedia = true;
  if (competitorParam) {
    where.competitorId = competitorParam === "brand" ? null : competitorParam;
  }
  if (rankedOnly) where.rankInOwner = { not: null };

  const assets = await prisma.contentAsset.findMany({
    where,
    orderBy: [{ [sortBy]: order }],
    include: {
      competitor: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(assets);
}
