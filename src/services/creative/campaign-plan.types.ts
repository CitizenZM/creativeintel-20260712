/**
 * Shared contract for the campaign planner (services/creative/campaign-planner.ts) and the Studio
 * planning panel. A campaign plan is stored on Project.campaignPlan: one platform-fitted creative plan
 * per selected platform — 3 opening-hook variants, the end card, a timed beat map and the script per
 * hook variant. Keep this file dependency-light (types only).
 */
import type { CampaignGoal, EndCardId, HookFamily, PlatformId } from "./types";

export type BeatPurpose = "hook" | "pitch" | "proof" | "benefit" | "objection" | "offer" | "cta";

export interface PlanBeat {
  t0: number;
  t1: number;
  purpose: BeatPurpose;
  sellingPointId?: string;
  /** What the camera sees (shot description the director turns into a locked frame). */
  visual: string;
  shotType?: string;
  vo?: string;
  onScreenText?: string;
}

export interface HookVariant {
  hookId: string;
  name: string;
  family: HookFamily;
  durationSec: number;
  openingVisual: string;
  openingText: string;
  openingVO: string;
}

export interface EndCardPlan {
  id: EndCardId;
  name: string;
  button: string;
  headline?: string;
  /** Facts the renderer needs (pct, code, price, comparePrice, deadline, rating, …). */
  data?: Record<string, string | number>;
}

/** One ready-to-produce script: hook variant + shared body + end card. */
export interface PlanScript {
  hookId: string;
  title: string;
  beats: PlanBeat[];
}

export interface PlatformPlan {
  platform: PlatformId;
  label: string;
  durationSec: number;
  aspect: "9:16" | "1:1" | "4:5" | "16:9";
  audience: string;
  styleNotes: string;
  pacing: string;
  voice: string;
  captionStyle: string;
  musicMood: string;
  hookVariants: HookVariant[];
  endCard: EndCardPlan;
  endCardAlternates: EndCardPlan[];
  /** Body beats shared by all hook variants (after the hook, through the CTA). */
  beats: PlanBeat[];
  scripts: PlanScript[];
  /** Where the copy came from: the LLM pass, or the deterministic scaffold (model failure / mock). */
  copySource?: "llm" | "scaffold";
  /** Selector notes (dropped hooks, skipped end cards) and copy-pass fallbacks. */
  notes?: string[];
}

/**
 * User choices from the Studio planning panel, per platform: pinned hook ids (≤ 3, they lead the
 * auto picks) and a chosen end card (replaces the auto pick, which moves into the alternates).
 */
export type PlanOverrides = Partial<Record<PlatformId, { hookIds?: string[]; endCardId?: EndCardId }>>;

export interface CampaignPlan {
  version: 1;
  createdAt: string;
  productTitle: string;
  goal: CampaignGoal;
  bigIdea: string;
  keywords: string[];
  platforms: PlatformPlan[];
  notes: string[];
  /** Planning inputs, kept so a re-plan or the script writer can reuse them. */
  runDate?: string;
  promo?: {
    pct?: number | null;
    price?: number | null;
    comparePrice?: number | null;
    priceCheckedAt?: string | null;
    code?: string | null;
    deadline?: string | null;
  };
  /** Legal gating was on when this plan was made (default off). */
  strictCompliance?: boolean;
  /** Lead cast / shared set for plan-to-storyboard (Creative Agent setCast / setSetting). */
  cast?: string;
  setting?: string;
}
