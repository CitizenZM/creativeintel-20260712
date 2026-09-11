/**
 * Product page scraper — the PRIMARY source of product truth.
 *
 * The extraction logic now lives in ./product-adapters (shopify → amazon →
 * generic). This module keeps the historical `scrapeProductPage` entry point
 * for existing callers and adds `scrapeProductPageDetailed` for callers that
 * need the adapter name and per-adapter failure reasons.
 */
import { runProductAdapters } from "./product-adapters";
import type { ProductPageData, ScrapeOutcome } from "./product-adapters/types";

export type { ProductPageData, ScrapeOutcome };
export type { AdapterAttempt, ProductPageImage } from "./product-adapters/types";

/** Full outcome: data (or null) plus which adapters ran and why they failed. */
export async function scrapeProductPageDetailed(url: string): Promise<ScrapeOutcome> {
  return runProductAdapters(url);
}

/** Throwing variant kept for existing callers. */
export async function scrapeProductPage(url: string): Promise<ProductPageData> {
  const outcome = await runProductAdapters(url);
  if (!outcome.data) throw new Error(outcome.error || "Failed to read product page");
  return outcome.data;
}
