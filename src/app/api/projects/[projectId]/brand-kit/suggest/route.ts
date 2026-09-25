/**
 * POST /api/projects/[projectId]/brand-kit/suggest
 *
 * Fills ONLY empty Brand Kit fields with a best-effort suggestion (yellow —
 * "suggested"), from the project/brand's own scraped data first and the AI
 * as a last resort. Never overwrites a value the user already has (whether
 * confirmed or previously suggested). Also seeds up to 4 unverified packshot
 * assets from the product page images when the kit has fewer than 2, and
 * tries a cheap logo lookup from the brand site's head tags when there is no
 * logo yet.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { analyzeWithClaude } from "@/services/ai/claude-client";
import { ensureBrandKit, refreshCompleteness } from "@/services/brand-kit";
import { fetchHtml } from "@/services/research/product-adapters/shared";
import {
  buildSuggestSources,
  emptyFieldKeys,
  extractLogoUrlFromHtml,
  mergeSuggestions,
  pickPackshotUrls,
  suggestResponseSchema,
  type ExistingKitValues,
} from "@/services/brand-kit-suggest";
import { readStatusMap } from "@/lib/field-status";
import { uploadFromUrl } from "@/services/storage";

export const maxDuration = 60;

const SYSTEM_PROMPT = `You help fill in a Brand Kit for a paid-social ad pipeline. You are given whatever
product/brand context is available and must propose values ONLY for the fields that are actually
empty. Rules:
- Never invent factual claims or numbers. claimsAllowed must be claims you can point to in the
  supplied product page text — if you can't find any, return an empty array.
- claimsForbidden should be the typical risky claims for this product category (e.g. medical /
  "cures" / unverifiable superlatives) even if not seen on the page — this is a guardrail, not a
  quote.
- CTAs must have no emoji, and should match the brand's inferred tone.
- skuDimensions should be left out entirely unless dimensions are explicitly stated in the
  supplied text — do not estimate.
- offerText should be left out unless the supplied text clearly shows a current promotion/discount.
- Colours: 3-5 plausible brand hex values with a short name and usage (primary/secondary/accent/
  background/text).
- Judgment calls ALWAYS get a best guess when requested — the user reviews every suggestion:
  ctaOptions (2-3 short CTAs), toneGuidelines (2-3 sentences), fonts (headline + body families that
  fit the brand's look), doNotShow (3-5 visual do-nots), colors, productSummary, skuName.
- Only claimsAllowed, offerText and skuDimensionsCm may be omitted, and only when the text does not
  state them.
Respond with JSON only, using exactly the schema's key names.`;

// emptyFieldKeys() names fields by their UI key; the model answers in the
// schema's key names, so ask for those.
const SCHEMA_KEY: Record<string, string> = {
  colors: "colors",
  fonts: "fonts",
  cta: "ctaOptions",
  offer: "offerText",
  claimsAllowed: "claimsAllowed",
  claimsForbidden: "claimsForbidden",
  tone: "toneGuidelines",
  doNotShow: "doNotShow",
  skuName: "skuName",
  skuDimensions: "skuDimensionsCm",
  productSummary: "productSummary",
};

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      brandName: true,
      brandUrl: true,
      productUrl: true,
      productPageTitle: true,
      productPageText: true,
      productPageImages: true,
      category: true,
      campaignGoal: true,
    },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const [brand, insights, kit] = await Promise.all([
    prisma.brand.findUnique({
      where: { projectId },
      select: { productCategory: true, productDescription: true },
    }),
    prisma.insight.findMany({
      where: { projectId },
      orderBy: { importance: "desc" },
      take: 10,
      select: { title: true, description: true },
    }),
    ensureBrandKit(projectId),
  ]);

  const existing: ExistingKitValues = {
    colorsHex: kit.colorsHex as ExistingKitValues["colorsHex"],
    fonts: kit.fonts as ExistingKitValues["fonts"],
    ctaOptions: kit.ctaOptions as ExistingKitValues["ctaOptions"],
    offerText: kit.offerText,
    landingUrl: kit.landingUrl,
    claimsAllowed: kit.claimsAllowed as string[] | null | undefined,
    claimsForbidden: kit.claimsForbidden as string[] | null,
    toneGuidelines: kit.toneGuidelines,
    doNotShow: kit.doNotShow as string[] | null,
    skuName: kit.skuName,
    skuDimensionsCm: kit.skuDimensionsCm as ExistingKitValues["skuDimensionsCm"],
    productSummary: kit.productSummary,
  };

  const empty = emptyFieldKeys(existing);
  const fallbackLandingUrl = project.productUrl || project.brandUrl || null;

  const kitData: Record<string, unknown> = {};
  let suggestedKeys: string[] = [];
  let aiError: string | null = null;

  // Only call the AI when there is at least one text field it could help with
  // (asset/logo suggestion below runs independently of this).
  const aiEligible = empty.some((k) => k !== "landingUrl");
  if (aiEligible) {
    const context = buildSuggestSources(project, brand, insights);
    try {
      const ai = await analyzeWithClaude({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: `Fields still needed (schema keys): ${
          empty.map((k) => SCHEMA_KEY[k]).filter(Boolean).join(", ") || "(none)"
        }\n\nContext:\n${context}`,
        responseSchema: suggestResponseSchema,
        tier: "standard",
        maxTokens: 2000,
      });
      const merged = mergeSuggestions(empty, ai, { landingUrl: fallbackLandingUrl });
      Object.assign(kitData, merged.data);
      suggestedKeys = merged.suggestedKeys;
    } catch (err) {
      // Degrade gracefully — still apply the landingUrl fallback below and
      // report the AI miss instead of failing the whole request.
      aiError = err instanceof Error ? err.message.slice(0, 300) : String(err);
      console.warn("brand-kit suggest: AI call failed", err);
    }
  }

  // landingUrl doesn't need the AI at all.
  if (empty.includes("landingUrl") && !kitData.landingUrl && fallbackLandingUrl) {
    kitData.landingUrl = fallbackLandingUrl;
    suggestedKeys.push("landingUrl");
  }

  if (Object.keys(kitData).length > 0) {
    const statusMap = readStatusMap(kit.fieldStatus);
    for (const key of suggestedKeys) statusMap[key] = "suggested";
    await prisma.brandKit.update({
      where: { projectId },
      data: { ...kitData, fieldStatus: { ...statusMap, __suggestedAt: new Date().toISOString() } },
    });
  } else {
    // Still stamp __suggestedAt so auto-run doesn't retry every page load.
    const statusMap = readStatusMap(kit.fieldStatus);
    await prisma.brandKit.update({
      where: { projectId },
      data: { fieldStatus: { ...statusMap, __suggestedAt: new Date().toISOString() } },
    });
  }

  // Packshots — seed from the product page's own images when thin.
  const packshotCount = await prisma.brandAsset.count({ where: { brandKitId: kit.id, kind: "PACKSHOT" } });
  let addedPackshots = 0;
  if (packshotCount < 2) {
    const urls = pickPackshotUrls(project.productPageImages, 4 - packshotCount);
    for (const url of urls) {
      try {
        const upload = await uploadFromUrl(url, { folder: `creativeintel/brand-kit/${projectId}` });
        await prisma.brandAsset.create({
          data: {
            brandKitId: kit.id,
            kind: "PACKSHOT",
            variant: null,
            url: upload.url,
            publicId: upload.publicId,
            provider: upload.provider,
            width: upload.width ?? null,
            height: upload.height ?? null,
            format: upload.format ?? null,
            bytes: upload.bytes,
            verified: false,
          },
        });
        addedPackshots++;
      } catch (err) {
        console.warn("brand-kit suggest: packshot copy failed", url, err);
      }
    }
  }

  // Logo — cheap best-effort from the brand site's head tags only.
  const logoCount = await prisma.brandAsset.count({ where: { brandKitId: kit.id, kind: "LOGO" } });
  let addedLogo = false;
  if (logoCount === 0 && project.brandUrl) {
    try {
      const { html, finalUrl } = await fetchHtml(project.brandUrl);
      const logoUrl = extractLogoUrlFromHtml(html, finalUrl);
      if (logoUrl) {
        const upload = await uploadFromUrl(logoUrl, { folder: `creativeintel/brand-kit/${projectId}` });
        await prisma.brandAsset.create({
          data: {
            brandKitId: kit.id,
            kind: "LOGO",
            variant: "light",
            url: upload.url,
            publicId: upload.publicId,
            provider: upload.provider,
            width: upload.width ?? null,
            height: upload.height ?? null,
            format: upload.format ?? null,
            bytes: upload.bytes,
            verified: false,
          },
        });
        addedLogo = true;
      }
    } catch (err) {
      console.warn("brand-kit suggest: logo lookup failed", err);
    }
  }

  const completeness = await refreshCompleteness(projectId);
  const freshKit = await prisma.brandKit.findUniqueOrThrow({
    where: { projectId },
    include: { assets: { orderBy: { createdAt: "asc" } } },
  });

  return NextResponse.json({
    kit: freshKit,
    assets: freshKit.assets,
    completeness,
    suggested: { fields: suggestedKeys, packshots: addedPackshots, logo: addedLogo },
    // Surfaced so the panel can say why nothing was suggested, instead of
    // silently leaving fields red.
    aiError,
  });
}
