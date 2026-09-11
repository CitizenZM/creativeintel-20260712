/**
 * Instagram adapter — DuckDuckGo reel/post discovery. Instagram exposes no
 * public metrics to an unauthenticated fetch, so metrics stay empty rather
 * than being faked as zeros that the ranking would then read as real.
 * Paid attribution for Instagram comes from the Meta Ad Library adapter.
 */
import { searchDuckDuckGo } from "../duckduckgo";
import { createHash } from "node:crypto";
import { deriveFormat, type AdCandidate } from "../ad-candidate";
import type { Adapter, AdapterContext, AdapterResult } from "./types";
import { failedResult } from "./types";

const NAME = "ig_reels";

function shortcodeFor(url: string): string {
  const match = url.match(/\/(?:reel|reels|p)\/([A-Za-z0-9_-]+)/);
  if (match?.[1]) return match[1];
  return createHash("sha1")
    .update(url.split("#")[0].split("?")[0].toLowerCase())
    .digest("hex")
    .slice(0, 12);
}

export const instagramAdapter: Adapter = async (
  ctx: AdapterContext
): Promise<AdapterResult> => {
  const disambig = ctx.keywords.brandContext?.disambiguationKeywords?.[0] || "";
  const query = `site:instagram.com "${ctx.ownerName}" ${disambig} reel`.trim();

  try {
    const results = await searchDuckDuckGo(query, 10);
    const candidates: AdCandidate[] = results
      .filter(
        (r) =>
          r.url.includes("instagram.com") &&
          (r.url.includes("/reel/") || r.url.includes("/reels/") || r.url.includes("/p/"))
      )
      .slice(0, ctx.limit ?? 8)
      .map((r) => {
        const aspect = "9:16" as const;
        return {
          sourceId: `ig_reels:${shortcodeFor(r.url)}`,
          source: "ig_reels" as const,
          platform: "instagram" as const,
          format: deriveFormat(aspect, undefined),
          aspect,
          isPaidAd: false,
          adEvidence: "none" as const,
          competitorId: ctx.competitorId,
          metrics: {},
          thumbnailUrl: "",
          permalink: r.url,
          title: r.title || `${ctx.ownerName} Instagram Reel`,
          description: r.snippet,
          advertiserName: ctx.ownerName,
          channelTitle: "Instagram",
        };
      });

    return {
      candidates,
      report: {
        name: NAME,
        status: "ran",
        count: candidates.length,
        note: "DuckDuckGo discovery only — Instagram publishes no metrics without auth",
      },
    };
  } catch (err) {
    return failedResult(NAME, err);
  }
};
