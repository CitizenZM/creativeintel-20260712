/**
 * YouTube adapters — Shorts and long-form.
 *
 * Both paths (official API and HTML scrape) apply the same duration filter and
 * the same mustContain/mustNotContain disambiguation, so configuring an API key
 * no longer silently disables either (audit §2b, youtube-service.ts:44-53).
 */
import { searchYouTubeVideos, type YouTubeVideo } from "../youtube-service";
import { deriveFormat, type AdCandidate } from "../ad-candidate";
import { pMap } from "@/lib/parallel";
import type { Adapter, AdapterContext, AdapterResult } from "./types";
import { failedResult } from "./types";

/** YouTube's own "under 4 minutes" search filter — the scrape path's only lever. */
const SHORTS_SP_FILTER = "EgIQCQ%3D%3D";

const SHORT_MAX_SEC = 60;

function toCandidate(
  v: YouTubeVideo,
  ctx: AdapterContext,
  isShort: boolean
): AdCandidate {
  const durationSec = v.durationSec;
  const short =
    isShort || (durationSec !== undefined && durationSec <= SHORT_MAX_SEC);
  const aspect = short ? ("9:16" as const) : undefined;
  return {
    sourceId: `youtube:${v.videoId}`,
    source: "youtube",
    platform: short ? "youtube_short" : "youtube",
    format: deriveFormat(aspect, durationSec),
    durationSec,
    aspect,
    // Organic YouTube carries no paid proof; the LLM classifier decides later.
    isPaidAd: false,
    adEvidence: "none",
    competitorId: ctx.competitorId,
    metrics: {
      views: v.viewCount,
      likes: v.likeCount,
      comments: v.commentCount,
    },
    publishedAt: v.publishedAt,
    firstSeen: v.publishedAt,
    thumbnailUrl: v.thumbnailUrl,
    permalink: `https://youtube.com/watch?v=${v.videoId}`,
    title: v.title,
    description: v.description,
    channelTitle: v.channelTitle,
    advertiserName: v.channelTitle || ctx.ownerName,
    metricsEstimated: v.metricsEstimated,
  };
}

export const youtubeShortsAdapter: Adapter = async (ctx): Promise<AdapterResult> => {
  const name = "youtube_shorts";
  const bc = ctx.keywords.brandContext;
  const disambig = bc?.disambiguationKeywords?.[0] || "";
  const queries = [
    `${ctx.ownerName} ${disambig} ad short`.trim(),
    `${ctx.ownerName} ${disambig} commercial shorts`.trim(),
  ];

  try {
    const perQuery = await pMap(
      queries,
      (query) =>
        searchYouTubeVideos(query, {
          maxResults: ctx.limit ?? 8,
          spFilter: SHORTS_SP_FILTER,
          videoDuration: "short",
          brandName: ctx.ownerName,
          mustContain: bc?.disambiguationKeywords,
          mustNotContain: bc?.notRelatedTo,
        }),
      { concurrency: 2 }
    );

    const videos = perQuery.flat();
    // `videoDuration=short` is <4min on YouTube's side, so re-check locally.
    const candidates = videos
      .filter((v) => v.durationSec === undefined || v.durationSec <= SHORT_MAX_SEC)
      .map((v) => toCandidate(v, ctx, true));

    return {
      candidates,
      report: {
        name,
        status: "ran",
        count: candidates.length,
        note: process.env.YOUTUBE_API_KEY
          ? "YouTube Data API (videoDuration=short + contentDetails)"
          : "HTML scrape fallback (no YOUTUBE_API_KEY)",
      },
    };
  } catch (err) {
    return failedResult(name, err);
  }
};

export const youtubeLongAdapter: Adapter = async (ctx): Promise<AdapterResult> => {
  const name = "youtube_long";
  const bc = ctx.keywords.brandContext;
  const queries = ctx.keywords.adSearchQueries?.slice(0, 2)?.length
    ? ctx.keywords.adSearchQueries.slice(0, 2)
    : [`${ctx.ownerName} ${bc?.disambiguationKeywords?.[0] ?? ""} official ad commercial`.trim()];

  try {
    const perQuery = await pMap(
      queries,
      (query) =>
        searchYouTubeVideos(query, {
          maxResults: ctx.limit ?? 8,
          brandName: ctx.ownerName,
          mustContain: bc?.disambiguationKeywords,
          mustNotContain: bc?.notRelatedTo,
        }),
      { concurrency: 2 }
    );

    const candidates = perQuery.flat().map((v) => toCandidate(v, ctx, false));
    return {
      candidates,
      report: {
        name,
        status: "ran",
        count: candidates.length,
        note: process.env.YOUTUBE_API_KEY
          ? "YouTube Data API"
          : "HTML scrape fallback (no YOUTUBE_API_KEY)",
      },
    };
  } catch (err) {
    return failedResult(name, err);
  }
};
