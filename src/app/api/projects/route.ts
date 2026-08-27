import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createProjectSchema } from "@/lib/validations";
import {
  upsertBrandProfile,
  upsertCompetitorProfile,
} from "@/services/brand-library";
import { getActiveWorkspace, projectWorkspaceFilter } from "@/services/workspace";
import { scrapeProductPage } from "@/services/research/product-page-scraper";

export const maxDuration = 30;

export async function GET() {
  const projects = await prisma.project.findMany({
    where: await projectWorkspaceFilter(),
    orderBy: { updatedAt: "desc" },
    include: {
      competitors: { select: { id: true, name: true, url: true } },
      _count: { select: { contentAssets: true, insights: true, scripts: true } },
    },
  });
  return NextResponse.json(projects);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = createProjectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.format() }, { status: 400 });
  }
  const data = parsed.data;

  try {
    const workspace = await getActiveWorkspace();
    const brandProfile = await upsertBrandProfile({
      workspaceId: workspace.id,
      name: data.brandName,
      url: data.brandUrl ?? null,
      category: data.category ?? null,
    });

    const competitorProfiles = await Promise.all(
      data.competitors.map((c) =>
        upsertCompetitorProfile({
          workspaceId: workspace.id,
          name: c.name,
          url: c.url ?? null,
        })
      )
    );

    // Scrape product page if URL provided — this is the primary product truth source
    let productPageTitle: string | undefined;
    let productPageImages: { url: string; alt: string }[] | undefined;
    let productPageText: string | undefined;

    if (data.productUrl) {
      try {
        const scraped = await scrapeProductPage(data.productUrl);
        productPageTitle = scraped.title || undefined;
        productPageImages = scraped.images;
        productPageText = [scraped.description, ...scraped.features].filter(Boolean).join("\n\n") || undefined;
      } catch (e) {
        console.warn("Product page scrape failed (non-blocking):", e);
      }
    }

    const project = await prisma.project.create({
      data: {
        name: data.productName
          ? `${data.productName} — ${data.brandName}`
          : `${data.brandName} Analysis`,
        brandName: data.brandName,
        brandUrl: data.brandUrl || null,
        category: data.category || null,
        campaignGoal: data.campaignGoal || null,
        briefingText: data.briefingText || null,
        productUrl: data.productUrl || null,
        productName: data.productName || productPageTitle || null,
        productPageTitle: productPageTitle || null,
        productPageImages: productPageImages as never ?? null,
        productPageText: productPageText || null,
        workspaceId: workspace.id,
        brandProfileId: brandProfile.id,
        brand: {
          create: {
            name: data.brandName,
            url: data.brandUrl || null,
            brandProfileId: brandProfile.id,
            // Pre-populate product intelligence from scraped data
            productDescription: productPageText?.slice(0, 2000) || null,
          },
        },
        competitors: {
          create: data.competitors.map((c, i) => ({
            name: c.name,
            url: c.url || null,
            competitorProfileId: competitorProfiles[i].id,
          })),
        },
      },
      include: {
        brand: true,
        competitors: true,
      },
    });

    return NextResponse.json(project, { status: 201 });
  } catch (err) {
    console.error("Failed to create project:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
