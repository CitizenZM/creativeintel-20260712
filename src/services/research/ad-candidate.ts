/**
 * AdCandidate — the single normalized shape every research adapter returns
 * (YouTube, Meta Ad Library, TikTok Creative Center / Ad Library, Google Ads
 * Transparency, Instagram, and the browser-worker playbooks). Gating, ranking,
 * and persistence all operate on this type; nothing downstream should know
 * which adapter produced a row.
 */
import type { ContentType } from "@/generated/prisma/enums";

export type AdSource =
  | "meta_ad_library"
  | "tiktok_ad_library"
  | "tiktok_cc"
  | "google_ats"
  | "youtube"
  | "ig_reels"
  | "tiktok_organic"
  | "vimeo";

export type AdPlatform =
  | "facebook"
  | "instagram"
  | "tiktok"
  | "youtube"
  | "youtube_short"
  | "google"
  | "vimeo";

export type AdFormat = "vertical_short" | "square" | "horizontal" | "unknown";

export type AdAspect = "9:16" | "1:1" | "16:9" | "4:5";

/** How we know (or guess) this is a paid brand ad. Ordered weakest-last. */
export type AdEvidence = "ad_library" | "paid_label" | "classifier" | "none";

export interface AdCandidateMetrics {
  views?: number;
  likes?: number;
  comments?: number;
  impressionsLower?: number;
  impressionsUpper?: number;
  spendLower?: number;
  spendUpper?: number;
  ctr?: number;
  cvr?: number;
}

export interface AdCandidate {
  /** `${source}:${nativeId}` — stable across runs, used for de-duplication. */
  sourceId: string;
  source: AdSource;
  platform: AdPlatform;
  format: AdFormat;
  durationSec?: number;
  aspect?: AdAspect;

  isPaidAd: boolean;
  adEvidence: AdEvidence;
  /** 0..1 classifier confidence that this is a brand-paid ad. */
  adConfidence?: number;

  advertiserName?: string;
  advertiserId?: string;
  adLibraryId?: string;

  /** Competitor row id, or null for the brand / brand-agnostic feeds. */
  competitorId?: string | null;

  metrics: AdCandidateMetrics;

  firstSeen?: string;
  lastSeen?: string;

  landingUrl?: string;
  videoUrl?: string;
  thumbnailUrl: string;
  permalink: string;

  title: string;
  description?: string;
  publishedAt?: string;

  /** Channel / handle / page that published it, when the source exposes one. */
  channelTitle?: string;
  /** True when likes/comments are heuristic estimates rather than real data. */
  metricsEstimated?: boolean;
}

// ─── Derivations ─────────────────────────────────────────────────────────────

/** Aspect and duration together decide the format bucket used by the gates. */
export function deriveFormat(
  aspect: AdAspect | undefined,
  durationSec: number | undefined
): AdFormat {
  if (aspect === "9:16" || aspect === "4:5") return "vertical_short";
  if (aspect === "1:1") return "square";
  if (aspect === "16:9") return "horizontal";
  if (durationSec !== undefined && durationSec <= 60) return "vertical_short";
  return "unknown";
}

export function contentTypeFor(c: AdCandidate): ContentType {
  switch (c.source) {
    case "meta_ad_library":
      return c.platform === "instagram" ? "INSTAGRAM_REEL" : "META_AD";
    case "tiktok_ad_library":
    case "tiktok_cc":
      return "TIKTOK_AD";
    case "google_ats":
      return "GOOGLE_AD";
    case "ig_reels":
      return "INSTAGRAM_REEL";
    case "tiktok_organic":
      return "TIKTOK_VIDEO";
    case "vimeo":
      return "VIMEO_VIDEO";
    case "youtube":
    default:
      return c.platform === "youtube_short" ? "YOUTUBE_SHORT" : "YOUTUBE_VIDEO";
  }
}

const PLATFORM_LABELS: Record<AdPlatform, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  youtube_short: "YouTube Shorts",
  google: "Google Ads",
  vimeo: "Vimeo",
};

function toDate(value: string | undefined): Date | null {
  if (!value) return null;
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? null : new Date(ts);
}

