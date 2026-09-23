// Script archetype registry — the single source of truth for what kinds of ad
// scripts the system can write. Every script carries a `videoType` and a
// `template`; the template's beat percentages drive HOOK/BODY/CTA tagging on
// the 2-second storyboard grid (see src/lib/storyboard-grid.ts).

export type VideoType = "PRODUCT_INTRO" | "PROMO_OFFER" | "AWARENESS_INTEREST";

export const VIDEO_TYPES: Record<VideoType, { label: string; goal: string }> = {
  PRODUCT_INTRO: {
    label: "Product intro",
    goal: "Explain what the product is, how it works and why it is better — drive consideration and conversion.",
  },
  PROMO_OFFER: {
    label: "Promo / offer",
    goal: "Push an offer, bundle, launch or deadline — drive immediate purchase.",
  },
  AWARENESS_INTEREST: {
    label: "Awareness / interest",
    goal: "Earn attention and affinity with story, trend or insight — drive saves, follows and recall.",
  },
};

export interface BeatSplit {
  hookPct: number;
  bodyPct: number;
  ctaPct: number;
}

export interface ScriptTemplate {
  id: string;
  name: string;
  videoType: VideoType;
  beats: BeatSplit;
  /** Named beats the body must move through, in order. */
  bodyBeats: string[];
  hookStyle: string;
  ctaStyle: string;
  /** Campaign platform ids (tiktok|instagram|youtube|tvc|amazon) where this template performs. */
  platforms: string[];
  /** Platform ids where this template must not be offered. */
  excludedPlatforms?: string[];
  whenToUse: string;
}

const T = (t: ScriptTemplate) => t;

