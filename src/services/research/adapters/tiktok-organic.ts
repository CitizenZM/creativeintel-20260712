/**
 * TikTok organic adapter — the existing DuckDuckGo URL-discovery + page-scrape
 * path, now returning AdCandidates with `adEvidence: "none"` so the LLM ad
 * classifier (not the adapter) decides whether each one is a brand-paid ad.
 */
import { searchDuckDuckGo } from "../duckduckgo";
import { scrapeTikTokVideo } from "../tiktok-scraper";
import { deriveFormat, type AdCandidate } from "../ad-candidate";
import { pMap } from "@/lib/parallel";
import type { Adapter, AdapterContext, AdapterResult } from "./types";
import { failedResult } from "./types";

const NAME = "tiktok_organic";

export const tiktokOrganicAdapter: Adapter = async (
  ctx: AdapterContext
): Promise<AdapterResult> => {
  const disambig = ctx.keywords.brandContext?.disambiguationKeywords?.[0] || "";
  // One query per owner, not two: each one is a separate paced browser fetch
  // when this server's IP is challenged, and site: is the precise form.
  const queries = [`site:tiktok.com "${ctx.ownerName}" ${disambig}`.trim()];

  try {
    const perQuery = await pMap(
      queries,
      async (query) => {
        const results = await searchDuckDuckGo(query, 8, {
          projectId: ctx.projectId,
          viaWorkerOnBlock: true,
        });
        return results
          .filter((r) => r.url.includes("tiktok.com") && r.url.includes("/video/"))
          .slice(0, 4);
      },
      { concurrency: 2 }
    );

    const urls = [...new Set(perQuery.flat().map((r) => r.url))].slice(0, 8);
    const scraped = await pMap(
      urls,
      (url) => scrapeTikTokVideo(url).catch(() => null),
      { concurrency: 3 }
    );

    const candidates: AdCandidate[] = [];
    for (const v of scraped) {
      if (!v) continue;
      const aspect = "9:16" as const;
      candidates.push({
        sourceId: `tiktok_organic:${v.videoId}`,
        source: "tiktok_organic",
        platform: "tiktok",
        format: deriveFormat(aspect, v.duration || undefined),
        durationSec: v.duration || undefined,
        aspect,
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
        permalink: v.url,
        title: v.title || v.description.slice(0, 80),
        description: v.description,
        channelTitle: v.author || v.authorHandle,
        advertiserName: v.author || v.authorHandle,
      });
    }

    const blocked = urls.length > 0 && candidates.length === 0;
    return {
      candidates,
      report: {
        name: NAME,
        status: blocked ? "failed" : "ran",
        count: candidates.length,
        note: blocked
          ? `TikTok blocked all ${urls.length} scrape attempts (bot check)`
          : `${urls.length} URLs discovered via DuckDuckGo`,
      },
    };
  } catch (err) {
    return failedResult(NAME, err);
  }
};