function engagementRate(m: AdCandidateMetrics): number | null {
  const views = m.views ?? 0;
  if (views <= 0) return null;
  return (((m.likes ?? 0) + (m.comments ?? 0)) / views) * 100;
}

export interface ContentAssetData {
  type: ContentType;
  title: string;
  url: string;
  thumbnailUrl: string | null;
  description: string | null;
  publishedAt: Date | null;
  platform: string;
  competitorId: string | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  engagementRate: number | null;
  metricsSource: "OFFICIAL_API" | "PUBLIC_WEB" | "USER_INPUT" | "AI_INFERRED";
  isPaidMedia: boolean;
  isBrandOwned: boolean;
  adSpendEstimate: Record<string, unknown>;
  adSource: string;
  adEvidence: string;
  adConfidence: number | null;
  advertiserName: string | null;
  advertiserId: string | null;
  adLibraryId: string | null;
  durationSec: number | null;
  aspectRatio: string | null;
  format: string | null;
  videoUrl: string | null;
  landingUrl: string | null;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  rankInOwner: number | null;
  dataSource: "OFFICIAL_API" | "PUBLIC_WEB" | "USER_INPUT" | "AI_INFERRED";
  rawData: Record<string, unknown>;
}

/**
 * Map an AdCandidate onto the ContentAsset columns. `url` is the upsert key
 * (projectId,url), so it always uses the permalink — never the expiring media
 * URL, which is kept separately in `videoUrl`.
 */
export function toContentAssetData(
  c: AdCandidate,
  opts: { rankInOwner?: number | null; isBrandOwned?: boolean } = {}
): ContentAssetData {
  const officialApi = c.source === "meta_ad_library" || c.source === "youtube";
  return {
    type: contentTypeFor(c),
    title: (c.title || c.advertiserName || "Untitled ad").slice(0, 300),
    url: c.permalink,
    thumbnailUrl: c.thumbnailUrl || null,
    description: c.description ?? null,
    publishedAt: toDate(c.publishedAt) ?? toDate(c.firstSeen),
    platform: PLATFORM_LABELS[c.platform] ?? c.platform,
    competitorId: c.competitorId ?? null,
    viewCount: c.metrics.views ?? null,
    likeCount: c.metrics.likes ?? null,
    commentCount: c.metrics.comments ?? null,
    engagementRate: engagementRate(c.metrics),
    metricsSource: officialApi ? "OFFICIAL_API" : "PUBLIC_WEB",
    isPaidMedia: c.isPaidAd,
    isBrandOwned: opts.isBrandOwned ?? false,
    adSpendEstimate: {
      impressionsLower: c.metrics.impressionsLower ?? null,
      impressionsUpper: c.metrics.impressionsUpper ?? null,
      spendLower: c.metrics.spendLower ?? null,
      spendUpper: c.metrics.spendUpper ?? null,
      ctr: c.metrics.ctr ?? null,
      cvr: c.metrics.cvr ?? null,
      firstSeen: c.firstSeen ?? null,
      lastSeen: c.lastSeen ?? null,
    },
    adSource: c.source,
    adEvidence: c.adEvidence,
    adConfidence: c.adConfidence ?? null,
    advertiserName: c.advertiserName ?? null,
    advertiserId: c.advertiserId ?? null,
    adLibraryId: c.adLibraryId ?? null,
    durationSec: c.durationSec ?? null,
    aspectRatio: c.aspect ?? null,
    format: c.format ?? null,
    videoUrl: c.videoUrl ?? null,
    landingUrl: c.landingUrl ?? null,
    firstSeenAt: toDate(c.firstSeen),
    lastSeenAt: toDate(c.lastSeen),
    rankInOwner: opts.rankInOwner ?? null,
    dataSource: officialApi ? "OFFICIAL_API" : "PUBLIC_WEB",
    rawData: { sourceId: c.sourceId, channelTitle: c.channelTitle ?? null },
  };
}