export const SCRIPT_TEMPLATES: ScriptTemplate[] = [
  T({
    id: "PROBLEM_AGITATE_SOLVE",
    name: "Problem → Agitate → Solve",
    videoType: "PRODUCT_INTRO",
    beats: { hookPct: 20, bodyPct: 60, ctaPct: 20 },
    bodyBeats: ["agitate the pain", "reveal the product", "show the mechanism", "prove the outcome"],
    hookStyle: "Show the pain in the first frame — visible, relatable, slightly exaggerated.",
    ctaStyle: "Relief-framed: 'Stop [pain]. Get [product].'",
    platforms: ["tiktok", "instagram", "youtube"],
    whenToUse: "The pain is instantly visual and the product removes it.",
  }),
  T({
    id: "BEFORE_AFTER",
    name: "Before / After",
    videoType: "PRODUCT_INTRO",
    beats: { hookPct: 15, bodyPct: 65, ctaPct: 20 },
    bodyBeats: ["before state", "product applied", "transition moment", "after state with proof"],
    hookStyle: "Split-screen or hard cut between before and after in the first 2 seconds.",
    ctaStyle: "Outcome-framed: 'Get the after.'",
    platforms: ["tiktok", "instagram", "amazon"],
    whenToUse: "The transformation is filmable and fast.",
  }),
  T({
    id: "DEMO_HOW_IT_WORKS",
    name: "Demo / How it works",
    videoType: "PRODUCT_INTRO",
    beats: { hookPct: 15, bodyPct: 70, ctaPct: 15 },
    bodyBeats: ["set the scene", "step 1", "step 2", "result close-up"],
    hookStyle: "Product in action from frame one; no talking head.",
    ctaStyle: "Simple: 'See it work. Shop now.'",
    platforms: ["amazon", "youtube", "tiktok"],
    whenToUse: "The mechanism itself is the differentiator.",
  }),
  T({
    id: "THREE_REASONS_WHY",
    name: "3 reasons why",
    videoType: "PRODUCT_INTRO",
    beats: { hookPct: 15, bodyPct: 70, ctaPct: 15 },
    bodyBeats: ["reason 1 shown", "reason 2 shown", "reason 3 shown"],
    hookStyle: "'3 reasons I switched to…' with the number on screen.",
    ctaStyle: "Recap the three, then the link.",
    platforms: ["tiktok", "youtube", "instagram"],
    whenToUse: "There are three discrete, strong, demonstrable benefits.",
  }),
  T({
    id: "UNBOXING_ASMR",
    name: "Unboxing / ASMR",
    videoType: "PRODUCT_INTRO",
    beats: { hookPct: 20, bodyPct: 65, ctaPct: 15 },
    bodyBeats: ["box reveal", "first touch", "product reveal", "first use"],
    hookStyle: "Tactile sound + hands-only framing; no VO in the first 2 seconds.",
    ctaStyle: "Soft on-screen text only; keep the sound design intact.",
    platforms: ["tiktok", "instagram"],
    whenToUse: "Packaging, texture or sound sells the product.",
  }),
  T({
    id: "TUTORIAL_HOWTO",
    name: "Tutorial / How-to",
    videoType: "PRODUCT_INTRO",
    beats: { hookPct: 15, bodyPct: 70, ctaPct: 15 },
    bodyBeats: ["what you need", "step-by-step", "pro tip", "final result"],
    hookStyle: "'How to [outcome] in [time]' with the finished result flashed first.",
    ctaStyle: "'Get the full kit' / 'Save this for later'.",
    platforms: ["youtube", "instagram", "tiktok"],
    whenToUse: "The product needs teaching or has a routine around it.",
  }),
  T({
    id: "US_VS_THEM",
    name: "Us vs. them",
    videoType: "PRODUCT_INTRO",
    beats: { hookPct: 15, bodyPct: 65, ctaPct: 20 },
    bodyBeats: ["their way (weak)", "our way (strong)", "side-by-side proof", "why it matters"],
    hookStyle: "Side-by-side from frame one with a labelled 'them' and 'us'.",
    ctaStyle: "Switch-framed: 'Make the switch.'",
    platforms: ["amazon", "youtube", "tiktok"],
    whenToUse: "Displacing a known incumbent or category default.",
  }),
  T({
    id: "COMPARISON_SPEC",
    name: "Spec comparison",
    videoType: "PRODUCT_INTRO",
    beats: { hookPct: 15, bodyPct: 70, ctaPct: 15 },
    bodyBeats: ["spec 1 compared", "spec 2 compared", "spec 3 compared", "price / value"],
    hookStyle: "A comparison table or two products on a scale in frame one.",
    ctaStyle: "Value-framed: 'More for less. Add to cart.'",
    platforms: ["amazon", "youtube"],
    whenToUse: "Shoppers are comparing listings on specs and price.",
  }),
  T({
    id: "TESTIMONIAL_MASHUP",
    name: "Testimonial mash-up",
    videoType: "PRODUCT_INTRO",
    beats: { hookPct: 15, bodyPct: 65, ctaPct: 20 },
    bodyBeats: ["voice 1", "voice 2", "voice 3", "shared outcome"],
    hookStyle: "Rapid cuts of three people saying the same thing.",
    ctaStyle: "'Join [N] happy customers.'",
    platforms: ["tiktok", "instagram", "youtube"],
    whenToUse: "Review volume is the asset.",
  }),
  T({
    id: "FOUNDER_STORY",
    name: "Founder story",
    videoType: "AWARENESS_INTEREST",
    beats: { hookPct: 20, bodyPct: 65, ctaPct: 15 },
    bodyBeats: ["the frustration", "the decision", "the making", "the product today"],
    hookStyle: "Founder to camera with a confession: 'I made this because…'",
    ctaStyle: "Invitational: 'Try what we built.'",
    platforms: ["instagram", "youtube", "tvc"],
    whenToUse: "Trust or premium price needs a human origin.",
  }),
  T({
    id: "DAY_IN_THE_LIFE",
    name: "Day in the life",
    videoType: "AWARENESS_INTEREST",
    beats: { hookPct: 15, bodyPct: 70, ctaPct: 15 },
    bodyBeats: ["morning moment", "product fits naturally", "midday", "evening payoff"],
    hookStyle: "POV wake-up or routine start, product visible but not pushed.",
    ctaStyle: "Lifestyle-framed: 'Part of my routine — link below.'",
    platforms: ["tiktok", "instagram"],
    whenToUse: "The product's value is fit-into-routine, not a single feature.",
  }),
  T({
    id: "TREND_POV",
    name: "Trend / POV",
    videoType: "AWARENESS_INTEREST",
    beats: { hookPct: 25, bodyPct: 60, ctaPct: 15 },
    bodyBeats: ["set the POV", "the twist with product", "reaction"],
    hookStyle: "Native trend format — on-screen text POV line in frame one.",
    ctaStyle: "Minimal: brand handle and one line of text.",
    platforms: ["tiktok"],
    whenToUse: "A live trend sound or format fits the product.",
  }),
  T({
    id: "GREENSCREEN_COMMENTARY",
    name: "Green-screen commentary",
    videoType: "AWARENESS_INTEREST",
    beats: { hookPct: 25, bodyPct: 60, ctaPct: 15 },
    bodyBeats: ["show the post/stat", "react", "connect to product", "takeaway"],
    hookStyle: "Creator in front of a screenshot: 'Did you see this?'",
    ctaStyle: "'Link in bio if you want the fix.'",
    platforms: ["tiktok", "instagram"],
    whenToUse: "Reacting to a review, post or statistic in the category.",
  }),
  T({
    id: "MYTH_BUST",
    name: "Myth bust",
    videoType: "AWARENESS_INTEREST",
    beats: { hookPct: 25, bodyPct: 60, ctaPct: 15 },
    bodyBeats: ["state the myth", "why it is wrong", "what actually works", "product as the proof"],
    hookStyle: "'Stop doing X' or 'X is a lie' with a bold text card.",
    ctaStyle: "'Do it right — shop here.'",
    platforms: ["tiktok", "youtube"],
    whenToUse: "A common misconception blocks adoption.",
  }),
  T({
    id: "STAT_SHOCK",
    name: "Stat shock",
    videoType: "AWARENESS_INTEREST",
    beats: { hookPct: 25, bodyPct: 60, ctaPct: 15 },
    bodyBeats: ["the number", "what it means for you", "the fix", "the proof"],
    hookStyle: "One credible hard number, huge on screen, read aloud.",
    ctaStyle: "'Be the [x]% who…'",
    platforms: ["tiktok", "youtube", "instagram"],
    whenToUse: "There is one surprising, sourceable statistic.",
  }),
  T({
    id: "SOCIAL_PROOF_STACK",
    name: "Social proof stack",
    videoType: "PROMO_OFFER",
    beats: { hookPct: 20, bodyPct: 55, ctaPct: 25 },
    bodyBeats: ["press logos", "star rating + count", "UGC clips", "best-seller claim"],
    hookStyle: "'[N] five-star reviews and counting' over fast UGC cuts.",
    ctaStyle: "Proof-then-offer: 'See why — [offer] today.'",
    platforms: ["tiktok", "instagram", "youtube"],
    whenToUse: "Press, ratings and UGC exist together.",
  }),
  T({
    id: "OBJECTION_HANDLING",
    name: "Objection handling",
    videoType: "PROMO_OFFER",
    beats: { hookPct: 20, bodyPct: 55, ctaPct: 25 },
    bodyBeats: ["name the objection", "answer it with proof", "second objection", "answer", "risk reversal"],
    hookStyle: "'You're probably thinking…' then the exact objection.",
    ctaStyle: "Risk-reversal: guarantee / free returns / trial.",
    platforms: ["youtube", "instagram"],
    whenToUse: "A known price, fit or trust blocker stalls purchase.",
  }),
  T({
    id: "QA_FAQ",
    name: "Q&A / FAQ",
    videoType: "PROMO_OFFER",
    beats: { hookPct: 20, bodyPct: 55, ctaPct: 25 },
    bodyBeats: ["question 1 + answer", "question 2 + answer", "question 3 + answer"],
    hookStyle: "'Your top 3 questions, answered' with question cards.",
    ctaStyle: "'Nothing left to wonder — order now.'",
    platforms: ["youtube", "amazon"],
    whenToUse: "The same pre-purchase questions repeat in reviews or support.",
  }),
  T({
    id: "OFFER_LED_PROMO",
    name: "Offer-led promo",
    videoType: "PROMO_OFFER",
    beats: { hookPct: 15, bodyPct: 50, ctaPct: 35 },
    bodyBeats: ["the offer stated", "what you get", "why now"],
    hookStyle: "The offer in the first frame: '[X]% off — this week only.'",
    ctaStyle: "Repeated, on-screen code, countdown or deadline.",
    platforms: ["tiktok", "instagram", "youtube"],
    excludedPlatforms: ["amazon"],
    whenToUse: "The discount or bundle is the message.",
  }),
  T({
    id: "SCARCITY_LAUNCH",
    name: "Scarcity / launch",
    videoType: "PROMO_OFFER",
    beats: { hookPct: 20, bodyPct: 50, ctaPct: 30 },
    bodyBeats: ["it's here / it's back", "what's new", "how many / how long"],
    hookStyle: "'Back in stock' or 'Dropping now' with a live counter.",
    ctaStyle: "Deadline or quantity on screen until the last frame.",
    platforms: ["tiktok", "instagram"],
    excludedPlatforms: ["amazon"],
    whenToUse: "A drop, restock or deadline is real.",
  }),
];

