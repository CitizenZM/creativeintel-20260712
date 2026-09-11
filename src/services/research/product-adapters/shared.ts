import * as cheerio from "cheerio";
import { safeFetchText } from "@/lib/safe-fetch";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CheerioEl = any;

export const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
};

export async function fetchHtml(url: string): Promise<{ html: string; finalUrl: string }> {
  const res = await safeFetchText(url, { headers: BROWSER_HEADERS }, { timeoutMs: 15_000 });
  if (!res.ok) throw new Error(res.error || `Failed to fetch page (HTTP ${res.status})`);
  if (!res.text.trim()) throw new Error("Page returned an empty body");
  return { html: res.text, finalUrl: res.finalUrl };
}

export async function fetchJson(url: string): Promise<unknown> {
  const res = await safeFetchText(
    url,
    { headers: { ...BROWSER_HEADERS, Accept: "application/json,text/javascript,*/*" } },
    { timeoutMs: 12_000 }
  );
  if (!res.ok) throw new Error(res.error || `Failed to fetch JSON (HTTP ${res.status})`);
  try {
    return JSON.parse(res.text);
  } catch {
    throw new Error("Response was not valid JSON");
  }
}

/** Resolve an img src/srcset to the largest absolute URL. */
export function bestImageUrl(el: CheerioEl, $: cheerio.CheerioAPI, baseUrl: string): string | null {
  const src = $(el).attr("src") || $(el).attr("data-src") || $(el).attr("data-lazy-src") || "";
  const srcset = $(el).attr("srcset") || $(el).attr("data-srcset") || "";

  let best = src;
  if (srcset) {
    const parts = srcset.split(",").map((s) => s.trim().split(/\s+/));
    const sorted = parts
      .map((p) => ({ url: p[0] || "", w: parseInt(p[1]) || 0 }))
      .sort((a, b) => b.w - a.w);
    if (sorted[0]?.url) best = sorted[0].url;
  }

  if (!best) return null;
  if (best.startsWith("data:")) return null;
  if (best.endsWith(".svg")) return null;
  if (best.includes("placeholder") || best.includes("blank") || best.includes("spacer")) return null;

  try {
    return new URL(best, baseUrl).toString();
  } catch {
    return null;
  }
}

/** Score how product-relevant an image is. */
export function scoreImage(url: string, alt: string, context: { title: string }): number {
  let score = 0;
  const urlL = url.toLowerCase();
  const altL = alt.toLowerCase();
  const titleL = context.title.toLowerCase();

  if (urlL.includes("product") || urlL.includes("pdp") || urlL.includes("item")) score += 8;
  if (urlL.includes("main") || urlL.includes("hero") || urlL.includes("primary")) score += 6;
  if (urlL.includes("01") || urlL.includes("_1") || urlL.includes("-1.")) score += 4;
  if (urlL.includes("media") || urlL.includes("cdn") || urlL.includes("assets")) score += 3;

  if (urlL.includes("ssl-images-amazon") || urlL.includes("m.media-amazon")) score += 10;
  if (urlL.match(/\._[A-Z]+_\./)) score += 8;

  if (urlL.includes("cdn.shopify") || urlL.includes("shopifycdn")) score += 8;

  const titleWords = titleL.split(/\s+/).filter((w) => w.length > 3);
  for (const w of titleWords) {
    if (altL.includes(w)) score += 3;
  }

  if (/\.(jpg|jpeg|webp|png)/i.test(url)) score += 2;

  if (urlL.includes("logo") || urlL.includes("icon") || urlL.includes("banner")) score -= 10;
  if (urlL.includes("avatar") || urlL.includes("profile")) score -= 10;
  if (urlL.includes("badge") || urlL.includes("cert") || urlL.includes("award")) score -= 5;

  return score;
}

export function cleanText(value: string | undefined | null, max = 1000): string {
  if (!value) return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

export function stripHtml(value: string | undefined | null, max = 1500): string {
  if (!value) return "";
  return cleanText(cheerio.load(`<div>${value}</div>`)("div").text(), max);
}

/** Collect every JSON-LD node on the page, flattening @graph containers. */
export function jsonLdNodes($: cheerio.CheerioAPI): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text() || $(el).text();
    if (!raw?.trim()) return;
    try {
      const parsed = JSON.parse(raw.trim());
      const queue: unknown[] = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (queue.length) {
        const node = queue.shift();
        if (!node || typeof node !== "object") continue;
        const obj = node as Record<string, unknown>;
        if (Array.isArray(obj["@graph"])) queue.push(...(obj["@graph"] as unknown[]));
        nodes.push(obj);
      }
    } catch {
      // malformed JSON-LD is common — ignore
    }
  });
  return nodes;
}

export function findProductNode($: cheerio.CheerioAPI): Record<string, unknown> | null {
  for (const node of jsonLdNodes($)) {
    const type = node["@type"];
    const types = Array.isArray(type) ? type : [type];
    if (types.some((t) => typeof t === "string" && t.toLowerCase().includes("product"))) return node;
  }
  return null;
}
