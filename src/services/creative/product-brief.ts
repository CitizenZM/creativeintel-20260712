/**
 * Product brief ("sp-1") — one LLM pass that turns a product page (+ reviews, Q&A, competitors,
 * keyword data) into a ranked, compliant, filmable brief: category, audience, primary job, one big
 * idea, 5–8 selling points (claim → benefit → proof → proof VISUAL), objections, keywords and a beat
 * map. Research: out/research/ad-research/01-selling-points.md §4.
 *
 * The LLM writes the content; ranking is recomputed here from its 0–1 sub-scores (models are bad at
 * arithmetic), high-risk claims without on-page substantiation are discounted, blocked claims dropped.
 */
import { z } from "zod";
import { CATEGORY_PACKS } from "./category-packs.data";
import type { CategoryId } from "./types";

export const SP_CATEGORIES = [
  "tv",
  "tablet_laptop",
  "kitchen_appliance",
  "home_air_cleaning",
  "beauty_skincare",
  "fashion_jewelry",
  "sports_outdoor_cycling",
  "auto_accessories",
  "camera_creator",
  "food_beverage",
  "home_furniture",
  "pet",
  "other",
] as const;
export type SpCategory = (typeof SP_CATEGORIES)[number];

/** sp-1 category → creative-library category (hook / end-card matrix). */
export const TO_CREATIVE_CATEGORY: Record<SpCategory, CategoryId> = {
  tv: "electronics",
  tablet_laptop: "electronics",
  kitchen_appliance: "kitchen",
  home_air_cleaning: "home_air",
  beauty_skincare: "beauty",
  fashion_jewelry: "jewelry",
  sports_outdoor_cycling: "sports",
  auto_accessories: "auto",
  camera_creator: "camera",
  food_beverage: "food",
  home_furniture: "home",
  pet: "home",
  other: "gifts",
};

const KEYWORDS: [SpCategory, RegExp][] = [
  ["tv", /\b(tv|television|mini[- ]?led|qled|oled|google tv|roku tv|projector|monitor)\b/i],
  ["tablet_laptop", /\b(tablet|laptop|ipad|chromebook|notebook pc|nxtpaper|e-?reader|stylus)\b/i],
  ["camera_creator", /\b(camera|action cam|360°?|gimbal|webcam|vlog|insta360|lens)\b/i],
  ["kitchen_appliance", /\b(air fryer|blender|oven|kettle|coffee maker|espresso|cooker|toaster|juicer|mixer)\b/i],
  ["home_air_cleaning", /\b(air purifier|purifier|humidifier|dehumidifier|vacuum|hepa|air quality|fan)\b/i],
  ["beauty_skincare", /\b(serum|skin ?care|moisturi[sz]er|cleanser|hair dryer|straightener|makeup|lipstick|sunscreen|cream)\b/i],
  ["fashion_jewelry", /\b(necklace|earrings?|bracelet|ring|jewel(le)?ry|pendant|vermeil|sterling)\b/i],
  ["sports_outdoor_cycling", /\b(bike|bicycle|cycling|helmet|camping|hiking|outdoor|fitness|gym)\b/i],
  ["auto_accessories", /\b(car ?play|android auto|dash ?cam|car mount|vehicle|car charger|ottocast)\b/i],
  ["pet", /\b(dog|cat|pet|puppy|kitten|litter)\b/i],
  ["home_furniture", /\b(sofa|mattress|bedding|pillow|chair|desk|furniture|duvet|sheets)\b/i],
  ["food_beverage", /\b(snack|chocolate|tea|coffee beans|beverage|drink|protein bar|sauce)\b/i],
];

/** Cheap keyword classifier used to pick the category pack before the LLM call (it may override). */
export function classifyProduct(text: string): SpCategory {
  for (const [cat, re] of KEYWORDS) if (re.test(text)) return cat;
  return "other";
}

export interface ProductPageInput {
  url?: string | null;
  title: string;
  brand?: string | null;
  bullets?: string[];
  description?: string | null;
  specs?: Record<string, string>;
  price?: number | null;
  listPrice?: number | null;
  rating?: number | null;
  reviewCount?: number | null;
  /** Ideally stratified: 5★, 3–4★ and 1–2★, each truncated to ~400 chars. */
  reviews?: { stars: number; text: string }[];
  qa?: { q: string; a: string }[];
  competitors?: { title: string; bullets?: string[]; reviews?: { stars: number; text: string }[] }[];
  keywordData?: Record<string, string[]>;
  platforms?: string[];
  durationSec?: number;
}

