/**
 * Generic adapter — JSON-LD Product first, then OpenGraph, then the original
 * DOM heuristics. Always matches, so it is the dispatcher's last resort.
 */
import * as cheerio from "cheerio";
import {
  bestImageUrl,
  cleanText,
  fetchHtml,
  findProductNode,
  scoreImage,
  stripHtml,
  type CheerioEl,
} from "./shared";
import type { ProductAdapter, ProductPageData, ProductPageImage } from "./types";

const PRODUCT_SELECTORS = [
  ".product__media img",
  ".product-media img",
  "[data-product-image] img",
  ".product-image img",
  ".pdp-image img",
  ".product-gallery img",
  ".product-photo img",
  '[class*="product-image"] img',
  '[class*="ProductImage"] img',
  '[class*="product_image"] img',
  ".swiper-slide img",
  ".slick-slide img",
];

function asStringList(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return value.flatMap((v) => {
      if (typeof v === "string") return [v];
      if (v && typeof v === "object") {
        const url = (v as Record<string, unknown>).url ?? (v as Record<string, unknown>).contentUrl;
        return typeof url === "string" ? [url] : [];
      }
      return [];
    });
  }
  if (value && typeof value === "object") {
    const url = (value as Record<string, unknown>).url ?? (value as Record<string, unknown>).contentUrl;
    return typeof url === "string" ? [url] : [];
  }
  return [];
}

function nameOf(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const name = (value as Record<string, unknown>).name;
    if (typeof name === "string") return name;
  }
  return undefined;
}

function priceOf(node: Record<string, unknown>): string | undefined {
  const offers = node.offers;
  const first = Array.isArray(offers) ? offers[0] : offers;
  if (first && typeof first === "object") {
    const p = (first as Record<string, unknown>).price ?? (first as Record<string, unknown>).lowPrice;
    if (typeof p === "string" || typeof p === "number") return String(p);
  }
  return undefined;
}

export const genericAdapter: ProductAdapter = {
  name: "generic",

  matches(): boolean {
    return true;
  },

  async scrape(rawUrl: string): Promise<ProductPageData> {
    const { html, finalUrl } = await fetchHtml(rawUrl);
    const $ = cheerio.load(html);

    const ld = findProductNode($);

    // Remove noise after JSON-LD extraction (script tags carry the structured data)
    $("style, noscript, iframe, nav, footer, header").remove();

    // ── Title ──
    const title = cleanText(
      (ld && typeof ld.name === "string" ? ld.name : "") ||
        $('meta[property="og:title"]').attr("content") ||
        $('meta[name="twitter:title"]').attr("content") ||
        $('[data-automation="product-name"]').first().text() ||
        $("h1").first().text() ||
        $("title").text(),
      300
    );

    // ── Images ──
    const seen = new Set<string>();
    const candidates: { url: string; alt: string; score: number }[] = [];

    const pushAbsolute = (src: string, alt: string, bonus: number) => {
      try {
        const abs = new URL(src.startsWith("//") ? `https:${src}` : src, finalUrl).toString();
        if (seen.has(abs)) return;
        seen.add(abs);
        candidates.push({ url: abs, alt, score: scoreImage(abs, alt, { title }) + bonus });
      } catch {
        // skip unparsable src
      }
    };

    if (ld) for (const src of asStringList(ld.image)) pushAbsolute(src, title, 25);

    const ogImage = $('meta[property="og:image"]').attr("content");
    if (ogImage) pushAbsolute(ogImage, title, 12);

    for (const sel of PRODUCT_SELECTORS) {
      $(sel).each((_, el) => {
        const imgUrl = bestImageUrl(el as CheerioEl, $, finalUrl);
        if (!imgUrl) return;
        pushAbsolute(imgUrl, $(el).attr("alt") || "", 10);
      });
    }

    if (candidates.length < 3) {
      $("img").each((_, el) => {
        const imgUrl = bestImageUrl(el as CheerioEl, $, finalUrl);
        if (!imgUrl || seen.has(imgUrl)) return;
        const alt = $(el).attr("alt") || "";
        const s = scoreImage(imgUrl, alt, { title });
        if (s > 0) {
          seen.add(imgUrl);
          candidates.push({ url: imgUrl, alt, score: s });
        }
      });
    }

    candidates.sort((a, b) => b.score - a.score);
    const images: ProductPageImage[] = candidates.slice(0, 6).map((c) => ({ url: c.url, alt: c.alt }));

    // ── Description ──
    const description =
      (ld && typeof ld.description === "string" ? stripHtml(ld.description, 1000) : "") ||
      cleanText($('meta[name="description"]').attr("content"), 1000) ||
      cleanText($('meta[property="og:description"]').attr("content"), 1000) ||
      cleanText($('[data-automation="product-description"]').text(), 1000) ||
      cleanText($(".product-description").text(), 1000) ||
      cleanText($(".product__description").text(), 1000) ||
      cleanText($("#productDescription").text(), 1000) ||
      cleanText($('[class*="description"]').first().text(), 1000);

    // ── Features ──
    const features: string[] = [];
    for (const sel of [
      "#feature-bullets li",
      ".product-features li",
      ".product__features li",
      '[class*="feature"] li',
      '[class*="benefit"] li',
    ]) {
      $(sel).each((_, el) => {
        const text = cleanText($(el).text(), 300);
        if (text && text.length > 10) features.push(text);
      });
      if (features.length > 0) break;
    }

    const price =
      (ld ? priceOf(ld) : undefined) ||
      $('meta[property="product:price:amount"]').attr("content") ||
      cleanText($(".price").first().text(), 20) ||
      undefined;

    const brand =
      (ld ? nameOf(ld.brand) : undefined) ||
      $('meta[property="product:brand"]').attr("content") ||
      cleanText($('[data-automation="brand-name"]').text(), 80) ||
      undefined;

    const sku = ld && typeof ld.sku === "string" ? ld.sku : undefined;

    if (!title && images.length === 0 && !description) {
      throw new Error("Page had no product title, images, or description (JS-rendered store?)");
    }

    return { title, images, description, features: features.slice(0, 10), price, brand, sku };
  },
};
