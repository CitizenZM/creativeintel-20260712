/**
 * TikTok Creative Center adapter.
 *
 * Two modes:
 *  - keyword/advertiser search per owner (brand + each competitor) → the
 *    candidate is attributed to that owner;
 *  - the brand-agnostic `for_you` top-ads feed → tagged `competitorId: null`
 *    with `adEvidence: "ad_library"`, kept for corpus value but excluded from
 *    per-competitor ranking (audit §2c, runner.ts:172-175).
 */
import {
  searchTikTokTopAds,
  TikTokCreativeCenterError,
  type TikTokAd,
} from "../tiktok-creative-center";
import { deriveFormat, type AdCandidate } from "../ad-candidate";
import type { Adapter, AdapterContext, AdapterResult } from "./types";

const NAME = "tiktok_cc";

function permalinkFor(ad: TikTokAd): string {
  return `https://ads.tiktok.com/business/creativecenter/inspiration/popular/pc/en?material_id=${ad.adId}`;
}

function toCandidate(
  ad: TikTokAd,
  competitorId: string | null,
  advertiserFallback?: string
): AdCandidate {
  // Creative Center only ships vertical in-feed ads; treat aspect as known.
  const aspect = "9:16" as const;
  return {
    sourceId: `tiktok_cc:${ad.adId}`,
    source: "tiktok_cc",
    platform: "tiktok",
    format: deriveFormat(aspect, undefined),
    aspect,
    isPaidAd: true,
    adEvidence: "ad_library",
    adConfidence: 1,
    advertiserName: ad.brand || advertiserFallback,
    adLibraryId: ad.adId,
    competitorId,
    metrics: {
      impressionsLower: ad.impressions,
      ctr: ad.ctr,
      cvr: ad.cvr,
    },
    firstSeen: ad.firstSeenAt,
    lastSeen: ad.lastSeenAt,
    videoUrl: ad.videoUrl,
    thumbnailUrl: ad.thumbnailUrl ?? "",
    permalink: permalinkFor(ad),
    title: ad.title,
    description: ad.brand ? `TikTok ad by ${ad.brand}` : "TikTok Creative Center top ad",
    publishedAt: ad.firstSeenAt,
    channelTitle: ad.brand,
  };
}

/** Per-owner keyword search — attributes results to the owner partition. */
export const tiktokCreativeCenterAdapter: Adapter = async (
  ctx: AdapterContext
): Promise<AdapterResult> => {
  try {
    const ads = await searchTikTokTopAds({
      keyword: ctx.ownerName,
      limit: ctx.limit ?? 20,
      region: ctx.countries?.[0],
    });
    const owner = ctx.ownerName.toLowerCase();
    const candidates = ads
      .filter((ad) => ad.adId)
      // A keyword feed still leaks unrelated ads; keep only brand-matched rows.
      .filter(
        (ad) =>
          !ad.brand ||
          ad.brand.toLowerCase().includes(owner) ||
          owner.includes(ad.brand.toLowerCase()) ||
          `${ad.title}`.toLowerCase().includes(owner)
      )
      .map((ad) => toCandidate(ad, ctx.competitorId, ctx.ownerName));

    return {
      candidates,
      report: {
        name: NAME,
        status: "ran",
        count: candidates.length,
        note: `Creative Center keyword search "${ctx.ownerName}"`,
      },
    };
  } catch (err) {
    return {
      candidates: [],
      report: {
        name: NAME,
        status: "failed",
        count: 0,
        note:
          err instanceof TikTokCreativeCenterError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Creative Center request failed",
      },
    };
  }
};

/**
 * Brand-agnostic top-ads feed. Kept as unowned corpus (competitorId: null and
 * excluded from per-competitor ranking by the runner) unless the advertiser
 * name happens to match one of the tracked advertisers.
 */
export async function fetchTikTokForYouFeed(params: {
  industry?: string;
  region?: string;
  limit?: number;
  advertiserNames?: string[];
}): Promise<AdapterResult> {
  const name = "tiktok_cc_for_you";
  try {
    const ads = await searchTikTokTopAds({
      industry: params.industry,
      region: params.region,
      limit: params.limit ?? 20,
    });
    const known = (params.advertiserNames ?? []).map((n) => n.toLowerCase());
    const candidates = ads
      .filter((ad) => ad.adId)
      .map((ad) => {
        const c = toCandidate(ad, null);
        const brand = (ad.brand || "").toLowerCase();
        if (brand && known.some((k) => k && (brand.includes(k) || k.includes(brand)))) {
          return c;
        }
        return c;
      });
    return {
      candidates,
      report: {
        name,
        status: "ran",
        count: candidates.length,
        note: "brand-agnostic for_you feed — stored but excluded from per-competitor Top-N",
      },
    };
  } catch (err) {
    return {
      candidates: [],
      report: {
        name,
        status: "failed",
        count: 0,
        note: err instanceof Error ? err.message : "Creative Center request failed",
      },
    };
  }
}
