/**
 * Ad Studio in Studio — what the user can pick and how picks become variants. Pure, no DB.
 *
 * The ids must match the Mac pipeline (ad-studio repo): hook types = pipeline/hooks.mjs HOOK_TYPES,
 * engines = pipeline/generate.mjs ENGINES, sound profiles = pipeline/audio.mjs PROFILES.
 */

export const ADSTUDIO_HOOK_TYPES = [
  { id: "keep", label: "Keep storyboard hook", note: "Sharpen the hook already in this storyboard" },
  { id: "question", label: "Question", note: "A question the viewer answers in their head" },
  { id: "pain", label: "Pain point", note: "The viewer's problem, straight away" },
  { id: "bold", label: "Bold claim", note: "One counter-intuitive claim (facts only)" },
  { id: "curiosity", label: "Curiosity gap", note: "Something they must keep watching to resolve" },
  { id: "interrupt", label: "Pattern interrupt", note: "An unexpected image or reversal" },
  { id: "social", label: "Social proof", note: "Real reactions or habits, no invented numbers" },
  { id: "result", label: "Result first", note: "The outcome first, the product after" },
  { id: "offer", label: "Offer first", note: "The price or offer up front" },
  { id: "story", label: "Story", note: "One person's moment, like the start of a story" },
] as const;

export const ADSTUDIO_ENGINES = [
  { id: "remix", label: "Stock remix · free", note: "Stock footage + your product photos, fast cuts. No AI video, no cost — finishes without an approval step" },
  { id: "auto", label: "Auto · best model per shot type", note: "Veo 3.1 Lite for people and product, Seedance 1.5 Pro for b-roll (2026-11-06 bake-off)" },
  { id: "veo31lite", label: "Veo 3.1 Lite", note: "1080p" },
  { id: "veo31fast", label: "Veo 3.1 Fast", note: "720p" },
  { id: "kling3", label: "Kling 3.0", note: "720p" },
  { id: "seedance2", label: "Seedance 2.0", note: "720p" },
  { id: "seedance2fast", label: "Seedance 2.0 Fast", note: "720p, cheapest Seedance" },
  { id: "wan3", label: "Wan 3.0", note: "720p" },
  { id: "h3", label: "MiniMax H3", note: "2K" },
  { id: "omni", label: "Gemini Omni 1.2", note: "720p, always with audio" },
] as const;

export const ADSTUDIO_SOUND_PROFILES = ["bold_trap", "warm_glass", "hype_arcade", "tech_drive", "house_clean"] as const;

export type AdStudioHookType = (typeof ADSTUDIO_HOOK_TYPES)[number]["id"];
export type AdStudioEngine = (typeof ADSTUDIO_ENGINES)[number]["id"];

/** one batch may hold at most this many variants (hook types × engines) */
export const ADSTUDIO_MAX_VARIANTS = 6;

const HOOK_IDS = new Set<string>(ADSTUDIO_HOOK_TYPES.map((h) => h.id));
const ENGINE_IDS = new Set<string>(ADSTUDIO_ENGINES.map((e) => e.id));

export interface VariantPlan {
  hookType: AdStudioHookType;
  engine: AdStudioEngine;
  /** the first engine of each hook type writes the plan; the others copy it */
  leader: boolean;
  /** "auto:<k>": the Mac worker picks the k-th sound profile that fits the product (ad-studio pipeline/audio.mjs pickProfile) */
  soundProfile: (typeof ADSTUDIO_SOUND_PROFILES)[number] | `auto:${number}`;
}

export class AdStudioPickError extends Error {}

/**
 * Hook types × engines, in pick order. Each hook type gets its own sound profile (the same plan keeps the same
 * sound across engines, so an engine comparison only differs in the footage). The worker chooses the profiles that fit the
 * product (2026-11-17: a fixed rotation gave every single-hook batch the same hip-hop bed, skincare included).
 */
