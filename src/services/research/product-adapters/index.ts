/**
 * Product URL adapter chain. Adapters that claim the URL run first; the generic
 * adapter always runs last. Every attempt is reported so the UI can say which
 * adapter tried and why it failed.
 */
import { assertSafeUrl } from "@/lib/safe-fetch";
import { amazonAdapter } from "./amazon";
import { genericAdapter } from "./generic";
import { shopifyAdapter } from "./shopify";
import { isUsable, type AdapterAttempt, type ProductAdapter, type ScrapeOutcome } from "./types";

export * from "./types";
export { amazonAdapter, genericAdapter, shopifyAdapter };

const ADAPTERS: ProductAdapter[] = [shopifyAdapter, amazonAdapter, genericAdapter];

export async function runProductAdapters(rawUrl: string): Promise<ScrapeOutcome> {
  const attempts: AdapterAttempt[] = [];

  let url: URL;
  try {
    url = await assertSafeUrl(rawUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid URL";
    return { data: null, adapter: null, attempts: [{ adapter: "url-check", ok: false, error: message }], error: message };
  }

  const matching = ADAPTERS.filter((a) => a.name !== "generic" && a.matches(url));
  const chain = [...matching, genericAdapter];

  for (const adapter of chain) {
    try {
      const data = await adapter.scrape(rawUrl);
      if (isUsable(data)) {
        attempts.push({ adapter: adapter.name, ok: true });
        return { data, adapter: adapter.name, attempts };
      }
      attempts.push({ adapter: adapter.name, ok: false, error: "No usable product data found" });
    } catch (err) {
      attempts.push({
        adapter: adapter.name,
        ok: false,
        error: err instanceof Error ? err.message : "Adapter failed",
      });
    }
  }

  const lastError = attempts.filter((a) => !a.ok).map((a) => `${a.adapter}: ${a.error}`).join(" · ");
  return {
    data: null,
    adapter: null,
    attempts,
    error: lastError || "No adapter could read this product page",
  };
}
