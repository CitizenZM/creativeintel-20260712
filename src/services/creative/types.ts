/**
 * Creative library types — platform profiles, opening hooks, end cards and the product brief.
 * Research: out/research/ad-research/0{1,2,3}-*.md (2026-10-06).
 */

export type PlatformId =
  | "tiktok"
  | "instagram_reels"
  | "instagram_stories"
  | "meta_feed"
  | "facebook_reels"
  | "youtube_instream_skippable"
  | "youtube_instream_nonskippable_15s"
  | "youtube_bumper_6s"
  | "youtube_shorts"
  | "google_demand_gen"
  | "pinterest"
  | "snapchat";

export interface PlatformProfile {
  id: PlatformId;
  platform: string;
  placements: string[];
  audience: { ageCore: string; genderSkew: string; mindset: string; tone: string };
  aspect: string | string[];
  canvas: [number, number] | [number, number][];
  durationSec: { ideal: number; range: [number, number]; max: number };
  /** Latest second by which the hook and key message must land. */
  hookSec: number;
  cutsPerSec: { first6s: number; body: number };
  soundMode: "on" | "off" | "mixed";
  styleTags: string[];
  captionStyle: string;
  voiceTone: string;
  musicStyle: string;
  ctaStyle: string;
  branding: string;
  safeZone: { top: number; bottom: number; left: number; right: number; note?: string };
  policy?: string[];
  doNots: string[];
}

export type HookFamily = "reveal" | "claim" | "native" | "demo";
export type AiFit = "high" | "med" | "low";

export interface HookDef {
  id: string; // H01..H35
  name: string;
  desc: string;
  categories: string;
  platforms: string;
  emotion: string;
  /** Keyframe recipe (what frame 1 shows). */
  keyframe: string;
  /** Motion recipe (camera / AI motion / edit move). */
  motion: string;
  durationSec: [number, number];
  /** Text-overlay pattern (T-STACK, T-POP, T-NATIVE, T-BADGE, T-UI …). */
  text: string;
  sfx: string;
  risk: string;
  aiFit: AiFit;
  perf: string;
  family: HookFamily;
  /** Frame 1 shows the product, bright (scores +3). */
  frameOneProduct: boolean;
}

export type EndCardId = "E01" | "E02" | "E03" | "E04" | "E05" | "E06" | "E07" | "E08" | "E09" | "E10" | "E11" | "E12";

export interface EndCardDef {
  id: EndCardId;
  name: string;
  useFor: string;
  /** Layout on a 1080×1920 canvas (everything readable inside the strict safe box). */
  layout: string;
  animation: string;
  copy: string[];
  platformFit: string;
  /** Facts that must exist (live) before this card may render. */
  requires: ("promoPct" | "comparePrice" | "couponCode" | "deadline" | "rating" | "multiSku" | "appInstall" | "ctvPlacement")[];
  policy: string;
}

export type CategoryId =
  | "electronics"
  | "camera"
  | "auto"
  | "kitchen"
  | "home_air"
  | "beauty"
  | "jewelry"
  | "sports"
  | "home"
  | "food"
  | "health"
  | "gifts"
  | "apps";

export type CampaignGoal = "cold" | "retarget" | "promo" | "awareness" | "app_install" | "lead";

export interface CreativeInputs {
  category: CategoryId;
  platform: PlatformId;
  goal: CampaignGoal;
  promo?: { pct?: number | null; comparePrice?: number | null; price?: number | null; priceCheckedAt?: string | null; code?: string | null; deadline?: string | null };
  assets?: { creatorFootage?: boolean; realTestFootage?: boolean; rating?: { value: number; count: number } | null; multiSku?: boolean; officialAngles?: number };
  /** ISO date the ad runs, for gifting windows. */
  runDate?: string;
  /** Placements beyond the phone feed (CTV, desktop). */
  ctv?: boolean;
  /**
   * Legacy legal/compliance gating (health-category hook drops, verified + fresh compare-at prices,
   * real test footage for torture tests, AI-content labels). Off by default: the brand owner runs
   * the boldest creative the real facts support. Data presence (a % / code / price to render) is
   * always required.
   */
  strictCompliance?: boolean;
}

export interface CreativeChoice {
  hooks: { hook: HookDef; score: number; why: string[] }[];
  endCard: EndCardDef;
  alternates: EndCardDef[];
  labels: string[];
  notes: string[];
}