/** De-duplicate by sourceId first, then by permalink. */
export function dedupeCandidates(candidates: AdCandidate[]): AdCandidate[] {
  const seen = new Set<string>();
  const out: AdCandidate[] = [];
  for (const c of candidates) {
    const key = c.sourceId || c.permalink;
    const urlKey = c.permalink.split("?")[0].toLowerCase();
    if (seen.has(key) || seen.has(urlKey)) continue;
    seen.add(key);
    seen.add(urlKey);
    out.push(c);
  }
  return out;
}

// ─── Runtime validation (worker results cross a trust boundary) ──────────────

function asNumber(v: unknown): number | undefined {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

const SOURCES = new Set<string>([
  "meta_ad_library",
  "tiktok_ad_library",
  "tiktok_cc",
  "google_ats",
  "youtube",
  "ig_reels",
  "tiktok_organic",
  "vimeo",
]);
const PLATFORMS = new Set<string>([
  "facebook",
  "instagram",
  "tiktok",
  "youtube",
  "youtube_short",
  "google",
  "vimeo",
]);
const EVIDENCE = new Set<string>(["ad_library", "paid_label", "classifier", "none"]);
const ASPECTS = new Set<string>(["9:16", "1:1", "16:9", "4:5"]);

/** Parse untrusted JSON (a worker's `result.candidates`) into AdCandidates. */
export function parseAdCandidates(input: unknown): AdCandidate[] {
  if (!Array.isArray(input)) return [];
  const out: AdCandidate[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const permalink = typeof r.permalink === "string" ? r.permalink : "";
    if (!permalink || !/^https?:\/\//i.test(permalink)) continue;
    const source = typeof r.source === "string" && SOURCES.has(r.source) ? r.source : null;
    const platform =
      typeof r.platform === "string" && PLATFORMS.has(r.platform) ? r.platform : null;
    if (!source || !platform) continue;

    const m = (r.metrics && typeof r.metrics === "object" ? r.metrics : {}) as Record<
      string,
      unknown
    >;
    const aspect =
      typeof r.aspect === "string" && ASPECTS.has(r.aspect) ? (r.aspect as AdAspect) : undefined;
    const durationSec = asNumber(r.durationSec);

    out.push({
      sourceId:
        typeof r.sourceId === "string" && r.sourceId ? r.sourceId : `${source}:${permalink}`,
      source: source as AdSource,
      platform: platform as AdPlatform,
      format: deriveFormat(aspect, durationSec),
      durationSec,
      aspect,
      isPaidAd: r.isPaidAd !== false,
      adEvidence:
        typeof r.adEvidence === "string" && EVIDENCE.has(r.adEvidence)
          ? (r.adEvidence as AdEvidence)
          : "ad_library",
      adConfidence: asNumber(r.adConfidence),
      advertiserName: typeof r.advertiserName === "string" ? r.advertiserName : undefined,
      advertiserId: typeof r.advertiserId === "string" ? r.advertiserId : undefined,
      adLibraryId: typeof r.adLibraryId === "string" ? r.adLibraryId : undefined,
      competitorId: typeof r.competitorId === "string" ? r.competitorId : null,
      metrics: {
        views: asNumber(m.views),
        likes: asNumber(m.likes),
        comments: asNumber(m.comments),
        impressionsLower: asNumber(m.impressionsLower),
        impressionsUpper: asNumber(m.impressionsUpper),
        spendLower: asNumber(m.spendLower),
        spendUpper: asNumber(m.spendUpper),
        ctr: asNumber(m.ctr),
        cvr: asNumber(m.cvr),
      },
      firstSeen: typeof r.firstSeen === "string" ? r.firstSeen : undefined,
      lastSeen: typeof r.lastSeen === "string" ? r.lastSeen : undefined,
      landingUrl: typeof r.landingUrl === "string" ? r.landingUrl : undefined,
      videoUrl: typeof r.videoUrl === "string" ? r.videoUrl : undefined,
      thumbnailUrl: typeof r.thumbnailUrl === "string" ? r.thumbnailUrl : "",
      permalink,
      title: typeof r.title === "string" ? r.title : "",
      description: typeof r.description === "string" ? r.description : undefined,
      publishedAt: typeof r.publishedAt === "string" ? r.publishedAt : undefined,
      channelTitle: typeof r.channelTitle === "string" ? r.channelTitle : undefined,
    });
  }
  return out;
}
