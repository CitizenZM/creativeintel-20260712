/**
 * Product feed parsers → normalized CatalogProduct records. No new packages: cheerio (a direct
 * dependency) reads the Google Merchant RSS/Atom XML in xmlMode and decodes HTML; CSV/TSV is a small
 * RFC 4180 reader (quotes, escaped quotes, embedded commas/newlines, CRLF, BOM).
 *
 *   shopify      {origin}/products.json — one record per product (first available variant's price;
 *                compare_at_price > price → price = compare_at, salePrice = price)
 *   google-xml   RSS 2.0 <item> / Atom <entry> with the g: namespace
 *   google-tsv   Merchant Center tab-separated upload (same attribute names)
 *   meta-csv     Meta (Facebook) catalog CSV (id, title, availability, condition, price, link, image_link …)
 *   generic-csv  anything else with a header row: common aliases (sku/name/price/image …), Shopify
 *                product-export image rows merged by Handle
 *
 * Normalization: prices parsed from "29.99 USD" / "$1,299.00" / "1.299,50 EUR"; a sale price that is
 * not below the regular price is dropped (warning); HTML stripped with list items kept apart;
 * availability mapped to one vocabulary; images made absolute and de-duplicated; the first record of
 * a duplicate SKU wins. Pure.
 */
import * as cheerio from "cheerio";
import type { Availability, CatalogProduct, FeedFormat, FeedParseResult, FeedSkip } from "./types";

/* ───────────────────────── primitives ───────────────────────── */

const SYMBOLS: Record<string, string> = { $: "USD", "€": "EUR", "£": "GBP", "¥": "JPY", "₹": "INR", "₩": "KRW" };

export function parsePrice(raw: unknown): { amount: number | null; currency: string | null } {
  if (typeof raw === "number") return { amount: Number.isFinite(raw) ? raw : null, currency: null };
  const s = String(raw ?? "").trim();
  if (!s) return { amount: null, currency: null };
  const code = s.match(/\b([A-Z]{3})\b/)?.[1] ?? null;
  const sym = Object.keys(SYMBOLS).find((k) => s.includes(k));
  const currency = code ?? (sym ? SYMBOLS[sym] : null);
  const num = s.match(/\d[\d.,\s]*/)?.[0]?.replace(/\s+/g, "") ?? "";
  if (!num) return { amount: null, currency: null };
  let normalized = num;
  const lastDot = num.lastIndexOf(".");
  const lastComma = num.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    // Whichever comes last is the decimal separator.
    normalized = lastComma > lastDot ? num.replace(/\./g, "").replace(",", ".") : num.replace(/,/g, "");
  } else if (lastComma >= 0) {
    // "12,5" / "12,50" decimal comma; "1,299" thousands.
    normalized = /,\d{1,2}$/.test(num) ? num.replace(",", ".") : num.replace(/,/g, "");
  }
  const amount = Number.parseFloat(normalized);
  return Number.isFinite(amount) ? { amount: Math.round(amount * 100) / 100, currency } : { amount: null, currency: null };
}

const BLOCK = /^(p|div|li|br|tr|h[1-6]|ul|ol|section|article|table|dd|dt|blockquote)$/i;

/** HTML → plain text: tags dropped, entities decoded, block elements become sentence breaks. */
export function stripHtml(html: string | null | undefined): string {
  const src = String(html ?? "");
  if (!src.trim()) return "";
  if (!/[<&]/.test(src)) return squash(src);
  const marked = src.replace(/<\s*(\/?)\s*([a-z0-9]+)[^>]*>/gi, (_m, _close: string, tag: string) => (BLOCK.test(tag) ? "\u0001" : ""));
  const text = cheerio.load(`<div>${marked.replace(/</g, "&lt;")}</div>`, null, false).text();
  return text
    .split("\u0001")
    .map(squash)
    .filter(Boolean)
    .reduce((out, seg) => (out ? `${out}${/[.!?:;]$/.test(out) ? " " : ". "}${seg}` : seg), "");
}

/** List items of an HTML description (features). */
export function listItems(html: string | null | undefined): string[] {
  return [...String(html ?? "").matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => stripHtml(m[1])).filter((t) => t.length > 2 && t.length < 300).slice(0, 12);
}

export function normalizeAvailability(raw: unknown): Availability {
  if (raw === true) return "in_stock";
  if (raw === false) return "out_of_stock";
  const s = String(raw ?? "").toLowerCase().replace(/[\s_-]+/g, "");
  if (!s) return "unknown";
  if (/outofstock|soldout|discontinued|unavailable/.test(s)) return "out_of_stock";
  if (/preorder/.test(s)) return "preorder";
  if (/backorder/.test(s)) return "backorder";
  if (/instock|availablefororder|available|limitedavailability|true|yes/.test(s)) return "in_stock";
  return "unknown";
}

