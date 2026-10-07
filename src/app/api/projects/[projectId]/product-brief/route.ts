/**
 * The sp-1 product brief (ranked filmable selling points, keywords, objections, big idea) stored on
 * Project.productBrief. GET returns what is stored; POST regenerates it from the project's scraped
 * product page — one deep-tier model call (mirrors the operator `product-brief` action).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

export const maxDuration = 300;

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { productBrief: true, productBriefAt: true, productName: true, productPageTitle: true, productPageText: true, productUrl: true },
  });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({
    brief: project.productBrief ?? null,
    at: project.productBriefAt?.toISOString() ?? null,
    productTitle: project.productPageTitle || project.productName || null,
    productUrl: project.productUrl ?? null,
    hasProductPage: !!(project.productPageTitle || project.productName || project.productPageText),
  });
}

const postSchema = z
  .object({
    platforms: z.array(z.string()).max(12).optional(),
    durationSec: z.number().int().min(6).max(60).optional(),
    price: z.number().nullable().optional(),
    listPrice: z.number().nullable().optional(),
    rating: z.number().nullable().optional(),
    reviewCount: z.number().nullable().optional(),
  })
  .catch({});

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const input = postSchema.parse(await request.json().catch(() => ({})));
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, brandName: true, productName: true, productUrl: true, productPageTitle: true, productPageText: true },
  });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const title = project.productPageTitle || project.productName || "";
  if (!title && !project.productPageText) {
    return NextResponse.json({ error: "No product page on this project — set the product URL in Setup first" }, { status: 409 });
  }
  try {
    const { extractProductBrief } = await import("@/services/creative/product-brief");
    const text = project.productPageText ?? "";
    const brief = await extractProductBrief({
      url: project.productUrl,
      title,
      brand: project.brandName,
      bullets: text
        .split(/\n+/)
        .map((l) => l.trim())
        .filter((l) => l.length > 12 && l.length < 300)
        .slice(0, 20),
      description: text,
      price: input.price ?? null,
      listPrice: input.listPrice ?? null,
      rating: input.rating ?? null,
      reviewCount: input.reviewCount ?? null,
      platforms: input.platforms,
      durationSec: input.durationSec,
    });
    const at = new Date();
    await prisma.project.update({ where: { id: project.id }, data: { productBrief: brief as object, productBriefAt: at } });
    return NextResponse.json({ brief, at: at.toISOString() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
