/**
 * Copy another project's Brand Kit into this one.
 *
 * The same brand gets researched more than once (different products, different
 * campaigns), and re-uploading the same logo and packshots every time is pure
 * friction. Asset rows are copied by reference — the files already live in
 * blob storage, so there is no re-upload and no duplicate bytes.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureBrandKit, refreshCompleteness } from "@/services/brand-kit";

export const maxDuration = 30;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const { sourceProjectId } = (await request.json().catch(() => ({}))) as {
    sourceProjectId?: string;
  };
  if (!sourceProjectId || sourceProjectId === projectId) {
    return NextResponse.json({ error: "sourceProjectId required" }, { status: 400 });
  }

  const source = await prisma.brandKit.findUnique({
    where: { projectId: sourceProjectId },
    include: { assets: true },
  });
  if (!source) {
    return NextResponse.json({ error: "That project has no Brand Kit" }, { status: 404 });
  }

  await ensureBrandKit(projectId);

  const target = await prisma.brandKit.update({
    where: { projectId },
    data: {
      colorsHex: source.colorsHex ?? undefined,
      fonts: source.fonts ?? undefined,
      ctaOptions: source.ctaOptions ?? undefined,
      offerText: source.offerText,
      claimsAllowed: source.claimsAllowed ?? undefined,
      claimsForbidden: source.claimsForbidden ?? undefined,
      toneGuidelines: source.toneGuidelines,
      doNotShow: source.doNotShow ?? undefined,
      // Deliberately NOT copied: landingUrl, skuName, skuDimensionsCm and
      // productSummary describe the specific product, not the brand.
    },
  });

  // Only fill gaps — never silently replace an asset already uploaded here.
  const existing = await prisma.brandAsset.findMany({
    where: { brandKitId: target.id },
    select: { kind: true, variant: true },
  });
  const taken = new Set(existing.map((a) => `${a.kind}:${a.variant ?? ""}`));
  const toCopy = source.assets.filter((a) => !taken.has(`${a.kind}:${a.variant ?? ""}`));

  if (toCopy.length > 0) {
    await prisma.brandAsset.createMany({
      data: toCopy.map((a) => ({
        brandKitId: target.id,
        kind: a.kind,
        variant: a.variant,
        url: a.url,
        publicId: a.publicId,
        provider: a.provider,
        width: a.width,
        height: a.height,
        format: a.format,
        bytes: a.bytes,
        verified: a.verified,
        caption: a.caption,
      })),
    });
  }

  const completeness = await refreshCompleteness(projectId);
  return NextResponse.json({ copiedAssets: toCopy.length, completeness });
}
