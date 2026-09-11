/**
 * Meta Ad Library adapter — runs per advertiser (the brand AND every
 * competitor), not brand-only as before (audit §2c, runner.ts:245-249).
 *
 * Access-tier failures are surfaced as a step note rather than swallowed into
 * an empty array, so "we have no token / the tier refused us" never looks like
 * "this advertiser runs no ads".
 */
import {
  searchMetaAdLibrary,
  describeMetaError,
  SkippedNoCredentialsError,
  type MetaAd,
} from "../meta-ads";
import { deriveFormat, type AdCandidate, type AdPlatform } from "../ad-candidate";
import type { Adapter, AdapterContext, AdapterResult } from "./types";

const NAME = "meta_ad_library";

function platformOf(ad: MetaAd): AdPlatform {
  const platforms = (ad.publisherPlatforms ?? []).map((p) => p.toUpperCase());
  if (platforms.includes("INSTAGRAM") && !platforms.includes("FACEBOOK")) return "instagram";
  if (platforms.includes("FACEBOOK")) return "facebook";
  if (/instagram/i.test(ad.adSnapshotUrl)) return "instagram";
  return "facebook";
}

export function metaAdToCandidate(ad: MetaAd, ctx: AdapterContext): AdCandidate {
  const platform = platformOf(ad);
  // Ad Library never reports aspect/duration; the browser worker fills them in.
  return {
    sourceId: `meta_ad_library:${ad.adId}`,
    source: "meta_ad_library",
    platform,
    format: deriveFormat(undefined, undefined),
    isPaidAd: true,
    adEvidence: "ad_library",
    adConfidence: 1,
    advertiserName: ad.pageName || ctx.ownerName,
    advertiserId: ad.pageId || undefined,
    adLibraryId: ad.adId,
    competitorId: ctx.competitorId,
    metrics: {
      impressionsLower: ad.impressions?.lower,
      impressionsUpper: ad.impressions?.upper,
      spendLower: ad.spend?.lower,
      spendUpper: ad.spend?.upper,
    },
    firstSeen: ad.firstSeenAt,
    lastSeen: ad.lastSeenAt,
    landingUrl: ad.creativeLinkUrl,
    videoUrl: ad.creativeVideoUrl,
    thumbnailUrl: ad.creativeImageUrl ?? "",
    permalink: ad.adSnapshotUrl,
    title: (ad.creativeBody?.slice(0, 120) || ad.pageName || "Meta ad").trim(),
    description: ad.creativeBody,
    publishedAt: ad.firstSeenAt,
    channelTitle: ad.pageName,
  };
}

export const metaAdLibraryAdapter: Adapter = async (
  ctx: AdapterContext
): Promise<AdapterResult> => {
  try {
    const ads = await searchMetaAdLibrary({
      brand: ctx.ownerName,
      countries: ctx.countries ?? ["US"],
      limit: ctx.limit ?? 25,
    });
    const candidates = ads
      .filter((ad) => ad.adId && ad.adSnapshotUrl)
      .map((ad) => metaAdToCandidate(ad, ctx));
    return {
      candidates,
      report: {
        name: NAME,
        status: "ran",
        count: candidates.length,
        note: `ads_archive media_type=VIDEO for "${ctx.ownerName}"`,
      },
    };
  } catch (err) {
    const { note } = describeMetaError(err);
    return {
      candidates: [],
      report: {
        name: NAME,
        status: err instanceof SkippedNoCredentialsError ? "skipped_no_key" : "failed",
        count: 0,
        note,
      },
    };
  }
};
