import { google } from "googleapis";
import { cached } from "@/services/cache";
import { fetchWithRetry } from "./http";

export interface YouTubeVideo {
  videoId: string;
  title: string;
  description: string;
  publishedAt: string;
  thumbnailUrl: string;
  channelTitle: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  /** Real duration in seconds — ISO-8601 on the API path, lengthText on scrape. */
  durationSec?: number;
  /** True when likeCount/commentCount are heuristic estimates, not real data
   * (set on results from the HTML-scrape path, which has no engagement data). */
  metricsEstimated?: boolean;
}

export interface YouTubeSearchOptions {
  maxResults?: number;
  /** `sp=` parameter for the scrape path (e.g. the Shorts filter). */
  spFilter?: string;
  /** Maps to the API's `videoDuration` param; mirrored by spFilter on scrape. */
  videoDuration?: "short" | "medium" | "long" | "any";
  brandName?: string;
  mustContain?: string[];
  mustNotContain?: string[];
}

const youtube = google.youtube("v3");

/**
 * Search YouTube. Quality filters (`brandName` / `mustContain` /
 * `mustNotContain`) are applied on BOTH the API and the scrape path — having
 * an API key must not silently disable disambiguation (audit §2b).
 */
export async function searchYouTubeVideos(
  query: string,
  options: YouTubeSearchOptions = {}
): Promise<YouTubeVideo[]> {
  if (process.env.MOCK_CRAWL === "true") {
    return [];
  }

  const {
    maxResults = 10,
    spFilter,
    videoDuration,
    brandName,
    mustContain,
    mustNotContain,
  } = options;

  return cached(
    {
      kind: "youtube:search",
      params: {
        query,
        maxResults,
        spFilter: spFilter ?? null,
        videoDuration: videoDuration ?? null,
        brandName: brandName ?? null,
        mustContain: mustContain ?? null,
        mustNotContain: mustNotContain ?? null,
      },
      ttlSec: 60 * 60 * 12,
      schemaVersion: 2,
    },
    async () => {
      const apply = (results: YouTubeVideo[]) => {
        const filtered = brandName
          ? filterQuality(results, brandName, mustContain, mustNotContain)
          : results;
        return filtered.slice(0, maxResults);
      };

      if (process.env.YOUTUBE_API_KEY) {
        try {
          return apply(await searchViaAPI(query, maxResults + 5, videoDuration));
        } catch (error) {
          console.error("YouTube API error:", error);
        }
      }
      try {
        return apply(await scrapeYouTubeSearch(query, maxResults + 5, spFilter));
      } catch (error) {
        console.error("YouTube scrape error:", error);
      }
      return [];
    }
  );
}

/** `PT1M30S` → 90. Returns undefined for anything unparseable. */
export function parseIsoDuration(iso: string | null | undefined): number | undefined {
  if (!iso) return undefined;
  const m = iso.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);
  if (!m) return undefined;
  const [, d, h, min, s] = m;
  const total =
    Number(d ?? 0) * 86400 +
    Number(h ?? 0) * 3600 +
    Number(min ?? 0) * 60 +
    Number(s ?? 0);
  return Number.isFinite(total) && total > 0 ? total : undefined;
}

/** `1:23` / `1:02:03` → seconds. */
function parseLengthText(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const parts = text.trim().split(":").map((p) => Number(p));
  if (parts.some((n) => Number.isNaN(n))) return undefined;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return undefined;
}

async function searchViaAPI(
  query: string,
  maxResults: number,
  videoDuration?: "short" | "medium" | "long" | "any"
): Promise<YouTubeVideo[]> {
  const searchResponse = await youtube.search.list({
    key: process.env.YOUTUBE_API_KEY,
    q: query,
    part: ["snippet"],
    type: ["video"],
    maxResults,
    order: "relevance",
    ...(videoDuration && videoDuration !== "any" ? { videoDuration } : {}),
  });

  const videoIds = (searchResponse.data.items || [])
    .map((item) => item.id?.videoId)
    .filter((id): id is string => !!id);

  if (videoIds.length === 0) return [];

  // contentDetails is what carries the real ISO-8601 duration — the search
  // endpoint never returns it.
  const statsResponse = await youtube.videos.list({
    key: process.env.YOUTUBE_API_KEY,
    id: videoIds,
    part: ["statistics", "snippet", "contentDetails"],
  });

  return (statsResponse.data.items || []).map((item) => ({
    videoId: item.id || "",
    title: item.snippet?.title || "",
    description: (item.snippet?.description || "").slice(0, 1000),
    publishedAt: item.snippet?.publishedAt || "",
    thumbnailUrl:
      item.snippet?.thumbnails?.high?.url ||
      item.snippet?.thumbnails?.default?.url ||
      "",
    channelTitle: item.snippet?.channelTitle || "",
    viewCount: parseInt(item.statistics?.viewCount || "0", 10),
    likeCount: parseInt(item.statistics?.likeCount || "0", 10),
    commentCount: parseInt(item.statistics?.commentCount || "0", 10),
    durationSec: parseIsoDuration(item.contentDetails?.duration),
  }));
}

function parseViewCount(text: string): number {
  if (!text) return 0;
  const cleaned = text.replace(/[^0-9.,KMBkmb]/g, "").trim();
  const num = parseFloat(cleaned.replace(/,/g, ""));
  if (isNaN(num)) return 0;
  const upper = text.toUpperCase();
  if (upper.includes("B")) return Math.round(num * 1_000_000_000);
  if (upper.includes("M")) return Math.round(num * 1_000_000);
  if (upper.includes("K")) return Math.round(num * 1_000);
  return Math.round(num);
}