const squash = (s: string | null | undefined) => String(s ?? "").replace(/\s+/g, " ").trim();

function absUrl(src: string | null | undefined, base?: string | null): string | null {
  const s = squash(src);
  if (!s) return null;
  try {
    return new URL(s.startsWith("//") ? `https:${s}` : s, base ?? undefined).toString();
  } catch {
    return null;
  }
}

/** RFC 4180 rows (quotes, "" escapes, embedded delimiters / newlines, CRLF, BOM). */
export function parseCsv(text: string, delimiter = ","): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') (field += '"'), i++;
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === "") quoted = true;
    else if (c === delimiter) row.push(field), (field = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) row.push(field), rows.push(row);
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

/* ───────────────────────── detection ───────────────────────── */

const headerOf = (text: string, delimiter: string) => (parseCsv(text.split(/\r?\n/, 1)[0] ?? "", delimiter)[0] ?? []).map((h) => normKey(h));
const normKey = (h: string) => h.trim().toLowerCase().replace(/^g:/, "").replace(/[\s-]+/g, "_").replace(/[()]/g, "");

export function detectFeedFormat(text: string): FeedFormat {
  const t = text.replace(/^\uFEFF/, "").trimStart();
  if (t.startsWith("{") || t.startsWith("[")) return "shopify";
  if (t.startsWith("<")) return "google-xml";
  const firstLine = t.split(/\r?\n/, 1)[0] ?? "";
  if (firstLine.includes("\t")) return "google-tsv";
  const head = headerOf(t, ",");
  const merchant = ["id", "title", "price"].every((k) => head.includes(k)) && (head.includes("image_link") || head.includes("link"));
  return merchant ? "meta-csv" : "generic-csv";
}

/* ───────────────────────── record builder ───────────────────────── */

interface RawRecord {
  sku?: string | null;
  title?: string | null;
  descriptionHtml?: string | null;
  price?: unknown;
  salePrice?: unknown;
  currency?: string | null;
  images?: (string | null | undefined)[];
  url?: string | null;
  brand?: string | null;
  category?: string | null;
  availability?: unknown;
  customLabels?: Record<string, string | null | undefined>;
}

class Builder {
  products: CatalogProduct[] = [];
  skipped: FeedSkip[] = [];
  warnings: string[] = [];
  private seen = new Set<string>();
  constructor(readonly opts: ParseOptions) {}

  add(row: number, r: RawRecord) {
    const title = squash(r.title);
    const sku = squash(r.sku);
    if (!title) return void this.skipped.push({ row, ...(sku ? { sku } : {}), reason: "no title" });
    const id = sku || slug(title);
    if (this.seen.has(id)) return void this.skipped.push({ row, sku: id, reason: "duplicate sku" });
    this.seen.add(id);
    const p = parsePrice(r.price);
    const s = parsePrice(r.salePrice);
    let price = p.amount;
    let salePrice = s.amount;
    if (price == null && salePrice != null) (price = salePrice), (salePrice = null);
    if (price != null && salePrice != null && salePrice >= price) {
      if (salePrice > price) this.warnings.push(`${id}: sale price ${salePrice} ≥ price ${price} — sale price dropped`);
      salePrice = null;
    }
    const currency = (squash(r.currency) || p.currency || s.currency || this.opts.currency || "").toUpperCase() || null;
    const images = [...new Set((r.images ?? []).map((u) => absUrl(u, this.opts.sourceUrl)).filter((u): u is string => !!u))];
    const labels: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.customLabels ?? {})) if (squash(v)) labels[k] = squash(v);
    this.products.push({
      sku: id,
      title,
      description: stripHtml(r.descriptionHtml).slice(0, 2000),
      features: listItems(r.descriptionHtml),
      price,
      salePrice,
      currency,
      images,
      url: absUrl(r.url, this.opts.sourceUrl),
      brand: squash(r.brand) || null,
      category: squash(r.category) || null,
      availability: normalizeAvailability(r.availability),
      customLabels: labels,
    });
  }

  result(format: FeedFormat): FeedParseResult {
    return { format, products: this.products, skipped: this.skipped, warnings: this.warnings };
  }
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

/* ───────────────────────── Shopify ───────────────────────── */

interface ShopifyVariant {
  sku?: string | null;
  price?: string | number | null;
  compare_at_price?: string | number | null;
  available?: boolean;
}
interface ShopifyFeedProduct {
  id?: number | string;
  title?: string;
  handle?: string;
  body_html?: string | null;
  vendor?: string | null;
  product_type?: string | null;
  tags?: string[] | string | null;
  variants?: ShopifyVariant[];
  images?: ({ src?: string } | string)[];
}

