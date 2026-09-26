import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import * as cheerio from "cheerio";
import { ensureBrandKit, refreshCompleteness } from "@/services/brand-kit";

export const maxDuration = 60;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProductImageRecord {
  url: string;
  caption: string;
  type: "website" | "ai-full" | "ai-detail" | "ai-environment";
  source: "brand-website" | "web-search" | "ai-generated";
  environmentName?: string;
  verified?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Resolve relative src to absolute, filter out icons/logos/tracking pixels */
function resolveAndFilterImage(src: string, baseUrl: string): string | null {
  if (!src) return null;
  try {
    const abs = new URL(src, baseUrl).toString();
    // Skip tiny images, SVGs, data URIs, tracking pixels, icons
    if (
      abs.startsWith("data:") ||
      abs.endsWith(".svg") ||
      abs.includes("icon") ||
      abs.includes("logo") ||
      abs.includes("favicon") ||
      abs.includes("tracking") ||
      abs.includes("pixel") ||
      abs.includes("spinner")
    ) return null;
    return abs;
  } catch {
    return null;
  }
}

/** Scrape product images from brand website — tries homepage + /products page */
async function scrapeWebsiteImages(
  brandUrl: string,
  productDescription: string
): Promise<ProductImageRecord[]> {
  const results: ProductImageRecord[] = [];
  const seen = new Set<string>();

  // Build page list — try category-specific pages first based on product description
  const base = brandUrl.replace(/\/$/, "");
  const descLower = productDescription.toLowerCase();
  const categoryPages: string[] = [];
  if (descLower.includes("vacuum") || descLower.includes("cleaner")) {
    categoryPages.push(`${base}/vacuums`, `${base}/robot-vacuums`, `${base}/cordless-vacuums`);
  }
  if (descLower.includes("kitchen") || descLower.includes("air fryer") || descLower.includes("ninja")) {
    categoryPages.push(`${base}/ninja`, `${base}/air-fryers`, `${base}/kitchen`);
  }

  const urlsToTry = [
    ...categoryPages,      // category pages first (most relevant)
    brandUrl,              // homepage fallback
    `${base}/products`,
    `${base}/collections`,
  ];

  for (const pageUrl of urlsToTry) {
    if (results.length >= 6) break;
    try {
      const res = await fetch(pageUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        },
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) continue;

      const html = await res.text();
      const $ = cheerio.load(html);

      // Priority: product images with meaningful alt text, large srcset images
      const candidates: { url: string; alt: string; score: number }[] = [];

      $("img").each((_, el) => {
        const alt = $(el).attr("alt")?.trim() || "";
        const src = $(el).attr("src") || $(el).attr("data-src") || $(el).attr("data-lazy-src") || "";
        const srcset = $(el).attr("srcset") || "";

        // Pick largest srcset URL if available
        let bestSrc = src;
        if (srcset) {
          const parts = srcset.split(",").map(s => s.trim().split(/\s+/));
          const sorted = parts.sort((a, b) => {
            const wa = parseInt(a[1]) || 0;
            const wb = parseInt(b[1]) || 0;
            return wb - wa;
          });
          if (sorted[0]?.[0]) bestSrc = sorted[0][0];
        }

        const resolved = resolveAndFilterImage(bestSrc, pageUrl);
        if (!resolved || seen.has(resolved)) return;

        // Score based on relevance signals
        let score = 0;
        const altLower = alt.toLowerCase();
        const srcLower = resolved.toLowerCase();
        const descLower = productDescription.toLowerCase();

        // Extract key product words from description to boost matching
        const productKeywords = descLower.match(/\b(vacuum|cleaner|mop|robot|upright|cordless|suction|carpet|floor|dust|canister|air fryer|blender|coffee|kitchen|appliance)\b/g) || [];

        // Boost if image alt matches product keywords
        for (const kw of productKeywords) {
          if (altLower.includes(kw)) score += 12;
        }
        if (altLower.includes("vacuum") || altLower.includes("cleaner") || altLower.includes("mop")) score += 15;
        if (altLower.includes("cordless") || altLower.includes("robot") || altLower.includes("upright")) score += 10;
        if (altLower.includes("product") || altLower.includes("hero")) score += 5;
        if (srcLower.includes("product") || srcLower.includes("pdp")) score += 8;
        if (srcLower.includes("cdn") || srcLower.includes("media")) score += 3;
        if (alt && alt.length > 5) score += 2;
        // Prefer larger images
        if (/\.(jpg|jpeg|webp|png)(\?|$)/i.test(resolved)) score += 4;
        // Penalize clearly off-category products
        if (altLower.includes("mask") || altLower.includes("hair") || altLower.includes("beauty") || altLower.includes("flexstyle") || altLower.includes("cryo")) score -= 20;
        if (score < 3) return; // skip irrelevant

        candidates.push({ url: resolved, alt, score });
        seen.add(resolved);
      });

      // Sort by score, take top images
      candidates.sort((a, b) => b.score - a.score);
      for (const c of candidates.slice(0, 4)) {
        if (results.length >= 6) break;
        results.push({
          url: c.url,
          caption: c.alt || "Product image from brand website",
          type: "website",
          source: "brand-website",
          verified: false,
        });
      }
    } catch {
      // continue to next URL
    }
  }

  return results;
}