function isEnglishTitle(title: string): boolean {
  if (!title) return false;
  // Count non-ASCII characters (excludes accented Latin chars)
  const nonLatin = title.replace(/[\x00-\x7FÀ-ɏ]/g, "").length;
  return nonLatin / title.length < 0.3;
}

function filterQuality(
  videos: YouTubeVideo[],
  brandName: string,
  mustContain?: string[],
  mustNotContain?: string[]
): YouTubeVideo[] {
  const brandLower = brandName.toLowerCase();
  const isAmbiguous = brandName.length <= 6;

  return videos.filter((v) => {
    if (!isEnglishTitle(v.title)) return false;
    if (v.viewCount < 500 && !v.title.toLowerCase().includes(brandLower)) return false;

    const text = `${v.title} ${v.description}`.toLowerCase();

    // Reject if contains any "not related to" terms
    if (mustNotContain && mustNotContain.length > 0) {
      for (const term of mustNotContain) {
        if (term && text.includes(term.toLowerCase())) return false;
      }
    }

    // For ambiguous brand names, require at least one disambiguation keyword
    if (isAmbiguous && mustContain && mustContain.length > 0) {
      const hasRelevantKeyword = mustContain.some(
        (kw) => kw && text.includes(kw.toLowerCase())
      );
      const titleHasBrand = v.title.toLowerCase().includes(brandLower);
      // Pass if: has a relevant keyword, OR title has brand + high view count (likely official)
      if (!hasRelevantKeyword && !(titleHasBrand && v.viewCount > 50000)) {
        return false;
      }
    }

    return true;
  });
}

function parsePublishedAge(text: string): string {
  if (!text) return new Date().toISOString();
  const now = Date.now();
  const match = text.match(/(\d+)\s*(year|month|week|day|hour|minute)/i);
  if (!match) return new Date().toISOString();
  const n = parseInt(match[1]);
  const unit = match[2].toLowerCase();
  const ms: Record<string, number> = {
    year: 365 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    hour: 60 * 60 * 1000,
    minute: 60 * 1000,
  };
  return new Date(now - n * (ms[unit] || 0)).toISOString();
}

async function scrapeYouTubeSearch(
  query: string,
  maxResults: number,
  spFilter?: string
): Promise<YouTubeVideo[]> {
  let url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&gl=US&hl=en`;
  if (spFilter) url += `&sp=${spFilter}`;

  const response = await fetchWithRetry(
    url,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    },
    { timeoutMs: 10000 }
  );

  if (!response.ok) throw new Error(`YouTube returned ${response.status}`);

  const html = await response.text();

  // Extract ytInitialData JSON from the page
  const match = html.match(
    /var ytInitialData = ({.*?});<\/script>/
  );
  if (!match) {
    const match2 = html.match(
      /window\["ytInitialData"\] = ({.*?});<\/script>/
    );
    if (!match2) throw new Error("ytInitialData not found in page");
    return parseYtInitialData(match2[1], maxResults);
  }

  return parseYtInitialData(match[1], maxResults);
}

function parseYtInitialData(jsonStr: string, maxResults: number): YouTubeVideo[] {
  const data = JSON.parse(jsonStr);

  const contents =
    data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
      ?.sectionListRenderer?.contents || [];

  const videos: YouTubeVideo[] = [];

  for (const section of contents) {
    const items = section?.itemSectionRenderer?.contents || [];
    for (const item of items) {
      const vr = item?.videoRenderer;
      if (!vr || !vr.videoId) continue;

      const title =
        vr.title?.runs?.[0]?.text || vr.title?.simpleText || "";
      const channel =
        vr.ownerText?.runs?.[0]?.text ||
        vr.longBylineText?.runs?.[0]?.text ||
        "";
      const viewsText =
        vr.viewCountText?.simpleText || vr.viewCountText?.runs?.[0]?.text || "";
      const publishedText =
        vr.publishedTimeText?.simpleText || "";
      const lengthText =
        vr.lengthText?.simpleText || vr.lengthText?.runs?.[0]?.text || "";

      // Get highest quality thumbnail
      const thumbnails = vr.thumbnail?.thumbnails || [];
      const thumb = thumbnails.length > 0
        ? thumbnails[thumbnails.length - 1].url
        : `https://i.ytimg.com/vi/${vr.videoId}/hqdefault.jpg`;

      // Extract description snippet
      let description = "";
      for (const snip of vr.detailedMetadataSnippets || []) {
        for (const run of snip?.snippetText?.runs || []) {
          description += run.text || "";
        }
      }
      if (!description) {
        for (const snip of vr.descriptionSnippet?.runs || []) {
          description += snip.text || "";
        }
      }

      const viewCount = parseViewCount(viewsText);

      videos.push({
        videoId: vr.videoId,
        title,
        description: description.slice(0, 1000),
        publishedAt: parsePublishedAge(publishedText),
        thumbnailUrl: thumb.split("?")[0], // clean thumbnail URL
        channelTitle: channel,
        viewCount,
        likeCount: 0,
        commentCount: 0,
        durationSec: parseLengthText(lengthText),
        metricsEstimated: true,
      });

      if (videos.length >= maxResults) break;
    }
    if (videos.length >= maxResults) break;
  }

  return videos;
}
