import { z } from "zod";

/**
 * A URL pasted into a name field poisons everything downstream — it becomes
 * the search term for every ad library and the "brand" the AI writes copy
 * about. 12 of 44 stored competitors were URLs before this existed.
 */
export const looksLikeUrl = (v: string) => /^https?:\/\/|^www\./i.test(v.trim());

const NAME_NOT_URL = (field: string) =>
  `${field} looks like a URL — enter the actual name (e.g. "Ekster"), and put the URL in the URL field instead`;

export const competitorSchema = z.object({
  name: z
    .string()
    .min(1, "Competitor name is required")
    .refine((v) => !looksLikeUrl(v), NAME_NOT_URL("Competitor name")),
  url: z.string().url("Must be a valid URL").optional().or(z.literal("")),
});

const NON_PDP_MESSAGE =
  "This looks like a homepage or category page, not a product page. Paste the specific product URL (e.g. /products/<item> or /dp/<ASIN>).";

/**
 * Categories whose "product" is a service or program. They have no PDP, so the
 * offering's own landing page (even a homepage) is the right thing to read.
 */
const SERVICE_CATEGORIES = new Set(["SaaS & Software", "Financial Services", "Education", "Entertainment", "Other"]);
const STOREFRONT_SUBDOMAINS = new Set(["www", "shop", "store", "m", "en", "us"]);

/** true when the URL is a storefront root / listing page rather than a PDP. */
export function isLikelyNonProductUrl(value: string, opts: { category?: string } = {}): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  const path = url.pathname.replace(/\/+$/, "");
  if (!path || path === "/") {
    if (opts.category && SERVICE_CATEGORIES.has(opts.category)) return false;
    // speedrun.a16z.com is a product's own landing page; www./shop. roots are storefronts.
    const labels = url.hostname.toLowerCase().split(".");
    const isSubdomainSite = labels.length > 2 && !STOREFRONT_SUBDOMAINS.has(labels[0]);
    return !isSubdomainSite;
  }

  const lower = path.toLowerCase();
  const looksLikePdp = /\/(products?|dp|gp\/product|item|p)\//.test(lower) || /\/[a-z0-9-]{8,}-p\d+/.test(lower);

  if (/\/collections?\//.test(lower) && !/\/products?\//.test(lower)) return true;
  if (/\/(category|categories|catalog|shop|store|stores|brands?)(\/|$)/.test(lower) && !looksLikePdp) return true;
  if (/\/s$/.test(lower) && url.searchParams.has("k")) return true;
  if (/\/s\//.test(lower) && url.searchParams.has("k")) return true;
  if (url.searchParams.has("k") && /\/s\b/.test(lower)) return true;
  if (/\/(search|b|gp\/browse)(\/|$)/.test(lower) && !looksLikePdp) return true;

  return false;
}

export const productUrlSchema = z
  .string()
  .url("Must be a valid URL")
  .refine((v) => !isLikelyNonProductUrl(v), { message: NON_PDP_MESSAGE });

export const optionalProductUrlSchema = productUrlSchema.optional().or(z.literal(""));

export const createProjectSchema = z.object({
  brandName: z
    .string()
    .min(1, "Brand name is required")
    .refine((v) => !looksLikeUrl(v), NAME_NOT_URL("Brand name")),
  brandUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")),
  // Checked against the category below: service brands may use a homepage.
  productUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")),
  productName: z.string().optional(),
  category: z.string().optional(),
  campaignGoal: z.string().optional(),
  goalType: z.enum(["storytelling", "conversion", "hybrid"]).optional(),
  briefingText: z.string().optional(),
  competitors: z.array(competitorSchema).min(1, "Add at least one competitor"),
}).superRefine((v, ctx) => {
  if (v.productUrl && isLikelyNonProductUrl(v.productUrl, { category: v.category })) {
    ctx.addIssue({ code: "custom", path: ["productUrl"], message: NON_PDP_MESSAGE });
  }
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;

// ─── Brand Kit ───────────────────────────────────────────────────────────────

const hexColor = z
  .string()
  .trim()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Use a hex colour like #1A2B3C");

export const brandColorSchema = z.object({
  name: z.string().max(60).optional(),
  hex: hexColor,
  usage: z.enum(["primary", "secondary", "accent", "background", "text"]).optional(),
});

export const brandFontSchema = z.object({
  role: z.enum(["headline", "body", "accent"]).optional(),
  family: z.string().min(1).max(120),
  source: z.string().max(300).optional(),
});

export const brandCtaOptionSchema = z.object({
  text: z.string().min(1, "CTA text is required").max(120),
  priority: z.number().int().min(1).max(99).optional(),
});

export const skuDimensionsSchema = z.object({
  height: z.number().nonnegative().max(10_000).optional(),
  width: z.number().nonnegative().max(10_000).optional(),
  depth: z.number().nonnegative().max(10_000).optional(),
  weightG: z.number().nonnegative().max(1_000_000).optional(),
});

export const brandKitUpdateSchema = z.object({
  colorsHex: z.array(brandColorSchema).max(12).optional(),
  fonts: z.array(brandFontSchema).max(6).optional(),
  ctaOptions: z.array(brandCtaOptionSchema).max(12).optional(),
  offerText: z.string().max(500).optional().nullable(),
  landingUrl: z.string().url("Must be a valid URL").max(2000).optional().nullable().or(z.literal("")),
  claimsAllowed: z.array(z.string().max(300)).max(30).optional(),
  claimsForbidden: z.array(z.string().max(300)).max(30).optional(),
  toneGuidelines: z.string().max(4000).optional().nullable(),
  doNotShow: z.array(z.string().max(300)).max(30).optional(),
  skuName: z.string().max(200).optional().nullable(),
  skuDimensionsCm: skuDimensionsSchema.optional().nullable(),
  productSummary: z.string().max(4000).optional().nullable(),
});

export type BrandKitUpdateInput = z.infer<typeof brandKitUpdateSchema>;

export const BRAND_ASSET_KINDS = ["LOGO", "PACKSHOT", "LIFESTYLE", "FONT", "OTHER"] as const;
export type BrandAssetKind = (typeof BRAND_ASSET_KINDS)[number];

export const brandAssetMetaSchema = z.object({
  kind: z.enum(BRAND_ASSET_KINDS),
  variant: z.string().max(40).optional(),
  caption: z.string().max(300).optional(),
});
