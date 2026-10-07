/**
 * Catalog ads (Creatify-style "URL to video" at catalog scale) — shared types.
 * A product feed (Shopify products.json, Google Merchant XML / TSV, Meta catalog CSV, generic CSV)
 * becomes normalized CatalogProduct records; planCatalog turns them into per-SKU image ad sets, one
 * locked video template per category with per-SKU product slots, or a paid per-SKU plan (estimate only).
 */

export type FeedFormat = "shopify" | "google-xml" | "google-tsv" | "meta-csv" | "generic-csv";
export const FEED_FORMATS: FeedFormat[] = ["shopify", "google-xml", "google-tsv", "meta-csv", "generic-csv"];

export type Availability = "in_stock" | "out_of_stock" | "preorder" | "backorder" | "unknown";

export interface CatalogProduct {
  sku: string;
  title: string;
  /** Plain text (HTML stripped, entities decoded). */
  description: string;
  /** Bullet features from the description's list items (may be empty). */
  features: string[];
  /** Regular price. */
  price: number | null;
  /** Only set when strictly below the regular price. */
  salePrice: number | null;
  /** ISO 4217 code when the feed says it. */
  currency: string | null;
  /** Absolute URLs, de-duplicated, main image first. */
  images: string[];
  url: string | null;
  brand: string | null;
  category: string | null;
  availability: Availability;
  /** custom_label_0..4, product_type, tags, item_group_id, sale_ends … */
  customLabels: Record<string, string>;
}

export interface FeedSkip {
  /** 1-based data row / item index in the feed. */
  row: number;
  sku?: string;
  reason: string;
}

export interface FeedParseResult {
  format: FeedFormat;
  products: CatalogProduct[];
  skipped: FeedSkip[];
  warnings: string[];
}

export type CatalogMode = "image" | "video-template" | "video-full";
export const CATALOG_MODES: CatalogMode[] = ["image", "video-template", "video-full"];
