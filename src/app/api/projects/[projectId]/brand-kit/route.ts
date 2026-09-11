import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { brandKitUpdateSchema } from "@/lib/validations";
import { ensureBrandKit, getBrandKitCompleteness, refreshCompleteness } from "@/services/brand-kit";
import { getStorageStatus } from "@/services/storage";

export const maxDuration = 30;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, brandName: true, productName: true, productPageTitle: true, productUrl: true },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const kit = await ensureBrandKit(projectId);
  const completeness = await getBrandKitCompleteness(projectId);

  return NextResponse.json({
    kit,
    assets: kit.assets,
    completeness,
    storage: getStorageStatus(),
    project,
  });
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const body = await req.json().catch(() => ({}));

  const parsed = brandKitUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid brand kit data", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  await ensureBrandKit(projectId);

  const input = parsed.data;
  const data: Record<string, unknown> = {};

  if (input.colorsHex !== undefined) data.colorsHex = input.colorsHex;
  if (input.fonts !== undefined) data.fonts = input.fonts;
  if (input.ctaOptions !== undefined) data.ctaOptions = input.ctaOptions;
  if (input.claimsAllowed !== undefined) data.claimsAllowed = input.claimsAllowed;
  if (input.claimsForbidden !== undefined) data.claimsForbidden = input.claimsForbidden;
  if (input.doNotShow !== undefined) data.doNotShow = input.doNotShow;
  if (input.skuDimensionsCm !== undefined) data.skuDimensionsCm = input.skuDimensionsCm;
  if (input.offerText !== undefined) data.offerText = input.offerText || null;
  if (input.landingUrl !== undefined) data.landingUrl = input.landingUrl || null;
  if (input.toneGuidelines !== undefined) data.toneGuidelines = input.toneGuidelines || null;
  if (input.skuName !== undefined) data.skuName = input.skuName || null;
  if (input.productSummary !== undefined) data.productSummary = input.productSummary || null;

  await prisma.brandKit.update({ where: { projectId }, data });

  const completeness = await refreshCompleteness(projectId);
  const kit = await prisma.brandKit.findUniqueOrThrow({
    where: { projectId },
    include: { assets: { orderBy: { createdAt: "asc" } } },
  });

  return NextResponse.json({ kit, assets: kit.assets, completeness, storage: getStorageStatus() });
}