/** Strip brand/product names from environment prompts to avoid wrong-image generation */
function sanitizeEnvPrompt(prompt: string, brandName: string, productName?: string | null): string {
  // Replace brand name and product name with generic terms
  // "Shark PowerDetect™ Cordless Vacuum" → "a cordless vacuum cleaner"
  // "SharkNinja" → "the product"
  // This prevents Pollinations from generating shark animals or wrong products
  let safe = prompt;
  if (productName) {
    // Replace full product name first (longer match first)
    safe = safe.replace(new RegExp(productName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "the product");
  }
  safe = safe.replace(new RegExp(brandName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "the brand");
  // Remove trademark symbols that confuse image generators
  safe = safe.replace(/™|®|©/g, "");
  return safe;
}

/**
 * Generate AI image via Pollinations.ai.
 * Returns a Pollinations URL so it loads lazily in the browser.
 * Always appends safety suffix: no animals, no wildlife.
 */
async function generateAIImage(prompt: string, width = 1024, height = 1024, seed?: number): Promise<string | null> {
  const s = seed ?? Math.floor(Math.random() * 999999);
  // Always append safety clause — prevents animal/wildlife generation from brand names like "Shark"
  const safePrompt = `${prompt}. No animals, no wildlife, no creatures, no fish, no sharks, no pets in scene. Pure environment only.`;
  const encoded = encodeURIComponent(safePrompt);
  const url = `https://image.pollinations.ai/prompt/${encoded}?width=${width}&height=${height}&seed=${s}&nologo=true&model=flux&enhance=true&nofeed=true`;
  return url;
}

// ─── Route handlers ───────────────────────────────────────────────────────────

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const [brand, project] = await Promise.all([
    prisma.brand.findUnique({ where: { projectId } }),
    prisma.project.findUnique({
      where: { id: projectId },
      select: { productPageImages: true, userProductImages: true },
    }),
  ]);
  if (!brand) return NextResponse.json({ error: "Brand not found" }, { status: 404 });

  // Product Definition (user uploads + images read from the product page) is
  // the source of truth for real photos — show them here too, so the two
  // panels never disagree about whether real product images exist.
  type Img = { url: string; caption?: string; alt?: string };
  const stored = (Array.isArray(brand.productImages) ? brand.productImages : []) as unknown as Img[];
  const seen = new Set(stored.map((i) => i.url));
  const definition = [
    ...((project?.userProductImages as Img[] | null) ?? []),
    ...((project?.productPageImages as Img[] | null) ?? []),
  ]
    .filter((i) => i?.url && !seen.has(i.url) && (seen.add(i.url), true))
    .map((i) => ({ url: i.url, caption: i.caption || i.alt || "Product photo", type: "website", source: "brand-website" }));

  return NextResponse.json({
    productCategory: brand.productCategory,
    productDescription: brand.productDescription,
    productVerified: brand.productVerified,
    productImages: [...definition, ...stored],
    useEnvironments: brand.useEnvironments,
    actorSettings: brand.actorSettings,
    displayGuidelines: brand.displayGuidelines,
  });
}

/**
 * Proxy an image URL through our server, returning a base64 data URI.
 * Needed because many CDNs (SharkNinja, etc.) block direct browser requests.
 */
async function proxyImageToDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        Accept: "image/webp,image/avif,image/*,*/*",
        Referer: new URL(url).origin,
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "image/jpeg";
    // Only proxy actual images
    if (!ct.startsWith("image/")) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 1000) return null; // skip tiny images (tracking pixels etc.)
    const b64 = Buffer.from(buf).toString("base64");
    return `data:${ct};base64,${b64}`;
  } catch {
    return null;
  }
}

