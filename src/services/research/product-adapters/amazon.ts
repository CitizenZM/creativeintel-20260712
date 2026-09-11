/**
 * Amazon adapter — /dp/ and /gp/product/ listings. Keeps the historical
 * Amazon-specific selectors and the hi-res image URL rewrite.
 */
import * as cheerio from "cheerio";
import { bestImageUrl, cleanText, fetchHtml, scoreImage, type CheerioEl } from "./shared";
import type { ProductAdapter, ProductPageData } from "./types";

const ASIN_RE = /\/(?:dp|gp\/product|gp\/aw\/d|product)\/([A-Z0-9]{10})(?:[/?]|$)/i;

export function extractAsin(url: URL): string | null {
  const fromPath = url.pathname.match(ASIN_RE);
  if (fromPath) return fromPath[1].toUpperCase();
  const fromQuery = url.searchParams.get("asin");
  return fromQuery && /^[A-Z0-9]{10}$/i.test(fromQuery) ? fromQuery.toUpperCase() : null;
}

const IMAGE_SELECTORS = [
  "#imgTagWrapperId img",
  "#main-image-container img",
  "#altImages img",
  ".imgTagWrapper img",
  "[data-a-image-name] img",
  "#landingImage",
];

function hiRes(imgUrl: string): string {
  return imgUrl
    .replace(/\._[A-Z]+_\./g, ".")
    .replace(/_SY[\d]+_|_SX[\d]+_|_SS[\d]+_|_SR[\d]+,[\d]+_/g, "");
}

export const amazonAdapter: ProductAdapter = {
  name: "amazon",

  matches(url: URL): boolean {
    if (!/(^|\.)amazon\.[a-z.]+$/i.test(url.hostname)) {
      return !!extractAsin(url) && /\/(dp|gp\/product)\//i.test(url.pathname);
    }
    return true;
  },

  async scrape(rawUrl: string): Promise<ProductPageData> {
    const url = new URL(rawUrl);
    const asin = extractAsin(url);
    const { html, finalUrl } = await fetchHtml(rawUrl);
    const $ = cheerio.load(html);

    if ($("form[action*='validateCaptcha']").length || /api-services-support@amazon/.test($("title").text())) {
      throw new Error("Amazon served a bot-check page instead of the listing");
    }

    const title =
      cleanText($("#productTitle").first().text(), 300) ||
      cleanText($('meta[property="og:title"]').attr("content"), 300) ||
      cleanText($("h1").first().text(), 300);

    const seen = new Set<string>();
    const candidates: { url: string; alt: string; score: number }[] = [];
    for (const sel of IMAGE_SELECTORS) {
      $(sel).each((_, el) => {
        const imgUrl = bestImageUrl(el as CheerioEl, $, finalUrl);
        if (!imgUrl || seen.has(imgUrl)) return;
        const full = hiRes(imgUrl);
        if (seen.has(full)) return;
        seen.add(full);
        seen.add(imgUrl);
        const alt = $(el).attr("alt") || "";
        candidates.push({ url: full, alt, score: scoreImage(full, alt, { title }) + 15 });
      });
    }

    // Amazon embeds the full gallery in a JS blob on the page
    const galleryMatch = html.match(/"hiRes":"(https:\\?\/\\?\/[^"]+?)"/g) || [];
    for (const raw of galleryMatch.slice(0, 8)) {
      const found = raw.match(/"hiRes":"(.+)"/);
      if (!found) continue;
      const clean = found[1].replace(/\\\//g, "/");
      if (seen.has(clean)) continue;
      seen.add(clean);
      candidates.push({ url: clean, alt: title, score: scoreImage(clean, title, { title }) + 12 });
    }

    candidates.sort((a, b) => b.score - a.score);
    const images = candidates.slice(0, 6).map((c) => ({ url: c.url, alt: c.alt }));

    const features: string[] = [];
    $("#feature-bullets li, #featurebullets_feature_div li").each((_, el) => {
      const text = cleanText($(el).text(), 300);
      if (text && text.length > 10) features.push(text);
    });

    const description =
      cleanText($("#productDescription").text(), 1000) ||
      cleanText($('meta[name="description"]').attr("content"), 1000) ||
      features.slice(0, 3).join(" ");

    const price =
      cleanText($(".a-price .a-offscreen").first().text(), 20) ||
      cleanText($("#priceblock_ourprice").first().text(), 20) ||
      undefined;

    const brand =
      cleanText($("#bylineInfo").first().text(), 80) ||
      cleanText($('a[href*="/stores/"]').first().text(), 80) ||
      undefined;

    if (!title && images.length === 0) throw new Error("Amazon listing returned no title or images");

    return {
      title,
      images,
      description,
      features: features.slice(0, 10),
      price,
      brand,
      sku: asin || undefined,
    };
  },
};
