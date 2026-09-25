/**
 * Brand Kit suggestions — fills empty fields with a best guess so nothing in
 * the panel stays blank when we can make a reasonable one. Every value this
 * writes is marked "suggested" in BrandKit.fieldStatus (see field-status.ts)
 * so the UI shows it yellow until the user checks it.
 *
 * Pure helpers (buildSuggestSources, mergeSuggestions, pickLogoCandidateUrl)
 * are exported separately from the DB/AI-calling orchestrator so they can be
 * unit tested without mocking Prisma or the model call.
 */
import { z } from "zod";
import type { BrandColor, BrandCtaOption, BrandFont, SkuDimensionsCm } from "@/services/brand-kit";

export interface SuggestSourceProject {
  brandName: string;
  brandUrl: string | null;
  productUrl: string | null;
  productPageTitle: string | null;
  productPageText: string | null;
  productPageImages: unknown;
  category: string | null;
  campaignGoal: string | null;
}

export interface SuggestSourceBrandShape {
  productCategory: string | null;
  productDescription: string | null;
}
export type SuggestSourceBrand = SuggestSourceBrandShape | null;

export interface SuggestSourceInsight {
  title: string;
  description: string;
}

/** What's already present in the kit — suggestions must never clobber these. */
export interface ExistingKitValues {
  colorsHex: BrandColor[] | null;
  fonts: BrandFont[] | null;
  ctaOptions: BrandCtaOption[] | null;
  offerText: string | null;
  landingUrl: string | null;
  claimsAllowed: string[] | null | undefined;
  claimsForbidden: string[] | null;
  toneGuidelines: string | null;
  doNotShow: string[] | null;
  skuName: string | null;
  skuDimensionsCm: SkuDimensionsCm | null;
  productSummary: string | null;
}

