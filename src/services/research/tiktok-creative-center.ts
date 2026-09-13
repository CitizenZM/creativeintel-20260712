import { cached } from "@/services/cache";
import { fetchWithRetry } from "./http";

export interface TikTokAd {
  adId: string;
  title: string;
  brand: string;
  industry?: string;
  region?: string;
  format?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  ctr?: number;
  cvr?: number;
  impressions?: number;
  firstSeenAt?: string;
  lastSeenAt?: string;
  rawData?: unknown;
}

export interface TikTokSearchOptions {
  region?: string;
  industry?: string;
  period?: 7 | 30 | 120;
  limit?: number;
  /** Advertiser or brand keyword. Omit for the brand-agnostic `for_you` feed. */
  keyword?: string;
}

const BASE = "https://ads.tiktok.com/business/creativecenter/inspiration/popular/pc/en";
const API_BASE = "https://ads.tiktok.com/creative_radar_api/v1";

export async function searchTikTokTopAds(
  options: TikTokSearchOptions = {}
): Promise<TikTokAd[]> {
  const region = (options.region ?? process.env.TIKTOK_CREATIVE_CENTER_REGION ?? "US").toUpperCase();
  const period = options.period ?? 30;
  const limit = Math.min(options.limit ?? 20, 50);

  const keyword = options.keyword?.trim() || "";

  return cached(
    {
      kind: "tiktok:top_ads",
      params: {
        region,
        period,
        industry: options.industry ?? null,
        limit,
        keyword: keyword || null,
      },
      ttlSec: 60 * 60 * 6,
      schemaVersion: 2,
    },
    async () => {
      const params = new URLSearchParams({
        period: String(period),
        page: "1",
        limit: String(limit),
        country_code: region,
        // A keyword query must be ordered by relevance, not the personalized feed.
        order_by: keyword ? "ctr" : "for_you",
      });
      if (options.industry) params.set("industry", options.industry);
      if (keyword) {
        params.set("keyword", keyword);
        params.set("ad_language", "en");
      }

      const url = `${API_BASE}/top_ads/v2/list?${params.toString()}`;

      try {
        const res = await fetchWithRetry(
          url,
          {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
              Accept: "application/json, text/plain, */*",
              "Accept-Language": "en-US,en;q=0.9",
              Referer: BASE,
            },
          },
          { timeoutMs: 15000 }
        );

        if (!res.ok) {
          throw new TikTokCreativeCenterError(
            `Creative Center returned HTTP ${res.status}`
          );
        }

        const json = (await res.json().catch(() => null)) as {
          code?: number;
          msg?: string;
          data?: { materials?: TikTokRawAd[] };
        } | null;

        // This endpoint answers HTTP 200 even when it refuses the request —
        // an unauthenticated server-to-server fetch reliably gets back
        // `{"code":40101,"msg":"no permission"}` (confirmed against
        // production, 2026-09-13). Treat any non-zero `code` as a failure,
        // not "ran, found nothing" — the two are not the same thing.
        if (json && typeof json.code === "number" && json.code !== 0) {
          throw new TikTokCreativeCenterError(
            `Creative Center refused the request: ${json.msg || `code ${json.code}`} — this endpoint requires a logged-in session and cannot be called directly from a server; route it through the local browser worker instead.`
          );
        }

        const materials = json?.data?.materials ?? [];
        return materials.map(mapRawAd);
      } catch (err) {
        // Surface the failure so callers can record "failed", not "found none".
        if (err instanceof TikTokCreativeCenterError) throw err;
        throw new TikTokCreativeCenterError(
          err instanceof Error ? err.message : "Creative Center request failed"
        );
      }
    }
  );
}

/** Distinguishes a Creative Center transport/auth failure from an empty result. */
export class TikTokCreativeCenterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TikTokCreativeCenterError";
  }
}

interface TikTokRawAd {
  id?: string;
  ad_title?: string;
  brand_name?: string;
  industry?: string;
  country_code?: string;
  ad_format?: string;
  video_info?: { video_url?: string; cover_url?: string };
  cover?: string;
  metrics?: { ctr?: number; cvr?: number; play_total?: number };
  first_show_date?: string;
  last_show_date?: string;
}

function mapRawAd(raw: TikTokRawAd): TikTokAd {
  return {
    adId: raw.id ?? "",
    title: raw.ad_title ?? "(untitled)",
    brand: raw.brand_name ?? "",
    industry: raw.industry,
    region: raw.country_code,
    format: raw.ad_format,
    videoUrl: raw.video_info?.video_url,
    thumbnailUrl: raw.video_info?.cover_url ?? raw.cover,
    ctr: raw.metrics?.ctr,
    cvr: raw.metrics?.cvr,
    impressions: raw.metrics?.play_total,
    firstSeenAt: raw.first_show_date,
    lastSeenAt: raw.last_show_date,
    rawData: raw,
  };
}
