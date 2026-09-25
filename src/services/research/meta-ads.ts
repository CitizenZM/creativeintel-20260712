// Meta Ad Library connector.
//
// This calls the PUBLIC "Ad Library API" (`GET /ads_archive` on the Graph
// API), which is distinct from the Marketing API: it only requires a
// standard Graph API app access token (no Business Manager approval, no
// app review for this specific endpoint). It is read-only and surfaces the
// same data visible at facebook.com/ads/library.
//
// Docs shape (as of Graph API v19.0):
//   GET https://graph.facebook.com/v19.0/ads_archive
//     ?search_terms=<brand>
//     &ad_reached_countries=["US"]
//     &ad_type=ALL
//     &access_token=<token>
//
// Success response:
//   { "data": [ { "id": "...", "page_id": "...", "page_name": "...",
//       "ad_snapshot_url": "...", "ad_creative_bodies": ["..."],
//       "ad_creative_link_captions": ["..."], "ad_delivery_start_time": "...",
//       "ad_delivery_stop_time": "...", "impressions": {"lower_bound":"...",
//       "upper_bound":"..."}, "spend": {"lower_bound":"...","upper_bound":"...",
//       "currency":"USD"} }, ... ],
//     "paging": { "cursors": { "after": "..." } } }
//
// Error response (Graph API standard shape):
//   { "error": { "message": "...", "type": "OAuthException", "code": 190,
//       "error_subcode": ..., "fbtrace_id": "..." } }
//
// When META_ACCESS_TOKEN is absent, we do not fake data or silently return
// [] — we throw SkippedNoCredentialsError so the caller can distinguish
// "ran and found nothing" from "didn't run."

import { cached } from "@/services/cache";
import { fetchWithRetry } from "./http";

export interface MetaAd {
  adId: string;
  pageId: string;
  pageName: string;
  adSnapshotUrl: string;
  firstSeenAt?: string;
  lastSeenAt?: string;
  creativeBody?: string;
  creativeLinkUrl?: string;
  creativeImageUrl?: string;
  creativeVideoUrl?: string;
  /** e.g. ["FACEBOOK","INSTAGRAM"] — drives the AdCandidate platform. */
  publisherPlatforms?: string[];
  spend?: { lower?: number; upper?: number; currency?: string };
  impressions?: { lower?: number; upper?: number };
}

export interface MetaSearchOptions {
  brand: string;
  countries?: string[];
  limit?: number;
  /** ALL (default) | POLITICAL_AND_ISSUE_ADS — the tier that gates field access. */
  adType?: string;
  /** Restrict to a known advertiser page instead of a free-text term. */
  pageIds?: string[];
}

/** Thrown when META_ACCESS_TOKEN is not configured — callers should catch
 * this distinctly from other errors and record a "skipped" note rather than
 * treating it as a failed fetch. */
export class SkippedNoCredentialsError extends Error {
  constructor() {
    super("Meta Ad Library skipped: META_ACCESS_TOKEN not configured");
    this.name = "SkippedNoCredentialsError";
  }
}

/** Thrown when the Graph API itself returns an {error:{...}} payload. */
export class MetaGraphApiError extends Error {
  type?: string;
  code?: number;
  errorSubcode?: number;
  fbtraceId?: string;

  constructor(info: {
    message: string;
    type?: string;
    code?: number;
    errorSubcode?: number;
    fbtraceId?: string;
  }) {
    super(`Meta Graph API error: ${info.message}`);
    this.name = "MetaGraphApiError";
    this.type = info.type;
    this.code = info.code;
    this.errorSubcode = info.errorSubcode;
    this.fbtraceId = info.fbtraceId;
  }
}