const BY_ID = new Map(SCRIPT_TEMPLATES.map((t) => [t.id, t]));

export function getScriptTemplate(id: string | null | undefined): ScriptTemplate | null {
  if (!id) return null;
  return BY_ID.get(id.toUpperCase()) ?? null;
}

export function isVideoType(v: unknown): v is VideoType {
  return v === "PRODUCT_INTRO" || v === "PROMO_OFFER" || v === "AWARENESS_INTEREST";
}

/** Templates viable for a campaign platform; all templates when platform is unknown. */
export function templatesForPlatform(platformId?: string | null): ScriptTemplate[] {
  const p = platformId?.toLowerCase();
  if (!p) return SCRIPT_TEMPLATES;
  return SCRIPT_TEMPLATES.filter((t) => !t.excludedPlatforms?.includes(p));
}

/** Which funnel types lead the batch for each creative goal. */
const GOAL_TYPE_ORDER: Record<string, VideoType[]> = {
  conversion: ["PROMO_OFFER", "PRODUCT_INTRO", "AWARENESS_INTEREST"],
  storytelling: ["AWARENESS_INTEREST", "PRODUCT_INTRO", "PROMO_OFFER"],
};

/**
 * Default batch: spread across the three video types, best-fit platforms
 * first; the project's goal type decides which type leads.
 */
