/**
 * Shopify adapter — uses the storefront's own product JSON endpoint
 * ({origin}/products/{handle}.json, falling back to .js) instead of scraping,
 * which is what makes SPA-rendered Shopify themes work at all.
 */
import { fetchJson } from "./shared";
import type { ProductAdapter, ProductPageData, ProductPageImage } from "./types";

const HANDLE_RE = /\/products\/([^/?#]+)/;

interface ShopifyImage {
  src?: string;
  url?: string;
  alt?: string | null;
  width?: number;
  height?: number;
}

interface ShopifyVariant {
  price?: string | number;
  sku?: string;
  title?: string;
}

interface ShopifyProduct {
  title?: string;
  body_html?: string;
  description?: string;
  vendor?: string;
  images?: (ShopifyImage | string)[];
  featured_image?: string | ShopifyImage;
  variants?: ShopifyVariant[];
  price?: number;
}

export function shopifyHandle(url: URL): string | null {
  const match = url.pathname.match(HANDLE_RE);
  return match ? match[1] : null;
}

function normalizeImages(product: ShopifyProduct, origin: string): ProductPageImage[] {
  const raw: (ShopifyImage | string)[] = [];
  if (product.featured_image) raw.push(product.featured_image);
  if (Array.isArray(product.images)) raw.push(...product.images);

  const seen = new Set<string>();
  const out: ProductPageImage[] = [];
  for (const item of raw) {
    const src = typeof item === "string" ? item : item.src || item.url;
    if (!src) continue;
    let abs: string;
    try {
      abs = new URL(src.startsWith("//") ? `https:${src}` : src, origin).toString();
    } catch {
      continue;
    }
    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push({
      url: abs,
      alt: (typeof item === "string" ? "" : item.alt || "") ?? "",
      width: typeof item === "string" ? undefined : item.width,
      height: typeof item === "string" ? undefined : item.height,
    });
    if (out.length >= 8) break;
  }
  return out;
}

function toFeatures(bodyHtml: string): string[] {
  const items = [...bodyHtml.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) =>
    m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
  );
  return items.filter((t) => t.length > 10 && t.length < 300).slice(0, 10);
}

async function loadProduct(origin: string, handle: string): Promise<ShopifyProduct> {
  const errors: string[] = [];

  try {
    const json = (await fetchJson(`${origin}/products/${handle}.json`)) as { product?: ShopifyProduct };
    if (json?.product?.title) return json.product;
    errors.push("products/.json returned no product");
  } catch (e) {
    errors.push(e instanceof Error ? e.message : "products/.json failed");
  }

  try {
    const json = (await fetchJson(`${origin}/products/${handle}.js`)) as ShopifyProduct;
    if (json?.title) return json;
    errors.push("products/.js returned no product");
  } catch (e) {
    errors.push(e instanceof Error ? e.message : "products/.js failed");
  }

  throw new Error(errors.join("; "));
}

export const shopifyAdapter: ProductAdapter = {
  name: "shopify",

  matches(url: URL): boolean {
    return HANDLE_RE.test(url.pathname);
  },

  async scrape(rawUrl: string): Promise<ProductPageData> {
    const url = new URL(rawUrl);
    const handle = shopifyHandle(url);
    if (!handle) throw new Error("URL does not contain a /products/<handle> path");

    const product = await loadProduct(url.origin, handle);
    const bodyHtml = product.body_html || product.description || "";
    const description = bodyHtml
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 1000);

    const variant = product.variants?.[0];
    const rawPrice = variant?.price ?? product.price;
    const price =
      typeof rawPrice === "number"
        ? (rawPrice / 100).toFixed(2) // the .js endpoint returns cents
        : rawPrice
          ? String(rawPrice)
          : undefined;

    return {
      title: (product.title || "").trim(),
      images: normalizeImages(product, url.origin),
      description,
      features: toFeatures(bodyHtml),
      price,
      brand: product.vendor || undefined,
      sku: variant?.sku || undefined,
    };
  },
};