interface GraphApiErrorShape {
  error?: {
    message: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

interface AdsArchiveEntry {
  id: string;
  page_id?: string;
  page_name?: string;
  ad_snapshot_url?: string;
  ad_creative_bodies?: string[];
  ad_creative_link_captions?: string[];
  ad_delivery_start_time?: string;
  ad_delivery_stop_time?: string;
  impressions?: { lower_bound?: string; upper_bound?: string };
  spend?: { lower_bound?: string; upper_bound?: string; currency?: string };
  // Not part of the documented public schema for most access levels, but the
  // API sometimes surfaces creative media URLs — mapped defensively if present.
  ad_creative_link_url?: string;
  ad_creative_link_urls?: string[];
  publisher_platforms?: string[];
  video_hd_url?: string;
  video_sd_url?: string;
  image_url?: string;
}

interface AdsArchiveResponse extends GraphApiErrorShape {
  data?: AdsArchiveEntry[];
  paging?: { cursors?: { after?: string } };
}

const GRAPH_API_BASE = "https://graph.facebook.com/v19.0";

function toNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isNaN(n) ? undefined : n;
}

function mapEntry(entry: AdsArchiveEntry): MetaAd {
  return {
    adId: entry.id,
    pageId: entry.page_id ?? "",
    pageName: entry.page_name ?? "",
    adSnapshotUrl: entry.ad_snapshot_url ?? "",
    firstSeenAt: entry.ad_delivery_start_time,
    lastSeenAt: entry.ad_delivery_stop_time,
    creativeBody: entry.ad_creative_bodies?.[0],
    creativeLinkUrl: entry.ad_creative_link_url ?? entry.ad_creative_link_urls?.[0],
    publisherPlatforms: entry.publisher_platforms,
    creativeImageUrl: entry.image_url,
    creativeVideoUrl: entry.video_hd_url ?? entry.video_sd_url,
    spend: entry.spend
      ? {
          lower: toNumber(entry.spend.lower_bound),
          upper: toNumber(entry.spend.upper_bound),
          currency: entry.spend.currency,
        }
      : undefined,
    impressions: entry.impressions
      ? {
          lower: toNumber(entry.impressions.lower_bound),
          upper: toNumber(entry.impressions.upper_bound),
        }
      : undefined,
  };
}

async function fetchAdsArchive(options: MetaSearchOptions, token: string): Promise<MetaAd[]> {
  const countries = options.countries?.length ? options.countries : ["US"];
  const limit = options.limit ?? 25;

  const fields = [
    "id",
    "page_id",
    "page_name",
    "ad_snapshot_url",
    "ad_creative_bodies",
    "ad_creative_link_captions",
    "ad_creative_link_urls",
    "ad_delivery_start_time",
    "ad_delivery_stop_time",
    "publisher_platforms",
    "impressions",
    "spend",
  ].join(",");

  const params = new URLSearchParams({
    ad_reached_countries: JSON.stringify(countries),
    ad_type: options.adType ?? "ALL",
    ad_active_status: "ALL",
    media_type: "VIDEO",
    fields,
    limit: String(limit),
    access_token: token,
  });
  if (options.pageIds?.length) {
    params.set("search_page_ids", JSON.stringify(options.pageIds));
  } else {
    params.set("search_terms", options.brand);
  }

  const url = `${GRAPH_API_BASE}/ads_archive?${params.toString()}`;
  const response = await fetchWithRetry(url, { method: "GET" });

  let body: AdsArchiveResponse;
  try {
    body = (await response.json()) as AdsArchiveResponse;
  } catch {
    throw new MetaGraphApiError({
      message: `Non-JSON response from ads_archive (status ${response.status})`,
    });
  }

  if (body.error) {
    throw new MetaGraphApiError({
      message: body.error.message,
      type: body.error.type,
      code: body.error.code,
      errorSubcode: body.error.error_subcode,
      fbtraceId: body.error.fbtrace_id,
    });
  }

  if (!response.ok) {
    throw new MetaGraphApiError({
      message: `ads_archive request failed with status ${response.status}`,
      code: response.status,
    });
  }

  return (body.data ?? []).map(mapEntry);
}

/**
 * Search the public Meta Ad Library ("Ad Library API" — ads_archive) for
 * ads matching a brand's name. Requires META_ACCESS_TOKEN; throws
 * SkippedNoCredentialsError when it is absent (callers should catch this
 * specifically and record a "skipped" note rather than treating it as a
 * hard failure). Throws MetaGraphApiError on any Graph API error response.
 */
export async function searchMetaAdLibrary(options: MetaSearchOptions): Promise<MetaAd[]> {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    throw new SkippedNoCredentialsError();
  }

  return cached<MetaAd[]>(
    {
      kind: "meta-ad-library",
      params: {
        brand: options.brand,
        countries: options.countries ?? ["US"],
        limit: options.limit ?? 25,
        pageIds: options.pageIds ?? null,
        adType: options.adType ?? "ALL",
      },
      ttlSec: 60 * 60 * 24, // 24h
      schemaVersion: 2,
      cacheEmpty: false,
    },
    () => fetchAdsArchive(options, token)
  );
}

/**
 * Translate a Graph API failure into a human-readable note. The public
 * ads_archive endpoint refuses non-political queries in most regions and
 * rejects tokens that have not completed identity verification — both come
 * back as generic OAuthException codes, so callers must not report them as
 * "no ads found".
 */
export function describeMetaError(err: unknown): { note: string; accessTier: boolean } {
  if (err instanceof SkippedNoCredentialsError) {
    return { note: err.message, accessTier: true };
  }
  if (err instanceof MetaGraphApiError) {
    const code = err.code ?? 0;
    const sub = err.errorSubcode ?? 0;
    if (code === 190) {
      return { note: `Meta token invalid or expired (code 190): ${err.message}`, accessTier: true };
    }
    if (code === 10 || code === 200 || code === 613 || sub === 1870034) {
      return {
        note: `Not connected yet — Meta is holding Ad Library API access until the account's identity confirmation (facebook.com/ID) is approved (code ${code}). It connects automatically once approved; Meta ads still come from the local worker meanwhile.`,
        accessTier: true,
      };
    }
    if (code === 4 || code === 17 || code === 32) {
      return { note: `Meta Ad Library rate limit (code ${code})`, accessTier: false };
    }
    return { note: err.message, accessTier: false };
  }
  return { note: err instanceof Error ? err.message : String(err), accessTier: false };
}
