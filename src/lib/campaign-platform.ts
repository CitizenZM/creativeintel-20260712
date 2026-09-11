// Single source of truth mapping the campaign "Platform & Duration" selection
// to: which research adapters run, which ad platforms survive the platform
// gate, the format gate (duration/aspect), and the ContentType enum values the
// Content page shows. The adapter list is authoritative — dispatch is driven by
// it rather than by searching everything and filtering the pool away afterwards.

export type VideoPlatform =
  | "youtube"
  | "youtube_short"
  | "tiktok"
  | "instagram"
  | "vimeo";
export type SearchStrategy = "short_social" | "tvc" | "mixed";

/** Adapter ids resolved by video-search.ts dispatch. */
export type AdapterId =
  | "youtube_long"
  | "youtube_shorts"
  | "tiktok_cc"
  | "tiktok_organic"
  | "instagram"
  | "meta_ad_library"
  | "browser_meta"
  | "browser_tiktok"
  | "browser_google";

export interface FormatGate {
  maxDurationSec?: number;
  minDurationSec?: number;
  /** Allowed aspect ratios; a candidate with unknown aspect passes with a penalty. */
  aspects?: string[];
}

export interface CampaignPlatform {
  id: string;
  label: string;
  defaultDurationSec: number;
  searchStrategy: SearchStrategy;
  /** Adapters to run for this campaign, in dispatch order. */
  adapters: AdapterId[];
  /** AdCandidate.platform values that survive the platform gate. */
  adPlatforms: string[];
  formatGate: FormatGate;
  /** VideoResult.platform values (legacy shape, kept for display helpers). */
  videoPlatforms: VideoPlatform[];
  /** ContentType enum values to show on the Content page. */
  contentTypes: string[];
}

const SHORT_GATE: FormatGate = { maxDurationSec: 60, aspects: ["9:16", "4:5"] };

export const CAMPAIGN_PLATFORMS: Record<string, CampaignPlatform> = {
  tiktok: {
    id: "tiktok",
    label: "TikTok / Reels",
    defaultDurationSec: 30,
    searchStrategy: "short_social",
    adapters: [
      "tiktok_cc",
      "tiktok_organic",
      "meta_ad_library",
      "instagram",
      "browser_tiktok",
      "browser_meta",
    ],
    adPlatforms: ["tiktok", "instagram"],
    formatGate: SHORT_GATE,
    videoPlatforms: ["tiktok", "instagram"],
    contentTypes: ["TIKTOK_AD", "TIKTOK_VIDEO", "INSTAGRAM_REEL", "META_AD", "SOCIAL_POST"],
  },
  instagram: {
    id: "instagram",
    label: "Instagram Feed",
    defaultDurationSec: 15,
    searchStrategy: "short_social",
    adapters: [
      "meta_ad_library",
      "instagram",
      "tiktok_cc",
      "tiktok_organic",
      "browser_meta",
      "browser_tiktok",
    ],
    adPlatforms: ["instagram", "facebook", "tiktok"],
    formatGate: SHORT_GATE,
    videoPlatforms: ["instagram", "tiktok"],
    contentTypes: ["INSTAGRAM_REEL", "META_AD", "SOCIAL_POST", "TIKTOK_AD", "TIKTOK_VIDEO"],
  },
  youtube: {
    id: "youtube",
    label: "YouTube Pre-roll",
    defaultDurationSec: 30,
    searchStrategy: "mixed",
    adapters: ["youtube_shorts", "youtube_long", "browser_google"],
    adPlatforms: ["youtube", "youtube_short", "google"],
    formatGate: { maxDurationSec: 180 },
    videoPlatforms: ["youtube", "youtube_short"],
    contentTypes: ["YOUTUBE_VIDEO", "YOUTUBE_SHORT", "GOOGLE_AD"],
  },
  tvc: {
    id: "tvc",
    label: "TVC (Television)",
    defaultDurationSec: 60,
    searchStrategy: "tvc",
    adapters: ["youtube_long", "browser_google"],
    adPlatforms: ["youtube", "google"],
    formatGate: { minDurationSec: 15, aspects: ["16:9", "1:1"] },
    videoPlatforms: ["youtube", "vimeo"],
    contentTypes: ["YOUTUBE_VIDEO", "GOOGLE_AD", "VIMEO_VIDEO"],
  },
  amazon: {
    id: "amazon",
    label: "Amazon PDP Video",
    defaultDurationSec: 30,
    searchStrategy: "mixed",
    adapters: ["youtube_long", "youtube_shorts", "tiktok_cc", "tiktok_organic"],
    adPlatforms: ["youtube", "youtube_short", "tiktok"],
    formatGate: { maxDurationSec: 90 },
    videoPlatforms: ["youtube", "tiktok"],
    contentTypes: ["YOUTUBE_VIDEO", "YOUTUBE_SHORT", "TIKTOK_AD", "TIKTOK_VIDEO"],
  },
};

/** Used when the project has no saved campaign selection — cast a wide net. */
export const DEFAULT_ADAPTERS: AdapterId[] = [
  "youtube_long",
  "youtube_shorts",
  "meta_ad_library",
  "tiktok_cc",
  "tiktok_organic",
  "instagram",
];

/** Resolve a saved platform id (case-insensitive) to its config, or null. */
export function getCampaignPlatform(
  platform: string | null | undefined
): CampaignPlatform | null {
  if (!platform) return null;
  return CAMPAIGN_PLATFORMS[platform.toLowerCase()] ?? null;
}

/** Adapters to run for a campaign — falls back to the wide default set. */
export function adaptersFor(campaign: CampaignPlatform | null): AdapterId[] {
  return campaign?.adapters ?? DEFAULT_ADAPTERS;
}

export const BROWSER_ADAPTERS = new Set<AdapterId>([
  "browser_meta",
  "browser_tiktok",
  "browser_google",
]);
