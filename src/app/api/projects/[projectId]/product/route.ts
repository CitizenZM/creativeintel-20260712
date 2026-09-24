/**
 * Product definition API
 * GET   — current product definition (url, name, images, description)
 * POST  — scrape a product URL and save results as the canonical product source
 * PATCH — mode "preview" scrapes without writing, mode "commit" scrapes and
 *         writes, no mode updates the supplied fields only
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { scrapeProductPageDetailed } from "@/services/research/product-page-scraper";
import type { ProductPageData, ScrapeOutcome } from "@/services/research/product-page-scraper";

export const maxDuration = 30;

const PROJECT_SELECT = {
  productUrl: true,
  productName: true,
  productPageTitle: true,
  productPageImages: true,
  productPageText: true,
  userProductImages: true,
  productConfirmedAt: true,
} as const;

function toScrapeResult(outcome: ScrapeOutcome) {
  return {
    ok: !!outcome.data,
    adapter: outcome.adapter,
    error: outcome.error ?? null,
    attempts: outcome.attempts,
    imageCount: outcome.data?.images.length ?? 0,
    title: outcome.data?.title ?? null,
    hasDescription: !!outcome.data?.description,
    featureCount: outcome.data?.features.length ?? 0,
  };
}

/**
 * `confirmed` is true only when a person saw the scraped result first (the
 * preview -> commit flow); a scrape run straight from project creation is
 * saved unconfirmed so Setup asks someone to check it.
 */
async function commitScrape(projectId: string, productUrl: string, scraped: ProductPageData, confirmed: boolean) {
  const project = await prisma.project.update({
    where: { id: projectId },
    data: {
      productConfirmedAt: confirmed ? new Date() : null,
      productUrl,
      productPageTitle: scraped.title,
      productPageImages: scraped.images as never,
      productPageText: [scraped.description, ...scraped.features].filter(Boolean).join("\n\n"),
      productName: scraped.title || undefined,
    },
    select: PROJECT_SELECT,
  });

  await prisma.brand.updateMany({
    where: { projectId },
    data: {
      productCategory: scraped.brand ? `${scraped.brand} — from product page` : undefined,
      productDescription: scraped.description || undefined,
      productVerified: false,
    },
  });

  return project;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: PROJECT_SELECT,
  });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(project);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const body = await req.json().catch(() => ({}));
  const { productUrl } = body as { productUrl?: string };

  if (!productUrl) return NextResponse.json({ error: "productUrl required" }, { status: 400 });

  const outcome = await scrapeProductPageDetailed(productUrl);
  const scrapeResult = toScrapeResult(outcome);

  if (!outcome.data) {
    return NextResponse.json(
      { error: outcome.error || "Failed to read product page", scrapeResult },
      { status: 422 }
    );
  }

  const project = await commitScrape(projectId, productUrl, outcome.data, false);

  return NextResponse.json({
    ...project,
    scrapeResult,
    imageCount: scrapeResult.imageCount,
    hasDescription: scrapeResult.hasDescription,
    featureCount: scrapeResult.featureCount,
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const body = await req.json().catch(() => ({}));
  const mode = (body as { mode?: string }).mode;

  if (mode === "preview" || mode === "commit") {
    const productUrl = (body as { productUrl?: string }).productUrl;
    if (!productUrl) return NextResponse.json({ error: "productUrl required" }, { status: 400 });

    const outcome = await scrapeProductPageDetailed(productUrl);
    const scrapeResult = toScrapeResult(outcome);

    if (!outcome.data) {
      return NextResponse.json(
        { mode, error: outcome.error || "Failed to read product page", scrapeResult },
        { status: 422 }
      );
    }

    if (mode === "preview") {
      return NextResponse.json({
        mode,
        scrapeResult,
        preview: {
          productUrl,
          title: outcome.data.title,
          description: outcome.data.description,
          features: outcome.data.features,
          images: outcome.data.images,
          price: outcome.data.price ?? null,
          brand: outcome.data.brand ?? null,
        },
      });
    }

    const project = await commitScrape(projectId, productUrl, outcome.data, true);
    return NextResponse.json({ mode, scrapeResult, ...project });
  }

  if ((body as { confirm?: unknown }).confirm === true) {
    const project = await prisma.project.update({
      where: { id: projectId },
      data: { productConfirmedAt: new Date() },
      select: PROJECT_SELECT,
    });
    return NextResponse.json(project);
  }

  const allowed = ["productUrl", "productName", "productPageText", "userProductImages", "productPageImages"];
  const data: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) data[key] = body[key];
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No updatable fields provided" }, { status: 400 });
  }

  // Details typed or edited by a person are confirmed by definition.
  const project = await prisma.project.update({
    where: { id: projectId },
    data: { ...data, productConfirmedAt: new Date() },
    select: PROJECT_SELECT,
  });

  return NextResponse.json(project);
}