const num01 = z.coerce.number().min(0).max(1).catch(0.5);
const sellingPointSchema = z.object({
  id: z.string().catch(""),
  claim: z.string(),
  advantage: z.string().catch(""),
  benefit: z.string(),
  proofVisual: z.object({
    device: z.string().catch("other"),
    shot: z.string(),
    overlayText: z.string().optional().catch(undefined),
    durationSec: z.coerce.number().catch(3),
  }),
  sourceEvidence: z.array(z.object({ type: z.string().catch("page_copy"), quote: z.string(), location: z.string().optional().catch(undefined) })).catch([]),
  evidenceStrength: z.enum(["certified", "measured_spec", "review_consensus", "claimed"]).catch("claimed"),
  driver: z.string().catch(""),
  awarenessStage: z.string().catch("product_aware"),
  competitorUsage: z.boolean().catch(false),
  uniqueness: num01,
  scores: z.object({ buyerImportance: num01, evidenceStrength: num01, differentiation: num01, visualizability: num01, emotionalPull: num01 }).partial().catch({}),
  priority: z.coerce.number().catch(99),
  compliance: z
    .object({
      claimType: z.string().catch("puffery"),
      riskLevel: z.enum(["low", "medium", "high", "blocked"]).catch("medium"),
      safeWording: z.string().catch(""),
      requiredDisclosure: z.string().optional().catch(undefined),
    })
    .catch({ claimType: "puffery", riskLevel: "medium", safeWording: "" }),
});

export const productBriefSchema = z.object({
  version: z.literal("sp-1").catch("sp-1"),
  product: z.object({ name: z.string().catch(""), brand: z.string().catch(""), model: z.string().optional().catch(undefined), price: z.coerce.number().optional().catch(undefined) }).catch({ name: "", brand: "" }),
  category: z.enum(SP_CATEGORIES).catch("other"),
  audience: z.object({ primary: z.string().catch(""), secondary: z.array(z.string()).catch([]), awarenessStage: z.string().catch("problem_aware") }).catch({ primary: "", secondary: [], awarenessStage: "problem_aware" }),
  primaryJob: z.object({ statement: z.string().catch(""), functional: z.string().catch(""), emotional: z.string().catch(""), social: z.string().optional().catch(undefined) }).catch({ statement: "", functional: "", emotional: "" }),
  forces: z.object({ push: z.array(z.string()).catch([]), pull: z.array(z.string()).catch([]), anxieties: z.array(z.string()).catch([]), habits: z.array(z.string()).catch([]) }).catch({ push: [], pull: [], anxieties: [], habits: [] }),
  categoryEntryPoints: z.array(z.object({ cep: z.string(), w: z.string().catch("when"), hookIdea: z.string().catch("") })).catch([]),
  bigIdea: z.object({ proposition: z.string(), alternates: z.array(z.string()).catch([]) }).catch({ proposition: "", alternates: [] }),
  sellingPoints: z.array(sellingPointSchema).catch([]),
  objections: z.array(z.object({ objection: z.string(), source: z.string().catch("category_norm"), answer: z.string().catch(""), bustingVisual: z.string().catch("") })).catch([]),
  competitorGaps: z.array(z.object({ gap: z.string(), evidence: z.string().catch(""), ourProof: z.string().catch("") })).catch([]),
  keywords: z.array(z.object({ term: z.string(), type: z.string().catch("feature"), intent: z.string().catch("consideration"), score: z.coerce.number().catch(0.5), placement: z.array(z.string()).catch([]) })).catch([]),
  complianceNotes: z.array(z.object({ issue: z.string(), rule: z.string().catch(""), action: z.string().catch("") })).catch([]),
  beatMap: z.object({ durationSec: z.coerce.number().catch(15), beats: z.array(z.object({ t: z.string(), purpose: z.string(), sellingPointId: z.string().optional().catch(undefined), visual: z.string().catch(""), overlayText: z.string().optional().catch(undefined), vo: z.string().optional().catch(undefined) })).catch([]) }).catch({ durationSec: 15, beats: [] }),
  gaps: z.array(z.string()).catch([]),
});
export type ProductBrief = z.infer<typeof productBriefSchema>;
export type BriefSellingPoint = ProductBrief["sellingPoints"][number] & { priorityScore: number };

const EVIDENCE_WEIGHT: Record<string, number> = { certified: 1, measured_spec: 0.8, review_consensus: 0.6, claimed: 0.3 };