/**
 * Seed the Brand Kit's approved CTA pool from AI-scraped website CTA language,
 * but only when the user has not curated any CTAs yet. The Brand Kit panel
 * remains the only place CTAs are edited.
 */
async function seedBrandKitCtaOptions(projectId: string, ctaLanguage: unknown): Promise<void> {
  const candidates = Array.isArray(ctaLanguage)
    ? ctaLanguage
        .map((c) => (typeof c === "string" ? c : (c as { text?: string })?.text))
        .filter((t): t is string => typeof t === "string" && t.trim().length > 0 && t.trim().length <= 120)
        .map((t) => t.trim())
    : [];
  if (candidates.length === 0) return;

  const kit = await ensureBrandKit(projectId);
  const existing = Array.isArray(kit.ctaOptions) ? kit.ctaOptions : [];
  if (existing.length > 0) return;

  const unique = [...new Set(candidates)].slice(0, 6);
  await prisma.brandKit.update({
    where: { projectId },
    data: { ctaOptions: unique.map((text, i) => ({ text, priority: i + 1 })) },
  });
  await refreshCompleteness(projectId);
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  const [brand, project] = await Promise.all([
    prisma.brand.findUnique({ where: { projectId } }),
    prisma.project.findUnique({ where: { id: projectId } }),
  ]);

  if (!brand || !project) {
    return NextResponse.json({ error: "Brand not found" }, { status: 404 });
  }

  await seedBrandKitCtaOptions(projectId, brand.ctaLanguage);

  const productDesc = brand.productDescription || `${brand.name} home appliance product`;
  const brandUrl = brand.url || project.brandUrl || "";

  // Real images scraped from user-specified product page URL (source of truth)
  const productPageImages = (project.productPageImages as Array<{ url: string; alt: string }> | null) || [];
  // User-uploaded images (highest trust)
  const userProductImages = (project.userProductImages as Array<{ url: string; caption: string }> | null) || [];

  const environments = (brand.useEnvironments as Array<{
    name: string; imagePrompt: string; description: string; typicalUser: string;
  }>) || [];

  const allImages: ProductImageRecord[] = [];

  // ── Step 1: User-uploaded images (highest trust — user provided these) ──
  for (const img of userProductImages.slice(0, 4)) {
    allImages.push({
      url: img.url, // Already a data URI from client upload
      caption: img.caption || "User uploaded product image",
      type: "website",
      source: "brand-website",
      verified: true, // User explicitly provided these
    });
  }

  // ── Step 2: Proxy and serve real product page images ──
  // These come from the scraped product URL — they are the actual product.
  // We proxy them to data URIs to bypass CDN restrictions.
  const productImageResults = await Promise.all(
    productPageImages.slice(0, 4).map(async (img) => {
      // Skip API-style URLs that return JSON (e.g. SharkNinja's /image/list/fn_select:jq:...)
      if (img.url.includes("fn_select") || img.url.includes(".json")) return null;

      const dataUri = await proxyImageToDataUri(img.url);
      if (!dataUri) return null;
      return {
        url: dataUri,
        caption: img.alt || "Product image from product page",
        type: "website" as const,
        source: "brand-website" as const,
        verified: false,
      };
    })
  );
  allImages.push(...(productImageResults.filter(r => r !== null) as ProductImageRecord[]));

  // ── Step 3: Fallback — scrape brand website for direct image URLs ──
  if (allImages.length < 2 && brandUrl) {
    const websiteImages = await scrapeWebsiteImages(brandUrl, productDesc);
    // Also proxy these to avoid CDN blocking
    const proxied = await Promise.all(
      websiteImages.slice(0, 4 - allImages.length).map(async (img) => {
        if (img.url.includes("fn_select") || img.url.includes(".json")) return null;
        const dataUri = await proxyImageToDataUri(img.url);
        if (!dataUri) return img; // return original URL as fallback
        return { ...img, url: dataUri };
      })
    );
    allImages.push(...(proxied.filter(r => r !== null) as ProductImageRecord[]));
  }

  // ── Step 4: Environment scenes — AI generation is OK here ──
  // We generate environment scenes (not the product itself) using AI.
  // These describe the SETTING, not the product — no risk of wrong product appearance.
  const envList = environments.length > 0 ? environments.slice(0, 3) : [
    {
      name: "Living Room with Pet Fur",
      imagePrompt: "Modern open-plan living room, plush cream carpet with visible golden retriever fur, large floor-to-ceiling windows letting in afternoon light, Scandinavian minimalist decor, no humans, no product, photorealistic interior photography",
    },
    {
      name: "Kitchen Hardwood Floor",
      imagePrompt: "Modern kitchen with light oak hardwood floor, small debris and crumbs visible near island, morning light from east-facing window, clean contemporary design, no humans, no product, photorealistic",
    },
    {
      name: "Bedroom Carpet",
      imagePrompt: "Bright airy bedroom with plush charcoal grey carpet, large windows with sheer curtains letting in natural light, minimal modern decor, no humans, no product, photorealistic interior",
    },
  ];

  const envResults = await Promise.all(
    envList.map(async (env) => {
      // Sanitize the imagePrompt — remove brand/product names that could cause wrong-image generation
      const cleanedPrompt = sanitizeEnvPrompt(env.imagePrompt || env.name, project.brandName, project.productName || project.productPageTitle);
      // Environment prompts describe the ROOM only — no brand, no product, no animals
      const envPrompt = `${cleanedPrompt}. Shot on ARRI ALEXA, 35mm lens, cinematic composition, realistic lighting, commercial interior photography quality.`;
      const url = await generateAIImage(envPrompt, 1024, 768, Math.floor(Math.random() * 999));
      if (!url) return null;
      return {
        url,
        caption: `Environment: ${env.name}`,
        type: "ai-environment" as const,
        source: "ai-generated" as const,
        environmentName: env.name,
        verified: false,
      };
    })
  );
  allImages.push(...(envResults.filter(r => r !== null) as ProductImageRecord[]));

  await prisma.brand.update({
    where: { projectId },
    data: { productImages: allImages as never },
  });

  const noProductImages = allImages.filter(i => i.type !== "ai-environment").length === 0;

  const summary = {
    total: allImages.length,
    userUploaded: allImages.filter(i => i.verified).length,
    fromProductPage: allImages.filter(i => i.source === "brand-website" && !i.verified).length,
    environment: allImages.filter(i => i.type === "ai-environment").length,
    noProductImages,
    message: noProductImages
      ? "No product images found. Please upload product photos directly using the upload button, or provide a specific product page URL (e.g. Amazon listing or DTC product page)."
      : undefined,
  };

  return NextResponse.json({ productImages: allImages, summary });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const body = await req.json().catch(() => ({}));

  const updateData: Record<string, unknown> = {};
  if ("productVerified" in body) updateData.productVerified = body.productVerified;
  if ("productDescription" in body) updateData.productDescription = body.productDescription;
  if ("productCategory" in body) updateData.productCategory = body.productCategory;
  if ("displayGuidelines" in body) updateData.displayGuidelines = body.displayGuidelines;
  if ("productImages" in body) updateData.productImages = body.productImages;

  const brand = await prisma.brand.update({
    where: { projectId },
    data: updateData,
  });

  return NextResponse.json(brand);
}