export function defaultTemplateBatch(
  platformId?: string | null,
  count = 10,
  goalType?: string | null
): ScriptTemplate[] {
  const p = platformId?.toLowerCase();
  const pool = templatesForPlatform(p);
  const ranked = [...pool].sort((a, b) => {
    const af = p && a.platforms.includes(p) ? 0 : 1;
    const bf = p && b.platforms.includes(p) ? 0 : 1;
    return af - bf;
  });
  const out: ScriptTemplate[] = [];
  const byType: Record<VideoType, ScriptTemplate[]> = {
    PRODUCT_INTRO: [],
    PROMO_OFFER: [],
    AWARENESS_INTEREST: [],
  };
  for (const t of ranked) byType[t.videoType].push(t);
  const order: VideoType[] = (goalType && GOAL_TYPE_ORDER[goalType]) || [
    "PRODUCT_INTRO",
    "AWARENESS_INTEREST",
    "PROMO_OFFER",
  ];
  let i = 0;
  while (out.length < Math.min(count, pool.length)) {
    const list = byType[order[i % order.length]];
    const next = list.shift();
    if (next) out.push(next);
    i++;
    if (i > pool.length * 3) break;
  }
  return out;
}

export const DEFAULT_BEATS: BeatSplit = { hookPct: 20, bodyPct: 60, ctaPct: 20 };

/** Prompt-ready description of a template. */
export function describeTemplate(t: ScriptTemplate, durationSec: number): string {
  const hookSec = Math.round((durationSec * t.beats.hookPct) / 100);
  const ctaSec = Math.round((durationSec * t.beats.ctaPct) / 100);
  const bodySec = durationSec - hookSec - ctaSec;
  return [
    `TEMPLATE: ${t.name} (${t.id}) — VIDEO TYPE: ${t.videoType} — ${VIDEO_TYPES[t.videoType].goal}`,
    `TIME BUDGET: HOOK 0–${hookSec}s · BODY ${hookSec}–${hookSec + bodySec}s · CTA ${hookSec + bodySec}–${durationSec}s`,
    `HOOK STYLE: ${t.hookStyle}`,
    `BODY BEATS (in order): ${t.bodyBeats.join(" → ")}`,
    `CTA STYLE: ${t.ctaStyle}`,
    `USE WHEN: ${t.whenToUse}`,
  ].join("\n");
}
