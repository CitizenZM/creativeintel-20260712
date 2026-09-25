import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { brandKitUpdateSchema } from "@/lib/validations";
import { ensureBrandKit, getBrandKitCompleteness, refreshCompleteness } from "@/services/brand-kit";
import { getStorageStatus } from "@/services/storage";
import { readStatusMap } from "@/lib/field-status";

export const maxDuration = 30;

const KIT_FIELD_KEYS = [
  "colors",
  "fonts",
  "cta",
  "offer",
  "landingUrl",
  "claimsAllowed",
  "claimsForbidden",
  "tone",
  "doNotShow",
  "skuName",
  "skuDimensions",
  "productSummary",
] as const;

/** Maps a PATCH body key (from brandKitUpdateSchema) to its field-status key. */
const FIELD_STATUS_KEY: Record<string, (typeof KIT_FIELD_KEYS)[number]> = {
  colorsHex: "colors",
  fonts: "fonts",
  ctaOptions: "cta",
  offerText: "offer",
  landingUrl: "landingUrl",
  claimsAllowed: "claimsAllowed",
  claimsForbidden: "claimsForbidden",
  toneGuidelines: "tone",
  doNotShow: "doNotShow",
  skuName: "skuName",
  skuDimensionsCm: "skuDimensions",
  productSummary: "productSummary",
};

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

  // { suggested: true } lets the suggest endpoint (and any future automated
  // writer) save values that stay yellow instead of being marked confirmed —
  // a normal user save always confirms every field it touches.
  const isSuggestedWrite = body && typeof body === "object" && body.suggested === true;

  const parsed = brandKitUpdateSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      {
        error: first ? `${first.path.join(".") || "field"}: ${first.message}` : "Invalid brand kit data",
        issues: parsed.error.issues,
      },
      { status: 400 }
    );
  }

  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const kit = await ensureBrandKit(projectId);

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

  // Every field present in the PATCH/PUT body becomes "confirmed" — it's the
  // user's own value now — unless the caller explicitly says it's a
  // suggestion write.
  const statusMap = readStatusMap(kit.fieldStatus);
  for (const bodyKey of Object.keys(data)) {
    const statusKey = FIELD_STATUS_KEY[bodyKey];
    if (!statusKey) continue;
    if (isSuggestedWrite) statusMap[statusKey] = "suggested";
    else delete statusMap[statusKey]; // absent = confirmed (the user's own value)
  }
  data.fieldStatus = statusMap;

  await prisma.brandKit.update({ where: { projectId }, data });

  const completeness = await refreshCompleteness(projectId);
  const freshKit = await prisma.brandKit.findUniqueOrThrow({
    where: { projectId },
    include: { assets: { orderBy: { createdAt: "asc" } } },
  });

  return NextResponse.json({ kit: freshKit, assets: freshKit.assets, completeness, storage: getStorageStatus() });
}

/**
 * PATCH /api/projects/[projectId]/brand-kit
 * Confirms one or more suggested fields (and/or assets) WITHOUT changing
 * their value.
 *   { confirm: ["cta", "colors"] }  — confirm specific fields
 *   { confirm: "all" }              — confirm every suggested field and set
 *                                      verified:true on every unverified asset
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const body = await req.json().catch(() => ({}));

  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const kit = await ensureBrandKit(projectId);
  const statusMap = readStatusMap(kit.fieldStatus);

  const confirm = body?.confirm;
  if (confirm === "all") {
    for (const key of Object.keys(statusMap)) delete statusMap[key];
    await prisma.$transaction([
      prisma.brandKit.update({ where: { projectId }, data: { fieldStatus: statusMap } }),
      prisma.brandAsset.updateMany({ where: { brandKitId: kit.id, verified: false }, data: { verified: true } }),
    ]);
  } else if (Array.isArray(confirm)) {
    // "logo" / "packshots" aren't tracked in fieldStatus — they're derived
    // from BrandAsset.verified (see field-status rule 2) — so confirming
    // them verifies the matching unverified assets instead.
    const ASSET_KIND: Record<string, string> = { logo: "LOGO", packshots: "PACKSHOT" };
    const assetKindsToVerify = confirm
      .filter((k): k is string => typeof k === "string" && k in ASSET_KIND)
      .map((k) => ASSET_KIND[k]);
    for (const key of confirm) {
      if (typeof key === "string" && !(key in ASSET_KIND)) delete statusMap[key];
    }
    await prisma.brandKit.update({ where: { projectId }, data: { fieldStatus: statusMap } });
    if (assetKindsToVerify.length) {
      await prisma.brandAsset.updateMany({
        where: { brandKitId: kit.id, verified: false, kind: { in: assetKindsToVerify } },
        data: { verified: true },
      });
    }
  } else {
    return NextResponse.json({ error: "Expected { confirm: \"all\" } or { confirm: string[] }" }, { status: 400 });
  }

  const completeness = await refreshCompleteness(projectId);
  const freshKit = await prisma.brandKit.findUniqueOrThrow({
    where: { projectId },
    include: { assets: { orderBy: { createdAt: "asc" } } },
  });

  return NextResponse.json({ kit: freshKit, assets: freshKit.assets, completeness, storage: getStorageStatus() });
}
