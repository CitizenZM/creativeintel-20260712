export interface ProductPageImage {
  url: string;
  alt: string;
  width?: number;
  height?: number;
}

export interface ProductPageData {
  title: string;
  images: ProductPageImage[];
  description: string;
  features: string[];
  price?: string;
  brand?: string;
  sku?: string;
  currency?: string;
}

export interface AdapterAttempt {
  adapter: string;
  ok: boolean;
  error?: string;
}

export interface ProductAdapter {
  name: string;
  /** Cheap URL/shape test — the dispatcher only runs adapters that claim the URL. */
  matches(url: URL): boolean;
  scrape(url: string): Promise<ProductPageData>;
}

export interface ScrapeOutcome {
  data: ProductPageData | null;
  adapter: string | null;
  attempts: AdapterAttempt[];
  error?: string;
}

export function isUsable(data: ProductPageData | null): data is ProductPageData {
  if (!data) return false;
  return !!data.title.trim() || data.images.length > 0 || !!data.description.trim();
}