/** priorityScore = .30·BI + .25·ES + .20·D + .15·V + .10·EP; ×0.6 for unsubstantiated high risk; blocked dropped. */
export function rankSellingPoints(points: ProductBrief["sellingPoints"], max = 8): BriefSellingPoint[] {
  const ranked = points
    .filter((p) => p.compliance.riskLevel !== "blocked" && p.proofVisual?.shot?.trim() && p.claim.trim())
    .map((p) => {
      const s = p.scores ?? {};
      const es = s.evidenceStrength ?? EVIDENCE_WEIGHT[p.evidenceStrength] ?? 0.3;
      let score = 0.3 * (s.buyerImportance ?? 0.5) + 0.25 * es + 0.2 * (s.differentiation ?? p.uniqueness ?? 0.3) + 0.15 * (s.visualizability ?? 0.5) + 0.1 * (s.emotionalPull ?? 0.5);
      const substantiated = p.sourceEvidence.some((e) => ["spec", "certification", "page_copy"].includes(e.type));
      if (p.compliance.riskLevel === "high" && !substantiated) score *= 0.6;
      return { ...p, priorityScore: Math.round(score * 1000) / 1000 };
    })
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, max);
  return ranked.map((p, i) => ({ ...p, id: p.id || `sp${i + 1}`, priority: i + 1 }));
}

export const BRIEF_SYSTEM = `You are CreativeIntel's Selling-Point Extractor. You turn one product page (plus optional reviews, Q&A, competitor pages and keyword data) into a ranked, compliant, FILMABLE brief for a 15–30 s vertical video ad (TikTok, Reels, Shorts, Meta, YouTube). Output ONLY valid JSON matching schema "sp-1".

PRINCIPLES
1. Every selling point = Feature → Advantage → Benefit → Proof → Proof VISUAL (a concrete shot that proves it on a phone screen in ≤ 8 s: split_screen, measurement_overlay, time_lapse, torture_test, pov_use, scale_reference, unbox_setup, before_after, macro_texture, screen_recording, comparison_chart). Can't film it → low visualizability.
2. Evidence first: quote the exact page text, spec, certification or review snippet in sourceEvidence. Never invent numbers, tests, certifications, awards, reviews or testimonials. Missing data goes in "gaps".
3. Buyer language over brand language: use review/Q&A wording for "benefit". 2–4★ = real tradeoffs, 1–2★ = anxieties, 5★ = aha moments.
4. Jobs-to-be-Done: primaryJob "When…, I want to…, so I can…" (functional, emotional, social) + Four Forces (push, pull, anxieties, habits). Anxieties/habits become objections with a busting visual.
5. Category Entry Points (why/when/where/with whom/while/with what/feeling): 3–5 buying situations usable as hooks.
6. One big idea: a single-minded proposition ≤ 12 words on the #1 selling point, plus 3 alternate hero angles (different pain, persona or format) for separate ad variants.
7. Hook rule: the hero proof is visible in seconds 0–3 and readable with sound off (≤ 6-word overlay); brand by 3–5 s; clear CTA at the end.
8. Compliance is part of extraction: claimType, riskLevel (low/medium/high/blocked), safeWording, requiredDisclosure. Use the CATEGORY PACK and CROSS-CATEGORY rules below. Blocked claims never enter the beat map.
9. Scores 0–1: buyerImportance (category driver weight × review mention share), evidenceStrength (certified 1, measured spec .8, review consensus .6, claimed .3), differentiation (vs competitors; table stakes ≈ .2), visualizability, emotionalPull. Return 5–8 selling points.
10. Keywords: 10–15 search keywords, 5–8 hashtags (2 broad, 3–4 niche, 1–2 trending), 3 CTA phrases, each with placement (hook_text / voiceover / caption / hashtag / seo).
11. Beat map: 15 s (or 30 s if asked) beats hook / demo / proof / objection / brand_cta using only non-blocked points.

SCHEMA sp-1 (keys): version, product{name,brand,model,price}, category, audience{primary,secondary[],awarenessStage}, primaryJob{statement,functional,emotional,social}, forces{push[],pull[],anxieties[],habits[]}, categoryEntryPoints[{cep,w,hookIdea}], bigIdea{proposition,alternates[3]}, sellingPoints[{id,claim,advantage,benefit,proofVisual{device,shot,overlayText,durationSec},sourceEvidence[{type,quote,location}],evidenceStrength,driver,awarenessStage,competitorUsage,uniqueness,scores{buyerImportance,evidenceStrength,differentiation,visualizability,emotionalPull},priority,compliance{claimType,riskLevel,safeWording,requiredDisclosure}}], objections[{objection,source,answer,bustingVisual}], competitorGaps[{gap,evidence,ourProof}], keywords[{term,type,intent,score,placement[]}], complianceNotes[{issue,rule,action}], beatMap{durationSec,beats[{t,purpose,sellingPointId,visual,overlayText,vo}]}, gaps[].

SELF-CHECK: each selling point has sourceEvidence and proofVisual.shot; no number that is not in the inputs; every high-risk claim has safeWording + requiredDisclosure; JSON only, no prose.`;