function parseShopify(text: string, b: Builder) {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Shopify feed is not valid JSON (expected /products.json)");
  }
  const list = (Array.isArray(json) ? json : (json as { products?: unknown })?.products) as ShopifyFeedProduct[] | undefined;
  if (!Array.isArray(list)) throw new Error("Shopify feed has no products[] (expected /products.json)");
  const origin = b.opts.sourceUrl ? safeOrigin(b.opts.sourceUrl) : null;
  list.forEach((p, i) => {
    const variants = p.variants ?? [];
    const v = variants.find((x) => x.available) ?? variants[0] ?? {};
    const price = parsePrice(v.price ?? null).amount;
    const compare = parsePrice(v.compare_at_price ?? null).amount;
    const onSale = price != null && compare != null && compare > price;
    const tags = Array.isArray(p.tags) ? p.tags.join(", ") : (p.tags ?? "");
    b.add(i + 1, {
      sku: v.sku || p.handle || (p.id != null ? String(p.id) : null),
      title: p.title,
      descriptionHtml: p.body_html,
      price: onSale ? compare : price,
      salePrice: onSale ? price : null,
      images: (p.images ?? []).map((im) => (typeof im === "string" ? im : im.src)),
      url: origin && p.handle ? `${origin}/products/${p.handle}` : null,
      brand: p.vendor,
      category: p.product_type,
      availability: variants.length ? variants.some((x) => x.available) : "unknown",
      customLabels: { tags },
    });
  });
}

function safeOrigin(u: string): string | null {
  try {
    return new URL(u).origin;
  } catch {
    return null;
  }
}

/* ───────────────────────── Google Merchant XML ───────────────────────── */

const LABELS = ["custom_label_0", "custom_label_1", "custom_label_2", "custom_label_3", "custom_label_4"];

function parseGoogleXml(text: string, b: Builder) {
  const $ = cheerio.load(text, { xml: true });
  const nodes = $("item, entry").toArray();
  if (!nodes.length && !$("rss, feed").length) throw new Error("Google Merchant feed has no <item> / <entry> elements");
  nodes.forEach((node, i) => {
    const fields = new Map<string, string[]>();
    $(node)
      .children()
      .each((_, c) => {
        const el = c as unknown as { tagName?: string; name?: string };
        const key = normKey(el.tagName ?? el.name ?? "");
        const val = key === "link" && !$(c).text().trim() ? ($(c).attr("href") ?? "") : $(c).text();
        fields.set(key, [...(fields.get(key) ?? []), val]);
      });
    const one = (k: string) => fields.get(k)?.find((v) => v.trim()) ?? null;
    merchantRecord(b, i + 1, one, (k) => fields.get(k) ?? []);
  });
}

/** Google / Meta attribute names → record (shared by XML, TSV and Meta CSV). */
function merchantRecord(b: Builder, row: number, one: (k: string) => string | null, all: (k: string) => string[]) {
  const extra = all("additional_image_link").flatMap((v) => v.split(/,(?=\s*(?:https?:)?\/\/)/));
  const effective = one("sale_price_effective_date");
  const labels: Record<string, string | null> = {};
  for (const k of LABELS) labels[k] = one(k);
  labels.product_type = one("product_type");
  labels.item_group_id = one("item_group_id");
  labels.condition = one("condition") && one("condition") !== "new" ? one("condition") : null;
  if (effective?.includes("/")) labels.sale_ends = effective.split("/")[1].trim();
  b.add(row, {
    sku: one("id"),
    title: one("title"),
    descriptionHtml: one("description"),
    price: one("price"),
    salePrice: one("sale_price"),
    images: [one("image_link"), ...extra],
    url: one("link"),
    brand: one("brand"),
    category: one("google_product_category") ?? one("fb_product_category") ?? one("product_type"),
    availability: one("availability"),
    customLabels: labels,
  });
}

/* ───────────────────────── CSV / TSV ───────────────────────── */

function tableRows(text: string, delimiter: string): { head: string[]; rows: string[][] } {
  const rows = parseCsv(text, delimiter);
  if (rows.length < 2) throw new Error("Feed has a header but no product rows");
  return { head: rows[0].map(normKey), rows: rows.slice(1) };
}

function parseMerchantTable(text: string, delimiter: string, b: Builder) {
  const { head, rows } = tableRows(text, delimiter);
  rows.forEach((r, i) => {
    const all = (k: string) => head.flatMap((h, j) => (h === k && r[j]?.trim() ? [r[j]] : []));
    merchantRecord(b, i + 1, (k) => all(k)[0] ?? null, all);
  });
}