function filled(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/** Which fields are actually empty and eligible for a suggestion. */
export function emptyFieldKeys(kit: ExistingKitValues): string[] {
  const out: string[] = [];
  if (!filled(kit.colorsHex)) out.push("colors");
  if (!filled(kit.fonts)) out.push("fonts");
  if (!filled(kit.ctaOptions)) out.push("cta");
  if (!filled(kit.offerText)) out.push("offer");
  if (!filled(kit.landingUrl)) out.push("landingUrl");
  // An explicit empty array means "no claims" (confirmed) — only undefined/null is empty.
  if (kit.claimsAllowed === null || kit.claimsAllowed === undefined) out.push("claimsAllowed");
  if (!filled(kit.claimsForbidden)) out.push("claimsForbidden");
  if (!filled(kit.toneGuidelines)) out.push("tone");
  if (!filled(kit.doNotShow)) out.push("doNotShow");
  if (!filled(kit.skuName)) out.push("skuName");
  if (!filled(kit.skuDimensionsCm)) out.push("skuDimensions");
  if (!filled(kit.productSummary)) out.push("productSummary");
  return out;
}

/** Assembles the compact context block sent to the model — best sources first. */
export function buildSuggestSources(
  project: SuggestSourceProject,
  brand: SuggestSourceBrand,
  insights: SuggestSourceInsight[]
): string {
  const lines: string[] = [];
  lines.push(`BRAND: ${project.brandName}`);
  if (project.category) lines.push(`CATEGORY: ${project.category}`);
  if (project.campaignGoal) lines.push(`CAMPAIGN GOAL: ${project.campaignGoal}`);
  if (project.productPageTitle) lines.push(`PRODUCT PAGE TITLE: ${project.productPageTitle}`);
  if (project.productUrl) lines.push(`PRODUCT URL: ${project.productUrl}`);
  if (project.brandUrl) lines.push(`BRAND URL: ${project.brandUrl}`);
  if (brand?.productCategory) lines.push(`PRODUCT CATEGORY: ${brand.productCategory}`);
  if (brand?.productDescription) lines.push(`PRODUCT DESCRIPTION: ${brand.productDescription}`);
  if (project.productPageText) {
    lines.push(`PRODUCT PAGE TEXT:\n${project.productPageText.slice(0, 6000)}`);
  }
  if (insights.length) {
    lines.push(
      `SELLING POINTS / INSIGHTS:\n${insights
        .slice(0, 10)
        .map((i) => `- ${i.title}: ${i.description}`)
        .join("\n")}`
    );
  }
  return lines.join("\n\n");
}

// Each field is parsed on its own and a malformed one becomes undefined — one
// bad font entry must not throw away the CTAs, tone and everything else.
const lenient = <T extends z.ZodTypeAny>(schema: T) => schema.optional().catch(undefined);
const namedList = <T extends z.ZodTypeAny>(item: T, max: number) =>
  lenient(
    z
      .array(z.unknown())
      .transform((xs) => xs.map((x) => item.safeParse(x)).filter((r) => r.success).map((r) => r.data as z.infer<T>))
      .transform((xs) => xs.slice(0, max))
  );

export const suggestResponseSchema = z.object({
  colors: namedList(z.object({ hex: z.string(), name: z.string().optional(), usage: z.string().optional() }), 5),
  // Models answer these in several shapes; accept the common ones.
  fonts: lenient(
    z
      .preprocess((v) => {
        if (v && typeof v === "object" && !Array.isArray(v)) {
          // { headline: "X", body: "Y" }
          return Object.entries(v as Record<string, unknown>).map(([role, family]) =>
            typeof family === "string" ? { role, family } : family
          );
        }
        return v;
      }, z.array(z.unknown()))
      .transform((xs) =>
        xs
          .map((x) => (typeof x === "string" ? { family: x } : x))
          .map((x) => z.object({ role: z.string().optional(), family: z.string().min(1), source: z.string().optional() }).safeParse(x))
          .filter((r) => r.success)
          .map((r) => r.data!)
          .slice(0, 4)
      )
  ),
  ctaOptions: lenient(
    z
      .array(z.unknown())
      .transform((xs) =>
        xs
          .map((x) => (typeof x === "string" ? { text: x } : x))
          .map((x) => z.object({ text: z.string().min(1) }).safeParse(x))
          .filter((r) => r.success)
          .map((r) => r.data!)
          .slice(0, 3)
      )
  ),
  offerText: lenient(z.string()),
  claimsAllowed: namedList(z.string().min(1), 10),
  claimsForbidden: namedList(z.string().min(1), 10),
  toneGuidelines: lenient(
    z.preprocess((v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").join(" ") : v), z.string().min(1))
  ),
  doNotShow: namedList(z.string().min(1), 10),
  skuName: lenient(z.string()),
  skuDimensionsCm: lenient(
    z.object({
      height: z.number().optional(),
      width: z.number().optional(),
      depth: z.number().optional(),
      weightG: z.number().optional(),
    })
  ),
  productSummary: lenient(z.string()),
});

export type SuggestResponse = z.infer<typeof suggestResponseSchema>;

export interface MergeResult {
  data: Record<string, unknown>;
  suggestedKeys: string[];
}

/**
 * Merges AI output onto the kit — only fills fields that were empty, and
 * only when the AI actually returned something usable for that field.
 * Never invents a landingUrl (that's productUrl || brandUrl, not the model's
 * call) or an offer when the page didn't show one.
 */
export function mergeSuggestions(
  empty: string[],
  ai: SuggestResponse,
  fallback: { landingUrl: string | null }
): MergeResult {
  const data: Record<string, unknown> = {};
  const suggestedKeys: string[] = [];
  const isEmpty = (k: string) => empty.includes(k);

  if (isEmpty("colors") && ai.colors?.length) {
    const colors = ai.colors
      .filter((c) => /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c.hex.trim()))
      .slice(0, 5)
      .map((c) => ({ hex: c.hex.trim(), name: c.name, usage: c.usage }));
    if (colors.length) {
      data.colorsHex = colors;
      suggestedKeys.push("colors");
    }
  }

  if (isEmpty("fonts") && ai.fonts?.length) {
    const fonts = ai.fonts.filter((f) => f.family?.trim()).slice(0, 4);
    if (fonts.length) {
      data.fonts = fonts;
      suggestedKeys.push("fonts");
    }
  }

  if (isEmpty("cta") && ai.ctaOptions?.length) {
    const ctas = ai.ctaOptions
      .filter((c) => c.text?.trim())
      .slice(0, 3)
      .map((c, i) => ({ text: c.text.trim(), priority: i + 1 }));
    if (ctas.length) {
      data.ctaOptions = ctas;
      suggestedKeys.push("cta");
    }
  }

  if (isEmpty("offer") && ai.offerText?.trim()) {
    data.offerText = ai.offerText.trim();
    suggestedKeys.push("offer");
  }

  if (isEmpty("landingUrl") && fallback.landingUrl) {
    data.landingUrl = fallback.landingUrl;
    suggestedKeys.push("landingUrl");
  }

  if (isEmpty("claimsAllowed") && ai.claimsAllowed) {
    // Even an empty array here is a real answer ("no factual claims found"),
    // and an explicit [] is treated as confirmed per field-status rules — so
    // only mark it suggested (not confirmed) when the model actually listed
    // claims; an AI-returned empty list is left alone (still "missing", red)
    // so the user makes that call themselves rather than it silently going
    // green with nothing to check.
    const claims = ai.claimsAllowed.filter((c) => c?.trim());
    if (claims.length) {
      data.claimsAllowed = claims;
      suggestedKeys.push("claimsAllowed");
    }
  }

  if (isEmpty("claimsForbidden") && ai.claimsForbidden?.length) {
    const claims = ai.claimsForbidden.filter((c) => c?.trim());
    if (claims.length) {
      data.claimsForbidden = claims;
      suggestedKeys.push("claimsForbidden");
    }
  }

  if (isEmpty("tone") && ai.toneGuidelines?.trim()) {
    data.toneGuidelines = ai.toneGuidelines.trim();
    suggestedKeys.push("tone");
  }

  if (isEmpty("doNotShow") && ai.doNotShow?.length) {
    const items = ai.doNotShow.filter((c) => c?.trim());
    if (items.length) {
      data.doNotShow = items;
      suggestedKeys.push("doNotShow");
    }
  }

  if (isEmpty("skuName") && ai.skuName?.trim()) {
    data.skuName = ai.skuName.trim();
    suggestedKeys.push("skuName");
  }

  if (isEmpty("skuDimensions") && ai.skuDimensionsCm) {
    const dims = ai.skuDimensionsCm;
    const hasAny = [dims.height, dims.width, dims.depth, dims.weightG].some(
      (v) => typeof v === "number" && v > 0
    );
    if (hasAny) {
      data.skuDimensionsCm = dims;
      suggestedKeys.push("skuDimensions");
    }
  }

  if (isEmpty("productSummary") && ai.productSummary?.trim()) {
    data.productSummary = ai.productSummary.trim();
    suggestedKeys.push("productSummary");
  }

  return { data, suggestedKeys };
}

/** Picks up to `max` distinct image URLs from Project.productPageImages. */
export function pickPackshotUrls(productPageImages: unknown, max: number): string[] {
  if (!Array.isArray(productPageImages)) return [];
  const urls: string[] = [];
  for (const entry of productPageImages) {
    const url = entry && typeof entry === "object" && "url" in entry ? String((entry as { url: unknown }).url) : null;
    if (url && /^https?:\/\//i.test(url) && !urls.includes(url)) urls.push(url);
    if (urls.length >= max) break;
  }
  return urls;
}

/**
 * Extracts a best-guess logo URL from a brand site's HTML head — og:image,
 * then apple-touch-icon, then a standard favicon link. Absolute-ified against
 * `baseUrl`. Returns null when nothing usable is found (logo stays red rather
 * than risk a bad guess).
 */
export function extractLogoUrlFromHtml(html: string, baseUrl: string): string | null {
  // og:image is usually a campaign banner, not the logo — prefer an <img> the
  // site itself labels as its logo, then the touch icon, then the favicon.
  const logoImg = [...html.matchAll(/<img\b[^>]*>/gi)]
    .map((m) => m[0])
    .find((tag) => /(class|id|alt)=["'][^"']*logo/i.test(tag) || /src=["'][^"']*logo[^"']*["']/i.test(tag));
  const logoSrc = logoImg?.match(/\ssrc=["']([^"']+)["']/i);
  const touchIconMatch = html.match(/<link[^>]+rel=["']apple-touch-icon[^"']*["'][^>]+href=["']([^"']+)["']/i)
    || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']apple-touch-icon[^"']*["']/i);
  const iconMatch = html.match(/<link[^>]+rel=["']icon["'][^>]+href=["']([^"']+)["']/i)
    || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']icon["']/i);

  const raw = logoSrc?.[1] || touchIconMatch?.[1] || iconMatch?.[1];
  if (!raw) return null;
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return null;
  }
}