function clip(s: string | null | undefined, n: number): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

/** Stratify reviews (5★ / 3–4★ / 1–2★, up to `per` each, 400 chars) so anxieties aren't buried. */
export function stratifyReviews(reviews: { stars: number; text: string }[] = [], per = 25) {
  const band = (lo: number, hi: number) => reviews.filter((r) => r.stars >= lo && r.stars <= hi).slice(0, per).map((r) => ({ stars: r.stars, text: clip(r.text, 400) }));
  return [...band(5, 5), ...band(3, 4), ...band(1, 2)];
}

export function buildBriefPrompts(input: ProductPageInput): { system: string; user: string; guessedCategory: SpCategory } {
  const guessedCategory = classifyProduct([input.title, input.description, ...(input.bullets ?? [])].join(" "));
  const pack = CATEGORY_PACKS[guessedCategory] ?? "";
  const system = `${BRIEF_SYSTEM}\n\nCATEGORY PACK (pre-classified as "${guessedCategory}" — override the category if clearly wrong):\n${pack}\n\nCROSS-CATEGORY RULES:\n${CATEGORY_PACKS.compliance_all ?? ""}`;
  const page = {
    url: input.url ?? undefined,
    title: input.title,
    brand: input.brand ?? undefined,
    bullets: (input.bullets ?? []).slice(0, 20).map((b) => clip(b, 300)),
    description: clip(input.description, 3000),
    specs: input.specs,
    price: input.price ?? undefined,
    listPrice: input.listPrice ?? undefined,
    rating: input.rating ?? undefined,
    reviewCount: input.reviewCount ?? undefined,
    reviews: stratifyReviews(input.reviews),
    qa: (input.qa ?? []).slice(0, 20).map((x) => ({ q: clip(x.q, 200), a: clip(x.a, 300) })),
    competitors: (input.competitors ?? []).slice(0, 3).map((c) => ({ title: c.title, bullets: (c.bullets ?? []).slice(0, 8), reviews: stratifyReviews(c.reviews, 8) })),
    keywordData: input.keywordData,
  };
  const user = `Platforms: ${(input.platforms ?? ["tiktok", "instagram_reels", "youtube_shorts"]).join(", ")}. Beat map length: ${input.durationSec ?? 15} s.\nINPUT:\n${JSON.stringify(page)}`;
  return { system, user, guessedCategory };
}

/** Normalise a raw model answer into a ranked brief (also used by tests with fixture JSON). */
export function finalizeBrief(raw: unknown, guessedCategory: SpCategory = "other"): ProductBrief & { sellingPoints: BriefSellingPoint[] } {
  const parsed = productBriefSchema.parse(raw);
  const category = parsed.category === "other" && guessedCategory !== "other" ? guessedCategory : parsed.category;
  const sellingPoints = rankSellingPoints(parsed.sellingPoints);
  const keep = new Set(sellingPoints.map((p) => p.id));
  const blocked = new Set(parsed.sellingPoints.filter((p) => p.compliance.riskLevel === "blocked").map((p) => p.id));
  const beats = parsed.beatMap.beats.filter((b) => !b.sellingPointId || (keep.has(b.sellingPointId) && !blocked.has(b.sellingPointId)));
  const gaps = [...parsed.gaps];
  if (!(parsed.sellingPoints.length && sellingPoints.length)) gaps.push("no filmable, non-blocked selling points returned");
  return { ...parsed, category, sellingPoints, beatMap: { ...parsed.beatMap, beats }, gaps };
}

/** One structured LLM call (deep tier) → ranked brief. */
export async function extractProductBrief(input: ProductPageInput) {
  const { analyzeWithClaude } = await import("@/services/ai/claude-client");
  const { system, user, guessedCategory } = buildBriefPrompts(input);
  const raw = await analyzeWithClaude({ systemPrompt: system, userPrompt: user, responseSchema: z.unknown(), maxTokens: 7000, tier: "deep" });
  return finalizeBrief(raw, guessedCategory);
}
