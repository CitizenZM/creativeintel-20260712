import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createProjectSchema } from "@/lib/validations";
import {
  upsertBrandProfile,
  upsertCompetitorProfile,
} from "@/services/brand-library";
import { getActiveWorkspace, projectWorkspaceFilter } from "@/services/workspace";
import {
  scrapeProductPageDetailed,
  type AdapterAttempt,
} from "@/services/research/product-page-scraper";
import { refreshCompleteness } from "@/services/brand-kit";

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
  try {
    const body = await request.json().catch(() => ({}));
    const data = createProjectSchema.parse(body);

    const workspace = await getActiveWorkspace();

    // 27 projects had accumulated with the same brands created several times
    // over. Same brand + same site in this workspace is almost always a
    // re-run, not a second campaign — say so instead of silently forking.
    const host = (() => {
      try { return data.brandUrl ? new URL(data.brandUrl).host.replace(/^www\./, "") : null; }
      catch { return null; }
    })();
    const duplicate = await prisma.project.findFirst({
      where: {
        workspaceId: workspace.id,
        OR: [
          { brandName: { equals: data.brandName.trim(), mode: "insensitive" } },
          ...(host ? [{ brandUrl: { contains: host, mode: "insensitive" as const } }] : []),
        ],
      },
      select: { id: true, brandName: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    if (duplicate && body.allowDuplicate !== true) {
      return NextResponse.json(
        {
          error: `You already have a project for ${duplicate.brandName}. Open it, or resubmit with allowDuplicate to create a second one.`,
          duplicateProjectId: duplicate.id,
        },
        { status: 409 }
      );
    }
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

    // Scrape product page if URL provided — this is the primary product truth
    // source. Failures never block creation, but they are always reported back.
    let productPageTitle: string | undefined;
    let productPageImages: { url: string; alt: string }[] | undefined;
    let productPageText: string | undefined;

    let scrapeResult: {
      ok: boolean;
      adapter: string | null;
      error: string | null;
      attempts: AdapterAttempt[];
      imageCount: number;
      title: string | null;
    } | null = null;

    if (data.productUrl) {
      try {
        const outcome = await scrapeProductPageDetailed(data.productUrl);
        if (outcome.data) {
          productPageTitle = outcome.data.title || undefined;
          productPageImages = outcome.data.images;
          productPageText =
            [outcome.data.description, ...outcome.data.features].filter(Boolean).join("\n\n") || undefined;
        }
        scrapeResult = {
          ok: !!outcome.data,
          adapter: outcome.adapter,
          error: outcome.error ?? null,
          attempts: outcome.attempts,
          imageCount: outcome.data?.images.length ?? 0,
          title: outcome.data?.title ?? null,
        };
      } catch (e) {
        scrapeResult = {
          ok: false,
          adapter: null,
          error: e instanceof Error ? e.message : "Product page scrape failed",
          attempts: [],
          imageCount: 0,
          title: null,
        };
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
        goalType: data.goalType ?? null,
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
        // Seed the two Brand Kit fields we already have real data for — the
        // rest (logo, packshots, colours, CTA) genuinely need a human to
        // supply/approve the actual assets and can't be inferred from a scrape.
        ...(data.productUrl || productPageText
          ? {
              brandKit: {
                create: {
                  landingUrl: data.productUrl || null,
                  productSummary: productPageText?.slice(0, 1800) || null,
                },
              },
            }
          : {}),
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

    // completenessScore is a cache the studio/overview UI reads directly —
    // seeding brandKit above without this leaves a new project showing a
    // stale "0%" even when landingUrl/productSummary just got populated.
    await refreshCompleteness(project.id).catch(() => null);

    return NextResponse.json({ ...project, scrapeResult }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.name === "ZodError") {
      const issues = (err as unknown as { issues?: { path: (string | number)[]; message: string }[] }).issues || [];
      return NextResponse.json(
        { error: issues[0]?.message || "Invalid input", issues },
        { status: 400 }
      );
    }
    console.error("Failed to create project:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