export function planVariants(hookTypes: string[], engines: string[]): VariantPlan[] {
  const hooks = [...new Set(hookTypes)].filter((h) => HOOK_IDS.has(h)) as AdStudioHookType[];
  const engs = [...new Set(engines)].filter((e) => ENGINE_IDS.has(e)) as AdStudioEngine[];
  if (!hooks.length) throw new AdStudioPickError("Pick at least one hook type");
  if (!engs.length) throw new AdStudioPickError("Pick at least one video engine");
  if (hooks.length * engs.length > ADSTUDIO_MAX_VARIANTS) {
    throw new AdStudioPickError(
      `${hooks.length} hook types × ${engs.length} engines = ${hooks.length * engs.length} videos; the limit is ${ADSTUDIO_MAX_VARIANTS} per batch`
    );
  }
  return hooks.flatMap((hookType, h) =>
    engs.map((engine, e) => ({
      hookType,
      engine,
      leader: e === 0,
      soundProfile: `auto:${h}` as const,
    }))
  );
}

export const hookLabel = (id: string) => ADSTUDIO_HOOK_TYPES.find((h) => h.id === id)?.label ?? id;
export const engineLabel = (id: string) => ADSTUDIO_ENGINES.find((e) => e.id === id)?.label ?? id;

export const ADSTUDIO_STEPS = ["ingest", "analyze", "product", "script", "generate", "voice", "render", "review"] as const;

/** a non-leader variant may start once its leader has a plan */
export const PLAN_READY = ["awaiting_approval", "approved", "generating", "completed"];
/** states the worker owns and must heartbeat */
export const WORKER_STATES = ["planning", "generating"];
export const ACTIVE_STATES = ["queued", "planning", "awaiting_approval", "approved", "generating"];

/** what the batch starts from (Ad Studio pipeline: source "xark" = storyboard/script, "xark-ref" = a reference video) */
export const ADSTUDIO_WORKFLOWS = [
  { id: "storyboard", label: "Optimise storyboard / script", note: "Second pass on a Studio storyboard or a Creative script: every planned selling point kept, hook rewritten" },
  { id: "reference", label: "Imitate a reference", note: "A competitor ad or any TikTok / Instagram link becomes the template; Xark's research supplies product, brand, cast and setting" },
  { id: "replace", label: "Imitate + replace", note: "Keeps the reference's shots, order, timing and camera; swaps only product, keywords, selling point and offer. You see the replace list before any spend" },
] as const;
export type AdStudioWorkflow = (typeof ADSTUDIO_WORKFLOWS)[number]["id"];
export const isWorkflow = (v: unknown): v is AdStudioWorkflow => ADSTUDIO_WORKFLOWS.some((w) => w.id === v);

/** Ad Studio imitation formats (pipeline/script.mjs SPEC_SCHEMA format) */
export const ADSTUDIO_FORMATS = [
  { id: "auto", label: "AI decides from the source" },
  { id: "product_lock", label: "Product lock · background swaps" },
  { id: "interview", label: "Street interview Q&A" },
  { id: "testimonial", label: "Documentary / testimonial" },
  { id: "single_scene", label: "Single scene, styled props" },
  { id: "montage", label: "Fast-cut montage" },
] as const;
export const isFormat = (v: unknown) => ADSTUDIO_FORMATS.some((f) => f.id === v);

/**
 * House hook library (services/creative/library.ts HOOKS, H01–H35) → the Ad Studio opening style that can be
 * enforced on shot 1 (pipeline/hooks.mjs HOOK_STYLES). Hooks not listed go to Ad Studio as a written brief only.
 */
export const OPENING_STYLE: Record<string, string> = {
  H01: "product_hero", H02: "product_hero", H03: "product_hero", H04: "product_hero", H05: "product_hero", H06: "product_hero", H16: "product_hero", H19: "product_hero",
  H14: "cap_bold", H15: "text_slab", H25: "text_slab", H27: "text_slab", H30: "cap_bold", H32: "text_slab",
  H17: "ai_talk", H18: "ai_talk", H07: "ai_talk",
  H23: "broll_open", H34: "broll_open",
  H28: "punch", H12: "whip",
};
export const END_CARD_THEMES = ["brand", "dark", "light", "festive"] as const;