/** Generic CSV column aliases (normalized header → field). */
const ALIASES: Record<keyof Omit<RawRecord, "images" | "customLabels"> | "image" | "handle" | "compareAt", string[]> = {
  sku: ["sku", "variant_sku", "id", "product_id", "item_id", "mpn", "gtin", "asin"],
  title: ["title", "name", "product_name", "product_title", "item_name"],
  descriptionHtml: ["description", "body_html", "body_html", "body", "product_description", "long_description"],
  price: ["price", "regular_price", "variant_price", "list_price", "msrp"],
  salePrice: ["sale_price", "special_price", "discount_price", "offer_price"],
  compareAt: ["compare_at_price", "variant_compare_at_price"],
  currency: ["currency", "currency_code"],
  image: ["image", "image_url", "image_link", "image_src", "images", "main_image", "picture", "photo", "additional_image_link"],
  url: ["url", "link", "product_url", "product_link", "permalink"],
  brand: ["brand", "vendor", "manufacturer"],
  category: ["category", "type", "product_type", "google_product_category", "categories"],
  availability: ["availability", "stock", "in_stock", "stock_status", "inventory"],
  handle: ["handle"],
};

function parseGenericCsv(text: string, b: Builder) {
  const delimiter = (text.split(/\r?\n/, 1)[0] ?? "").split(";").length > (text.split(/\r?\n/, 1)[0] ?? "").split(",").length ? ";" : ",";
  const { head, rows } = tableRows(text, delimiter);
  const col = (field: keyof typeof ALIASES) => {
    for (const a of ALIASES[field]) {
      const j = head.indexOf(a);
      if (j >= 0) return j;
    }
    return -1;
  };
  const idx = Object.fromEntries((Object.keys(ALIASES) as (keyof typeof ALIASES)[]).map((k) => [k, col(k)])) as Record<keyof typeof ALIASES, number>;
  const imageCols = head.flatMap((h, j) => (ALIASES.image.includes(h) ? [j] : []));
  const labelCols = head.flatMap((h, j) => (LABELS.includes(h) ? [[h, j] as const] : []));
  if (idx.title < 0) throw new Error("CSV feed has no title / name column");

  // Shopify product exports: extra rows of a handle carry only more images.
  const groups: { row: number; cells: string[]; images: string[] }[] = [];
  const byHandle = new Map<string, (typeof groups)[number]>();
  rows.forEach((r, i) => {
    const get = (j: number) => (j >= 0 ? (r[j] ?? "") : "");
    const images = imageCols.flatMap((j) => get(j).split(/[,|]\s*(?=(?:https?:)?\/\/)/));
    const handle = get(idx.handle).trim();
    const existing = handle ? byHandle.get(handle) : undefined;
    if (existing && !get(idx.title).trim()) return void existing.images.push(...images);
    const g = { row: i + 1, cells: r, images };
    groups.push(g);
    if (handle) byHandle.set(handle, g);
  });
  for (const g of groups) {
    const get = (j: number) => (j >= 0 ? (g.cells[j] ?? "") : "");
    const price = parsePrice(get(idx.price)).amount;
    const compare = parsePrice(get(idx.compareAt)).amount;
    const onSale = price != null && compare != null && compare > price;
    b.add(g.row, {
      sku: get(idx.sku) || get(idx.handle),
      title: get(idx.title),
      descriptionHtml: get(idx.descriptionHtml),
      price: onSale ? compare : get(idx.price),
      salePrice: onSale ? price : get(idx.salePrice),
      currency: get(idx.currency) || parsePrice(get(idx.price)).currency,
      images: g.images,
      url: get(idx.url),
      brand: get(idx.brand),
      category: get(idx.category),
      availability: idx.availability >= 0 ? get(idx.availability) : "",
      customLabels: Object.fromEntries(labelCols.map(([h, j]) => [h, get(j)])),
    });
  }
}

/* ───────────────────────── entry point ───────────────────────── */

export interface ParseOptions {
  format?: FeedFormat;
  /** Where the feed came from: makes relative image / product URLs absolute (Shopify: product URLs). */
  sourceUrl?: string | null;
  /** Default currency when the feed has none (Shopify products.json never does). */
  currency?: string | null;
}

export function parseFeed(text: string, opts: ParseOptions = {}): FeedParseResult {
  if (!text || !text.trim()) throw new Error("Feed is empty");
  const format = opts.format ?? detectFeedFormat(text);
  const b = new Builder(opts);
  if (format === "shopify") parseShopify(text, b);
  else if (format === "google-xml") parseGoogleXml(text, b);
  else if (format === "google-tsv") parseMerchantTable(text, "\t", b);
  else if (format === "meta-csv") parseMerchantTable(text, ",", b);
  else parseGenericCsv(text, b);
  return b.result(format);
}
