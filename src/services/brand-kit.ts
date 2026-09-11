/**
 * Brand Kit — completeness scoring and the canonical brand-truth block that
 * script / studio prompts inject. `getBrandTruthForPrompts` is consumed by other
 * modules; keep its signature stable.
 */
import { prisma } from "@/lib/db";

export interface BrandColor {
  name?: string;
  hex: string;
  usage?: string;
}

export interface BrandFont {
  role?: string;
  family: string;
  source?: string;
}

export interface BrandCtaOption {
  text: string;
  priority?: number;
}

export interface SkuDimensionsCm {
  height?: number;
  width?: number;
  depth?: number;
  weightG?: number;
}

export interface BrandKitCompleteness {
  score: number;
  missing: string[];
  ready: { creative: boolean; studio: boolean };
}

const WEIGHTS = {
  logo: 15,
  packshots: 20,
  colors: 10,
  cta: 15,
  landingUrl: 10,
  productSummary: 15,
  claims: 10,
  skuDimensions: 5,
} as const;

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function isFilled(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export async function ensureBrandKit(projectId: string) {
  const existing = await prisma.brandKit.findUnique({
    where: { projectId },
    include: { assets: { orderBy: { createdAt: "asc" } } },
  });
  if (existing) return existing;

  // Tolerate a concurrent create — the unique projectId makes the second one fail.
  await prisma.brandKit.create({ data: { projectId } }).catch(() => null);
  return prisma.brandKit.findUniqueOrThrow({
    where: { projectId },
    include: { assets: { orderBy: { createdAt: "asc" } } },
  });
}

export async function getBrandKitCompleteness(projectId: string): Promise<BrandKitCompleteness> {
  const kit = await prisma.brandKit.findUnique({
    where: { projectId },
    include: { assets: { select: { kind: true, variant: true } } },
  });

  if (!kit) {
    return {
      score: 0,
      missing: [
        "Brand logo (at least 1)",
        "Product packshots (at least 2)",
        "Brand colours (at least 3 hex values)",
        "At least one approved CTA",
        "Landing page URL",
        "Product summary",
        "Approved claims (or an explicit 'no claims')",
        "SKU dimensions in cm (studio)",
      ],
      ready: { creative: false, studio: false },
    };
  }

  const assets = kit.assets;
  const logos = assets.filter((a) => a.kind === "LOGO");
  const packshots = assets.filter((a) => a.kind === "PACKSHOT");
  const colors = asArray<BrandColor>(kit.colorsHex).filter((c) => isFilled(c?.hex));
  const ctas = asArray<BrandCtaOption>(kit.ctaOptions).filter((c) => isFilled(c?.text));
  const dims = (kit.skuDimensionsCm as SkuDimensionsCm | null) || null;

  const hasLogo = logos.length >= 1;
  const hasPackshots = packshots.length >= 2;
  const hasColors = colors.length >= 3;
  const hasCta = ctas.length >= 1;
  const hasLandingUrl = isFilled(kit.landingUrl);
  const hasSummary = isFilled(kit.productSummary);
  const hasClaims = Array.isArray(kit.claimsAllowed); // an explicit empty array counts
  const hasDimensions = !!dims && [dims.height, dims.width, dims.depth].some((v) => typeof v === "number" && v > 0);

  const checks: Array<{ ok: boolean; weight: number; label: string }> = [
    { ok: hasLogo, weight: WEIGHTS.logo, label: "Brand logo (at least 1)" },
    { ok: hasPackshots, weight: WEIGHTS.packshots, label: "Product packshots (at least 2)" },
    { ok: hasColors, weight: WEIGHTS.colors, label: "Brand colours (at least 3 hex values)" },
    { ok: hasCta, weight: WEIGHTS.cta, label: "At least one approved CTA" },
    { ok: hasLandingUrl, weight: WEIGHTS.landingUrl, label: "Landing page URL" },
    { ok: hasSummary, weight: WEIGHTS.productSummary, label: "Product summary" },
    { ok: hasClaims, weight: WEIGHTS.claims, label: "Approved claims (or an explicit 'no claims')" },
    { ok: hasDimensions, weight: WEIGHTS.skuDimensions, label: "SKU dimensions in cm (studio)" },
  ];

  const score = checks.reduce((sum, c) => sum + (c.ok ? c.weight : 0), 0);
  const missing = checks.filter((c) => !c.ok).map((c) => c.label);

  const creative = hasLogo && hasPackshots && hasColors && hasCta && hasLandingUrl && hasSummary && hasClaims;

  return {
    score: Math.max(0, Math.min(100, score)),
    missing,
    ready: { creative, studio: creative && hasDimensions },
  };
}

/** Recompute and persist completenessScore. Returns the fresh completeness. */
export async function refreshCompleteness(projectId: string): Promise<BrandKitCompleteness> {
  const completeness = await getBrandKitCompleteness(projectId);
  await prisma.brandKit
    .update({ where: { projectId }, data: { completenessScore: completeness.score } })
    .catch(() => null);
  return completeness;
}

/**
 * Compact brand-truth text block injected into script and studio prompts.
 * Returns "" when there is nothing usable yet.
 */
export async function getBrandTruthForPrompts(projectId: string): Promise<string> {
  const [kit, project] = await Promise.all([
    prisma.brandKit.findUnique({
      where: { projectId },
      include: { assets: { select: { kind: true, variant: true, url: true } } },
    }),
    prisma.project.findUnique({
      where: { id: projectId },
      select: { brandName: true, productName: true, productPageTitle: true, productUrl: true },
    }),
  ]);

  if (!project) return "";

  const lines: string[] = [];
  lines.push(`BRAND: ${project.brandName}`);

  const sku = kit?.skuName || project.productName || project.productPageTitle;
  if (sku) lines.push(`PRODUCT / SKU: ${sku}`);

  if (kit?.productSummary) lines.push(`PRODUCT SUMMARY: ${kit.productSummary.trim()}`);

  const dims = (kit?.skuDimensionsCm as SkuDimensionsCm | null) || null;
  if (dims) {
    const parts: string[] = [];
    if (dims.height) parts.push(`H ${dims.height}cm`);
    if (dims.width) parts.push(`W ${dims.width}cm`);
    if (dims.depth) parts.push(`D ${dims.depth}cm`);
    if (dims.weightG) parts.push(`${dims.weightG}g`);
    if (parts.length) lines.push(`SKU DIMENSIONS: ${parts.join(" × ")}`);
  }

  const ctas = asArray<BrandCtaOption>(kit?.ctaOptions)
    .filter((c) => isFilled(c?.text))
    .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
    .map((c) => c.text.trim());
  if (ctas.length) lines.push(`APPROVED CTAs (use these exact words): ${ctas.join(" | ")}`);

  if (kit?.offerText) lines.push(`OFFER: ${kit.offerText.trim()}`);

  const landing = kit?.landingUrl || project.productUrl;
  if (landing) lines.push(`LANDING URL: ${landing}`);

  const allowed = asArray<string>(kit?.claimsAllowed).filter(isFilled);
  if (allowed.length) lines.push(`ALLOWED CLAIMS: ${allowed.join(" | ")}`);
  else if (Array.isArray(kit?.claimsAllowed)) lines.push(`ALLOWED CLAIMS: none approved — make no product claims`);

  const forbidden = asArray<string>(kit?.claimsForbidden).filter(isFilled);
  if (forbidden.length) lines.push(`FORBIDDEN CLAIMS (never say these): ${forbidden.join(" | ")}`);

  if (kit?.toneGuidelines) lines.push(`TONE: ${kit.toneGuidelines.trim()}`);

  const doNotShow = asArray<string>(kit?.doNotShow).filter(isFilled);
  if (doNotShow.length) lines.push(`DO NOT SHOW: ${doNotShow.join(" | ")}`);

  const colors = asArray<BrandColor>(kit?.colorsHex).filter((c) => isFilled(c?.hex));
  if (colors.length) {
    lines.push(
      `BRAND COLOURS: ${colors.map((c) => [c.hex, c.usage || c.name].filter(Boolean).join(" ")).join(", ")}`
    );
  }

  const fonts = asArray<BrandFont>(kit?.fonts).filter((f) => isFilled(f?.family));
  if (fonts.length) {
    lines.push(`FONTS: ${fonts.map((f) => [f.role, f.family].filter(Boolean).join(": ")).join(", ")}`);
  }

  const logo = kit?.assets.find((a) => a.kind === "LOGO");
  if (logo) lines.push(`LOGO ASSET: ${logo.url}`);

  const packshots = (kit?.assets || []).filter((a) => a.kind === "PACKSHOT");
  if (packshots.length) {
    lines.push(`PACKSHOT REFERENCES (the real product — match exactly): ${packshots.map((p) => p.url).slice(0, 4).join(", ")}`);
  }

  if (lines.length <= 1) return "";
  return `--- BRAND TRUTH (authoritative, overrides any inference) ---\n${lines.join("\n")}\n--- END BRAND TRUTH ---`;
}
