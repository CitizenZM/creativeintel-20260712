/**
 * Ad Cloner — recreate a winning ad's STRUCTURE for our product (Creatify's "Ad Cloner").
 *
 *   referenceFrom*   a stored teardown (AdTeardown + contentAsset/competitor), a saved structure
 *                    (AdStructure) or raw teardown JSON → one normalised reference: contiguous beats
 *                    with timings, roles, shot grammar, VO, on-screen text, hook, CTA, offer, pacing.
 *   classifyHook     the reference opening → our hook library H01–H35: weighted rules on the hook
 *                    text / visual / teardown hook type; an LLM pick only when the rules are unsure;
 *                    the hook-type map when the model fails.
 *   mapEndCard       the reference close → E01–E12, then checked against OUR facts (a coupon close
 *                    needs our code, a % badge our discount) with an offer-preserving fallback.
 *   scaffoldClone    deterministic: a CampaignPlan-compatible PlatformPlan whose beat timings and shot
 *                    grammar are the reference's (scaled only past the platform's max length), every
 *                    beat's content remapped to our ranked selling points and proof shots.
 *   cloneAd          classify + scaffold + ONE copy pass (VO + on-screen text, mirroring each
 *                    reference line's move, never its words); any model failure keeps the scaffold.
 *   mergeClonedPlan  the clone into Project.campaignPlan under "Cloned from <ref>".
 *
 * Contract: ./campaign-plan.types.ts. Pure except the injected / default LLM.
 */
import { z } from "zod";
import type { CampaignPlan, BeatPurpose, PlanBeat, PlatformPlan } from "./campaign-plan.types";
import { buildScripts, mergeCampaignCopy, normalizeGoal, normalizePlatform, offerFacts, offerLine, scaffoldPlatformPlan, type LlmFn, type OfferFacts, type PromoInput } from "./campaign-planner";
import { END_CARDS, HOOKS, endCardById, hookById, platformProfile } from "./library";
import type { ProductBrief } from "./product-brief";
import type { CampaignGoal, EndCardId, PlatformId } from "./types";

/* ───────────────────────── reference ───────────────────────── */

export interface ReferenceBeat {
  startSec: number;
  endSec: number;
  role: string;
  visual: string;
  vo: string;
  onScreenText: string;
  /** Shot grammar: given by the reference, else read from its visual (shotGrammar). */
  shot: string;
}

export interface ReferenceAdSpec {
  id: string | null;
  kind: "teardown" | "structure" | "raw";
  /** "<owner> — <title>", used in the clone's label. */
  label: string;
  title: string;
  owner: string | null;
  platform: string | null;
  goalType: string | null;
  durationSec: number;
  hookType: string;
  hookText: string;
  hookVisual: string;
  beats: ReferenceBeat[];
  proofDevices: { type: string; description: string }[];
  ctaText: string;
  ctaPlacement: string;
  offer: string;
  pacing: string;
  music: string;
  whyItWorks: string;
}

const str = z.string().nullish().catch(null).transform((s) => (s ?? "").replace(/\s+/g, " ").trim());
const num = z.coerce.number().catch(NaN);
const rawBeatSchema = z.object({ startSec: num, endSec: num, role: str, visual: str, vo: str, onScreenText: str, shotType: str, shot: str });
const rawReferenceSchema = z.object({
  id: str,
  title: str,
  sourceTitle: str,
  owner: str,
  sourceOwner: str,
  competitor: z.object({ name: str }).nullish().catch(null),
  contentAsset: z.object({ title: str, durationSec: num.optional(), platform: str, viewCount: num.optional() }).nullish().catch(null),
  platform: str,
  goalType: str,
  durationSec: num.optional(),
  hookType: str,
  hookText: str,
  hookVisual: str,
  beats: z.array(z.unknown()).catch([]),
  proofDevices: z.array(z.object({ type: str, description: str })).nullish().catch(null),
  ctaText: str,
  ctaPlacement: str,
  offer: str,
  pacing: str,
  music: str,
  musicMood: str,
  whyItWorks: str,
});

const r1 = (x: number) => Math.round(x * 10) / 10;
const squash = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const clip = (s: string | null | undefined, n: number) => {
  const t = squash(s);
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};
const clipWords = (s: string | null | undefined, n: number) => {
  const w = squash(s).split(" ").filter(Boolean);
  return w.length > n ? w.slice(0, Math.max(1, n)).join(" ").replace(/[,;:—-]+$/, "") : w.join(" ");
};
const stripEnd = (s: string) => s.replace(/[.!?…\s]+$/, "");
/** A cut phrase never ends on a dangling function word ("… without the"). */
const tidyEnd = (s: string) => s.replace(/(\s+(the|a|an|and|or|of|to|with|without|for|in|on|your|my))+$/i, "");
const lowerFirst = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);
const voBudget = (sec: number) => Math.max(2, Math.floor(sec * 2.5));
const keyword = (s: string) => clipWords(stripEnd(squash(s)).replace(/[!?]/g, ""), 4).toUpperCase();
/** The first option that fits the spoken word budget; otherwise the first one, cut on a word. */
function fitVO(options: string[], budget: number): string {
  const opts = options.map(squash).filter(Boolean);
  const fit = opts.find((o) => o.split(" ").length <= budget);
  return fit ?? `${stripEnd(clipWords(opts[0] ?? "", budget))}.`;
}

/**
 * Normalise any reference shape into contiguous beats starting at 0: sorted by start, overlaps cut at
 * the next beat's start, gaps closed by stretching the earlier beat. Throws without ≥ 2 timed beats.
 */
export function normalizeReference(raw: unknown, kind: ReferenceAdSpec["kind"] = "raw"): ReferenceAdSpec {
  const r = rawReferenceSchema.parse(raw ?? {});
  const beats0 = r.beats
    .map((b) => rawBeatSchema.safeParse(b))
    .filter((p) => p.success && Number.isFinite(p.data.startSec) && Number.isFinite(p.data.endSec) && p.data.endSec > p.data.startSec)
    .map((p) => p.data!)
    .sort((a, b) => a.startSec - b.startSec);
  if (beats0.length < 2) throw new Error("The reference has no beat timeline (needs at least 2 timed beats)");
  // Absolute positions are the structure: a late first beat is stretched back to 0, never shifted.
  const beats: ReferenceBeat[] = beats0.map((b, i) => {
    const next = beats0[i + 1];
    const start = i === 0 ? 0 : r1(b.startSec);
    const end = next ? r1(next.startSec) : r1(b.endSec);
    return { startSec: start, endSec: end, role: (b.role || (i === 0 ? "hook" : "beat")).toLowerCase(), visual: b.visual, vo: b.vo, onScreenText: b.onScreenText, shot: shotGrammar(b.visual, b.shotType || b.shot) };
  });
  // Contiguity after rounding: each beat starts where the previous one ends.
  for (let i = 1; i < beats.length; i++) beats[i].startSec = beats[i - 1].endSec;
  const valid = beats.filter((b) => b.endSec > b.startSec);
  const owner = r.owner || r.sourceOwner || r.competitor?.name || "";
  const title = r.title || r.sourceTitle || r.contentAsset?.title || "Reference ad";
  const durationSec = valid[valid.length - 1].endSec;
  return {
    id: r.id || null,
    kind,
    label: [owner, title].filter(Boolean).join(" — "),
    title,
    owner: owner || null,
    platform: r.platform || r.contentAsset?.platform || null,
    goalType: r.goalType || null,
    durationSec,
    hookType: (r.hookType || "").toLowerCase().replace(/[\s-]+/g, "_"),
    hookText: r.hookText || valid[0].onScreenText || valid[0].vo,
    hookVisual: r.hookVisual || valid[0].visual,
    beats: valid,
    proofDevices: (r.proofDevices ?? []).filter((d) => d.type || d.description),
    ctaText: r.ctaText,
    ctaPlacement: r.ctaPlacement,
    offer: r.offer,
    pacing: r.pacing,
    music: r.music || r.musicMood,
    whyItWorks: r.whyItWorks,
  };
}

/** A stored AdTeardown row (with contentAsset / competitor included when available). */
export const referenceFromTeardown = (t: unknown) => normalizeReference(t, "teardown");
/** A saved AdStructure row. */
export const referenceFromStructure = (s: unknown) => normalizeReference(s, "structure");

/** Any accepted shape: a structure row (sourceTitle), a teardown row, or raw teardown JSON. */
export function toReference(raw: unknown): ReferenceAdSpec {
  const o = (raw ?? {}) as Record<string, unknown>;
  if (o.kind && Array.isArray(o.beats) && typeof o.label === "string" && typeof o.durationSec === "number") return o as unknown as ReferenceAdSpec;
  if ("sourceTitle" in o) return referenceFromStructure(raw);
  if ("contentAssetId" in o || "contentAsset" in o || "hookVisual" in o) return referenceFromTeardown(raw);
  return normalizeReference(raw);
}

export const cloneLabel = (ref: Pick<ReferenceAdSpec, "label">) => `Cloned from ${clip(ref.label, 70)}`;

/* ───────────────────────── shot grammar ───────────────────────── */

const SHOT_RULES: [string, RegExp][] = [
  ["end_card", /\bend ?card\b|logo lock-?up|\bpackshot\b.*\b(button|code|price|coupon)|pill button|cta button/i],
  ["split_screen", /split[- ]?screen|side[- ]by[- ]side|\bvs\.?\b|versus/i],
  ["before_after", /before[\s/-]*(and|&)?[\s/-]*after/i],
  ["macro", /\bmacro\b|extreme close/i],
  ["time_lapse", /time[- ]?lapse|speed[- ]?ramp/i],
  ["slow_motion", /slow[- ]?mo(tion)?/i],
  ["screen_recording", /screen[- ]?record|\bui\b|app screen|search bar|typing/i],
  ["text_card", /text (card|only)|kinetic type|title card/i],
  ["unboxing", /unbox|lid[- ]lift|opens? the box/i],
  ["hands_demo", /hands?[- ]only|\bhands? (scroll|tap|press|open|hold|swip|click|plug|pour)\w*|\bthumb\b|\bhands?\b.*\bdemo\b/i],
  ["pov_use", /\bpov\b|first[- ]person/i],
  ["talking_head", /selfie|talking head|to (the )?camera|creator (speaks|talks|says)|\bfacecam\b|green[- ]screen/i],
  ["close_up", /close[- ]?up|\btight\b/i],
  ["scale_reference", /\bscale\b|next to a|size of/i],
  ["torture_test", /drop test|dropp?ed|submerg|water test|stood on|torture/i],
  ["lifestyle", /lifestyle|on the couch|at home|in bed|outdoors|at the (beach|park|gym)|morning routine/i],
  ["wide", /\bwide\b|establishing|aerial|drone/i],
  ["product_shot", /\bproduct\b|packshot|turntable|hero shot/i],
];

const SHOT_LABEL: Record<string, string> = {
  end_card: "End card",
  split_screen: "Split screen",
  before_after: "Before / after",
  macro: "Macro",
  time_lapse: "Time-lapse",
  slow_motion: "Slow motion",
  screen_recording: "Screen recording",
  text_card: "Text card",
  unboxing: "Unboxing",
  hands_demo: "Hands-only demo",
  pov_use: "POV",
  talking_head: "Creator to camera",
  close_up: "Close-up",
  scale_reference: "Scale reference",
  torture_test: "Torture test",
  lifestyle: "Lifestyle",
  wide: "Wide",
  product_shot: "Product shot",
};

/** The shot type a reference beat uses: the reference's own label, else read from its visual. */
export function shotGrammar(visual: string | null | undefined, given?: string | null): string {
  const g = squash(given).toLowerCase().replace(/[\s-]+/g, "_");
  if (g) return g;
  const v = squash(visual);
  return SHOT_RULES.find(([, re]) => re.test(v))?.[0] ?? "product_shot";
}
const shotLabel = (s: string) => SHOT_LABEL[s] ?? s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** Shot families, to match a reference beat to the selling point whose proof shot films the same way. */
const FAMILIES: [string, RegExp][] = [
  ["compare", /split|compar|before|versus|vs/],
  ["macro", /macro|close|texture|detail/],
  ["time", /time|lapse|speed|ramp/],
  ["screen", /screen|ui|record|app/],
  ["scale", /scale|size/],
  ["hands", /hand|pov|demo|use/],
  ["test", /torture|test|drop|water/],
  ["life", /life|home|couch|bed/],
];
const family = (s: string) => FAMILIES.find(([, re]) => re.test(s.toLowerCase()))?.[0] ?? "";

/* ───────────────────────── hook classification ───────────────────────── */

export interface HookClassification {
  hookId: string;
  name: string;
  method: "rules" | "llm" | "fallback";
  score: number;
  features: string[];
}

/** Teardown hook type → our closest hook (used as a weak feature and as the last fallback). */
export const HOOK_TYPE_MAP: Record<string, string> = {
  curiosity_gap: "H02",
  problem_agitate: "H09",
  shock_stat: "H15",
  pattern_interrupt: "H28",
  social_proof: "H26",
  offer_first: "H16",
  demo_first: "H31",
  question: "H14",
  before_after: "H10",
  trend_native: "H08",
};

/**
 * [hook, regex, where] — "v" visual (3 points), "t" text (2), "b" both (3 on visual, 2 on text).
 * Formula hooks (FORMULA) are defined by their words, so a text match there scores 4.
 */
const FORMULA = new Set(["H08", "H13", "H21", "H25", "H26", "H27", "H28", "H30", "H32"]);
const HOOK_RULES: [string, RegExp, "v" | "t" | "b"][] = [
  ["H05", /unbox|lid[- ]?lift|opens? the box|peel(s|ing)? the film|lift(s|ing)? the lid/i, "b"],
  ["H06", /gift|wrapp(ed|ing)|ribbon|\bbow\b/i, "b"],
  ["H07", /reaction|jaw[- ]drop|gasp|wide eyes|hand over (her|his|the) mouth/i, "v"],
  ["H08", /\bpov\b|first[- ]person/i, "b"],
  ["H10", /before[\s/-]*(and|&)?[\s/-]*after|\bwipe\b.*\b(old|new)\b/i, "b"],
  ["H11", /asmr|satisfying|crunch|sizzle|\bclick(s|ing)?\b.*\bsound|foley/i, "b"],
  ["H12", /speed[- ]?ramp|time[- ]?lapse|transformation/i, "v"],
  ["H13", /\b(\d|three|five) (reasons|things|ways)\b|reasons (why|to)/i, "t"],
  // "40% off" is a discount (H16), not a stat.
  ["H15", /\b\d[\d,.]*\s?(%(?!\s*off)|x|×|million|k\b|hours|nits|days)|\bbold number\b|huge number/i, "b"],
  ["H16", /\d+\s?% off|\bsale\b|price drop|deal|\$\d|was \$|strike-?through/i, "b"],
  ["H17", /talking head|selfie|creator (looks|speaks|talks)|into (the )?lens|to (the )?camera/i, "v"],
  ["H18", /green[- ]?screen/i, "b"],
  ["H19", /stop[- ]?motion/i, "b"],
  ["H20", /scale contrast|next to (a|an) |size of (a|an) /i, "v"],
  ["H21", /made me buy|\bhaul\b/i, "b"],
  ["H22", /drop test|dropp?ed|submerg|set on fire|stood on|torture|sun[- ]glare test/i, "v"],
  ["H23", /lifestyle|morning coffee|window seat|cosy|cozy/i, "v"],
  ["H24", /christmas|halloween|holiday|snow globe|pumpkin|valentine|firework/i, "b"],
  ["H25", /search[- ]?bar|types? ['"“]|typing|google search/i, "b"],
  ["H26", /comment|replying to|reply to/i, "b"],
  ["H27", /text message|imessage|\bchat\b|\bdm\b|group chat/i, "b"],
  ["H28", /stop scrolling|don'?t scroll|wait[,!]? stop|pattern interrupt/i, "b"],
  ["H29", /\bvs\.?\b|versus|side[- ]by[- ]side|the generic|other brand|ours wins/i, "b"],
  ["H30", /myth|stop (buying|using|doing)|nobody tells|unpopular opinion|you'?re doing it wrong/i, "t"],
  ["H31", /hands[- ]only|already working|button (is )?pressed|clicks? in|snap(s|ping)? (on|in)/i, "v"],
  ["H32", /ranking|countdown|#1 will|number one will/i, "b"],
  ["H33", /duet|stitch/i, "b"],
  ["H34", /cinematic|establishing|aerial|drone|epic wide/i, "v"],
  ["H35", /slow[- ]?mo(tion)?|splash|pour(s|ed|ing)?\b|drop(s|ped)? into/i, "v"],
  ["H01", /turntable|360|spins?|rotat(es|ing)/i, "v"],
  ["H02", /\bmacro\b|extreme close|texture/i, "v"],
  ["H03", /light[- ]?sweep|glint|specular|lens flare/i, "v"],
  ["H04", /rush(es)? (at|to) the (camera|lens)|push(es)? to (the )?lens|product blast/i, "v"],
  ["H09", /\b(problem|pain|frustrat|annoy|hate when|struggl|ugh)\w*/i, "b"],
  ["H14", /\?\s*$/, "t"],
];

/** Rule score at which classifyHookRules is "sure" (no model pick needed). */
export const SURE = 3;

/** Weighted rule match on the reference opening. Score ≥ 3 is "sure". */
export function classifyHookRules(ref: Pick<ReferenceAdSpec, "hookText" | "hookVisual" | "hookType" | "beats">): Omit<HookClassification, "method"> {
  const text = squash([ref.hookText, ref.beats[0]?.onScreenText, ref.beats[0]?.vo].filter(Boolean).join(" | "));
  const visual = squash([ref.hookVisual, ref.beats[0]?.visual].filter(Boolean).join(" | "));
  const scores = new Map<string, { score: number; features: string[] }>();
  const add = (id: string, pts: number, why: string) => {
    const c = scores.get(id) ?? { score: 0, features: [] };
    c.score += pts;
    c.features.push(why);
    scores.set(id, c);
  };
  for (const [id, re, where] of HOOK_RULES) {
    const v = where !== "t" ? re.exec(visual) : null;
    const t = where !== "v" ? re.exec(text) : null;
    if (v) add(id, 3, `visual "${v[0]}"`);
    if (t) add(id, FORMULA.has(id) ? 4 : 2, `text "${t[0].trim()}"`);
  }
  const typed = HOOK_TYPE_MAP[ref.hookType];
  if (typed) add(typed, 2, `hook type ${ref.hookType}`);
  const ranked = [...scores.entries()].sort((a, b) => b[1].score - a[1].score || HOOK_RULES.findIndex((r) => r[0] === a[0]) - HOOK_RULES.findIndex((r) => r[0] === b[0]));
  const [id, best] = ranked[0] ?? [typed ?? "H04", { score: 0, features: [] }];
  // Two hooks tied at the top are not "sure" either.
  const tied = ranked[1] && ranked[1][1].score === best.score;
  return { hookId: id, name: hookById(id)?.name ?? id, score: tied ? Math.min(best.score, SURE - 1) : best.score, features: best.features };
}

const hookPickSchema = z.object({ hookId: z.string(), why: z.string().optional().catch(undefined) }).passthrough();

export function hookClassifierPrompts(ref: ReferenceAdSpec): { system: string; user: string } {
  return {
    system: `You map a video ad's opening to ONE hook from a fixed library. Output JSON only: {"hookId":"H..","why":"one short reason"}. hookId must be one of the ids listed.`,
    user: JSON.stringify({
      opening: { hookType: ref.hookType, text: ref.hookText, visual: ref.hookVisual, durationSec: ref.beats[0]?.endSec },
      library: HOOKS.map((h) => ({ id: h.id, name: h.name, what: clip(h.desc, 110) })),
    }),
  };
}

const defaultHookLlm: LlmFn = async ({ system, user }) => {
  const { analyzeWithClaude } = await import("@/services/ai/claude-client");
  return analyzeWithClaude({ systemPrompt: system, userPrompt: user, responseSchema: hookPickSchema, maxTokens: 200 });
};

/** Rules first; an LLM pick only when they are unsure; the hook-type map when the model fails. */
export async function classifyHook(ref: ReferenceAdSpec, opts: { llm?: LlmFn } = {}): Promise<HookClassification> {
  const rules = classifyHookRules(ref);
  if (rules.score >= SURE) return { ...rules, method: "rules" };
  try {
    const raw = await (opts.llm ?? defaultHookLlm)(hookClassifierPrompts(ref));
    const id = squash(hookPickSchema.parse(raw).hookId).toUpperCase();
    const hook = hookById(id);
    if (!hook) throw new Error(`unknown hook id ${id}`);
    return { hookId: hook.id, name: hook.name, method: "llm", score: rules.score, features: [...rules.features, "llm pick"] };
  } catch {
    const id = HOOK_TYPE_MAP[ref.hookType] ?? (rules.score > 0 ? rules.hookId : "H04");
    return { hookId: id, name: hookById(id)?.name ?? id, method: "fallback", score: rules.score, features: rules.features };
  }
}

/* ───────────────────────── end card ───────────────────────── */

const END_RULES: [EndCardId, RegExp][] = [
  ["E11", /\bscan\b|\bqr\b/i],
  ["E10", /install|app store|google play|get the app|download (the|our) app/i],
  ["E03", /\bcode\b|coupon|promo code/i],
  ["E04", /\bwas \$|strike|compare(d)? at|save \$|\$\d+.*\$\d+/i],
  ["E05", /ends (today|tonight|sunday|monday|soon|\w+day)|last chance|today only|hurry|countdown|limited time|while stocks last/i],
  ["E02", /\d+\s?% off|\bsale\b|discount/i],
  ["E06", /★|\bstars?\b|reviews|rated|testimonial|verified buyer/i],
  ["E07", /all (sizes|colou?rs|models)|collection|the range|which one/i],
  ["E08", /\bgift|bundle|\bset\b/i],
  ["E09", /\btap\b|link below|below ?👇|↓|link in bio|click below|swipe up/i],
  ["E12", /link'?s right there|trust me|sticker/i],
  ["E01", /logo|shop now|learn more|pill|button/i],
];

export interface EndCardMatch {
  id: EndCardId;
  /** What the reference's close maps to, before our facts are checked. */
  matched: EndCardId;
  reason: string;
  note?: string;
}

function factsAllow(id: EndCardId, f: OfferFacts, goal: CampaignGoal): boolean {
  return endCardById(id).requires.every((r) =>
    r === "promoPct" ? !!f.pct
    : r === "comparePrice" ? !!(f.price && f.comparePrice && f.comparePrice > f.price)
    : r === "couponCode" ? !!f.code
    : r === "deadline" ? !!f.deadline
    : r === "appInstall" ? goal === "app_install"
    : false // rating, multiSku, ctvPlacement: facts the cloner doesn't have
  );
}

/** The reference close → E01–E12, then the closest card our facts can actually render. */
export function mapEndCard(ref: Pick<ReferenceAdSpec, "ctaText" | "offer" | "ctaPlacement" | "beats">, opts: { promo?: PromoInput; goal: CampaignGoal; runDate: string }): EndCardMatch {
  const last = ref.beats[ref.beats.length - 1];
  const close = squash([ref.ctaText, ref.offer, last?.onScreenText, last?.vo, last?.visual].filter(Boolean).join(" | "));
  let matched: EndCardId = "E01";
  let reason = "default brand close";
  const hit = END_RULES.find(([, re]) => re.test(close));
  if (hit) {
    matched = hit[0];
    reason = `reference close "${hit[1].exec(close)![0]}"`;
  } else if (/none|persistent/.test(ref.ctaPlacement)) {
    matched = "E12";
    reason = `reference CTA placement ${ref.ctaPlacement}`;
  }
  const f = offerFacts(opts.promo, opts.runDate);
  if (factsAllow(matched, f, opts.goal)) return { id: matched, matched, reason };
  // Keep the offer the reference sold with, in a card our facts support.
  const order: EndCardId[] = f.code ? ["E03"] : [];
  if (f.price && f.comparePrice && f.comparePrice > f.price) order.push("E04");
  if (f.pct) order.push("E02");
  order.push("E01");
  const id = order.find((x) => factsAllow(x, f, opts.goal)) ?? "E01";
  return { id, matched, reason, note: `${matched} ${endCardById(matched).name} needs ${endCardById(matched).requires.join("/")} we don't have — ${id} ${endCardById(id).name} instead` };
}

/* ───────────────────────── scaffold ───────────────────────── */

const ROLE_PURPOSE: [RegExp, BeatPurpose][] = [
  [/^(cta|end|end_?card|close)/, "cta"],
  [/offer|promo|deal|price/, "offer"],
  [/problem|pain|agitat|objection|doubt/, "objection"],
  [/brand|lifestyle|benefit|emotion|aspiration/, "benefit"],
  [/hook|intro|open/, "pitch"],
  [/demo|proof|feature|testimonial|ugc|social|review|stat|compar|result/, "proof"],
];
const purposeOf = (role: string): BeatPurpose => ROLE_PURPOSE.find(([re]) => re.test(role))?.[1] ?? "proof";

export interface CloneOptions {
  platform: PlatformId;
  goal: CampaignGoal;
  promo?: PromoInput;
  runDate: string;
  /** The classified hook (classifyHook); it leads the 3 hook variants. */
  hookId: string;
  /** The mapped end card (mapEndCard); default: mapped here. */
  endCard?: EndCardMatch;
  strictCompliance?: boolean;
}

/** The reference's hook line re-cut for our product, when it follows a recognisable formula. */
function transferHookText(refText: string, brief: ProductBrief, product: string): { text: string; vo: string } | null {
  const t = squash(refText);
  const top = brief.sellingPoints[0];
  const pain = squash(brief.forces?.push?.[0]);
  const benefit = stripEnd(squash(top?.benefit || brief.bigIdea?.proposition));
  if (/^pov\b/i.test(t)) {
    const line = `POV: ${tidyEnd(clipWords(lowerFirst(benefit || `you found the ${product}`), 7))}`;
    return { text: line, vo: `${line}.` };
  }
  if (/^(stop|wait)\b/i.test(t)) return { text: `STOP ${keyword(pain || benefit)}`, vo: `Stop. ${clipWords(stripEnd(pain || benefit), 6)}?` };
  if (/\?\s*$/.test(t) && pain) {
    const q = `Still putting up with ${clipWords(lowerFirst(stripEnd(pain)), 6)}?`;
    return { text: q.toUpperCase(), vo: q };
  }
  const n = /\b(\d+|three|five) (reasons|things|ways)\b/i.exec(t);
  if (n) return { text: `${n[1].toUpperCase()} ${n[2].toUpperCase()} TO SWITCH`, vo: `${n[1]} ${n[2]} people are switching to the ${product}.` };
  return null;
}

/** Scrub the reference brand from text we carry over (their visuals guide the shot, never the brand). */
function scrub(text: string, ref: Pick<ReferenceAdSpec, "owner">): string {
  const owner = squash(ref.owner);
  if (!owner) return squash(text);
  return squash(text).replace(new RegExp(owner.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "their product");
}

function fillTemplate(tpl: string, f: OfferFacts): string | null {
  const money = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
  const vals: Record<string, string | null> = { pct: f.pct ? String(f.pct) : null, code: f.code, price: f.price ? money(f.price) : null, day: null };
  let out = tpl;
  for (const [k, v] of Object.entries(vals)) {
    if (!out.includes(`{${k}}`)) continue;
    if (!v) return null;
    out = out.replaceAll(`{${k}}`, v);
  }
  return out;
}
const words = (s: string) => new Set(squash(s).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2));

/**
 * Deterministic clone: the reference's beat timings and shot grammar, our content. Hook = the
 * reference's first beat; the 3 hook variants are the classified hook + 2 alternates (A/B).
 */
export function scaffoldClone(refIn: ReferenceAdSpec, brief: ProductBrief, o: CloneOptions): PlatformPlan {
  const ref = { ...refIn, beats: refIn.beats.map((b) => ({ ...b })) };
  const notes: string[] = [];
  const profile = platformProfile(o.platform);
  const product = squash(brief.product?.name) || squash(brief.product?.brand) || "the product";

  // Timings: the reference's, scaled only when it runs past the platform's max length.
  let D = ref.durationSec;
  if (D > profile.durationSec.max) {
    const k = profile.durationSec.max / D;
    ref.beats.forEach((b) => ((b.startSec = r1(b.startSec * k)), (b.endSec = r1(b.endSec * k))));
    for (let i = 1; i < ref.beats.length; i++) ref.beats[i].startSec = ref.beats[i - 1].endSec;
    D = profile.durationSec.max;
    ref.beats[ref.beats.length - 1].endSec = D;
    notes.push(`reference is ${ref.durationSec} s, over the ${o.platform} max of ${D} s — timings scaled ×${r1(k * 100) / 100}`);
  } else if (D < profile.durationSec.range[0]) {
    notes.push(`reference is ${D} s, under the ${o.platform} range (${profile.durationSec.range.join("–")} s) — kept as is`);
  }
  // A clone always ends on a CTA: split the final second off when the reference has none.
  const lastBeat = ref.beats[ref.beats.length - 1];
  if (purposeOf(lastBeat.role) !== "cta") {
    if (lastBeat.endSec - lastBeat.startSec > 1.4) {
      const cut = r1(lastBeat.endSec - 1);
      ref.beats.push({ ...lastBeat, startSec: cut, role: "cta", visual: "logo + button", vo: "", onScreenText: "", shot: "end_card" });
      lastBeat.endSec = cut;
      notes.push("reference has no CTA beat — the final 1 s became the CTA");
    } else {
      lastBeat.role = "cta";
      notes.push("reference has no CTA beat — its last beat closes as the CTA");
    }
  }

  const endCard = o.endCard ?? mapEndCard(ref, { promo: o.promo, goal: o.goal, runDate: o.runDate });
  const base = scaffoldPlatformPlan(brief, o.platform, o.goal, o.promo, o.runDate, { durationSec: D, hookIds: [o.hookId], endCardId: endCard.id, strictCompliance: o.strictCompliance });
  const facts = offerFacts(o.promo, o.runDate);

  // End-card button: the template copy closest to the reference's CTA wording, filled with our facts.
  const refClose = `${ref.ctaText} ${lastBeat.onScreenText} ${lastBeat.vo}`;
  const options = endCardById(endCard.id).copy.map((c) => fillTemplate(c, facts)).filter((c): c is string => !!c);
  const want = words(refClose.replace(/\b[A-Z0-9]{4,}\b/g, ""));
  const best = options.map((c) => ({ c, n: [...words(c)].filter((w) => want.has(w)).length })).sort((a, b) => b.n - a.n)[0];
  const endCardPlan = { ...base.endCard, ...(best && best.n > 0 ? { button: best.c } : {}) };

  // Body: every reference beat after the hook, same timing and shot grammar, our content.
  const hookBeat = ref.beats[0];
  const hookEnd = hookBeat.endSec;
  const points = [...brief.sellingPoints].filter((p) => !o.strictCompliance || p.compliance?.riskLevel !== "blocked");
  const used = new Set<string>();
  const pickPoint = (shot: string) => {
    const fam = family(shot);
    const free = points.filter((p) => !used.has(p.id));
    const pool = free.length ? free : points;
    if (!free.length && points.length) notes.push(`more proof beats than selling points — ${shot} reuses a point`);
    const pick = (fam && pool.find((p) => family(`${p.proofVisual?.shot ?? ""} ${p.proofVisual?.device ?? ""}`) === fam)) || pool[0];
    if (pick) used.add(pick.id);
    return pick;
  };
  const pains = (brief.forces?.push ?? []).map(squash).filter(Boolean);
  const situations = [...(brief.categoryEntryPoints ?? []).map((x) => x.w || x.hookIdea), ...(brief.bigIdea?.alternates ?? [])].map(squash).filter(Boolean);
  let painK = 0;
  let sitK = 0;
  const zoomOn = (what: string) => `Zoom-in lands on the ${product}${what ? ` (${what})` : ""}.`;

  const beats: PlanBeat[] = ref.beats.slice(1).map((b) => {
    const t0 = b.startSec;
    const t1 = b.endSec;
    const purpose = purposeOf(b.role);
    const as = `${shotLabel(b.shot)} (as the reference ${t0}–${t1} s ${b.role.toUpperCase()})`;
    const budget = voBudget(t1 - t0);
    if (purpose === "cta") {
      return { t0, t1, purpose, shotType: b.shot, visual: `${as}: end card ${endCardPlan.id} ${endCardPlan.name} — logo + bouncing "${endCardPlan.button}" button over the ${product} packshot${endCardPlan.headline ? ` + "${endCardPlan.headline}"` : ""}.`, vo: clipWords(`${endCardPlan.button}${facts.code && !/code/i.test(endCardPlan.button) ? ` — code ${facts.code}` : ""}.`, Math.max(4, budget)), onScreenText: endCardPlan.headline ?? endCardPlan.button.toUpperCase() };
    }
    if (purpose === "offer" || (purpose === "pitch" && (o.goal === "promo" || facts.pct || facts.code))) {
      const line = offerLine(facts);
      return { t0, t1, purpose, shotType: b.shot, visual: `${as}: the ${product} hero shot, bright, with the offer badge "${line}" popping beside it.`, vo: fitVO([`${line.replace(/ THIS .*$/, "").toLowerCase()}${facts.code ? ` with code ${facts.code}` : ""}.`], budget), onScreenText: line };
    }
    if (purpose === "objection") {
      const pain = pains[painK++ % Math.max(1, pains.length)];
      const obj = brief.objections?.[0];
      if (pain && /problem|pain|agitat/.test(b.role)) {
        return { t0, t1, purpose, shotType: b.shot, visual: `${as}: the pain — ${stripEnd(pain)} — then the ${product} enters frame to fix it.`, vo: fitVO([`${stripEnd(pain)}.`, `${clipWords(stripEnd(pain), budget)}.`], budget), onScreenText: keyword(pain) };
      }
      const said = obj?.objection ? `${stripEnd(squash(obj.objection))}? ${stripEnd(squash(obj.answer)) || "Not this one"}.` : `${stripEnd(squash(brief.bigIdea?.proposition)) || product}.`;
      return { t0, t1, purpose, shotType: b.shot, visual: `${as}: ${stripEnd(squash(obj?.bustingVisual || obj?.answer || "the doubt, busted on camera"))} — the ${product} in frame.`, vo: fitVO([said, `${stripEnd(squash(obj?.objection))}? Not this one.`], budget), onScreenText: obj?.objection ? `${keyword(obj.objection)}?` : keyword(product) };
    }
    if (purpose === "benefit" || purpose === "pitch") {
      const s = situations[sitK++ % Math.max(1, situations.length)] || squash(brief.bigIdea?.proposition) || product;
      return { t0, t1, purpose, shotType: b.shot, visual: `${as}: ${stripEnd(s)} — the ${product} in use, in frame.`, vo: fitVO([`${stripEnd(s)}.`], budget), onScreenText: keyword(s) };
    }
    // proof
    const p = pickPoint(b.shot);
    if (!p) {
      return { t0, t1, purpose: "proof", shotType: b.shot, visual: `${as}: the ${product} working on frame 1 of the shot. ${zoomOn("")}`, vo: fitVO([`${stripEnd(squash(brief.bigIdea?.proposition)) || product}.`], budget), onScreenText: keyword(brief.bigIdea?.proposition || product) };
    }
    const overlay = squash(p.proofVisual?.overlayText);
    return {
      t0,
      t1,
      purpose: "proof",
      sellingPointId: p.id,
      shotType: b.shot,
      visual: `${as}: ${stripEnd(squash(p.proofVisual?.shot).replace(/_/g, " "))} — the ${product} in frame. ${zoomOn(clip(overlay || p.claim, 40))}`,
      vo: fitVO([`${stripEnd(squash(p.claim))}${p.benefit ? ` — ${lowerFirst(stripEnd(squash(p.benefit)))}` : ""}.`, `${stripEnd(squash(p.claim))}.`, `${stripEnd(squash(p.benefit))}.`], budget),
      onScreenText: overlay && overlay.split(" ").length <= 5 && !/[:;]/.test(overlay) ? overlay.toUpperCase() : keyword(p.claim),
    };
  });

  // Hook variants: the cloned hook first (opening re-cut from the reference's formula), 2 alternates.
  const transfer = transferHookText(ref.hookText, brief, product);
  const hookVariants = base.hookVariants.map((h, k) => {
    const v = { ...h, durationSec: hookEnd, openingVO: clipWords(h.openingVO, voBudget(hookEnd) + 2) };
    if (k === 0) {
      v.openingVisual = clip(`${shotLabel(hookBeat.shot)} like the reference opening (${hookEnd} s): ${scrub(ref.hookVisual, ref)} — with the ${product}, bright, in frame 1. Recipe ${h.hookId}: ${h.openingVisual}`, 420);
      if (transfer) Object.assign(v, { openingText: transfer.text, openingVO: clipWords(transfer.vo, voBudget(hookEnd) + 2) });
    }
    return v;
  });

  const cuts = ref.beats.length;
  const plan: PlatformPlan = {
    ...base,
    label: cloneLabel(ref),
    durationSec: D,
    pacing: `${ref.pacing ? `${ref.pacing}; ` : ""}reference rhythm: ${cuts} beats in ${D} s (~${r1(D / cuts)} s each), hook ${hookEnd} s; ${base.pacing}`,
    musicMood: ref.music ? `${ref.music} (as the reference)` : base.musicMood,
    hookVariants,
    endCard: endCardPlan,
    endCardAlternates: base.endCardAlternates.filter((e) => e.id !== endCardPlan.id),
    beats,
    scripts: [],
    copySource: "scaffold",
    notes: [
      `structure cloned from ${ref.label}${ref.id ? ` (${ref.kind} ${ref.id})` : ""}`,
      ...(endCard.note ? [endCard.note] : [`end card ${endCard.id} from the ${endCard.reason}`]),
      ...notes,
      ...(base.notes ?? []).filter((n) => !/by user/.test(n)),
    ],
  };
  plan.scripts = buildScripts(plan);
  return plan;
}

/* ───────────────────────── copy pass + entry point ───────────────────────── */

export function cloneCopyPrompts(plan: PlatformPlan, ref: ReferenceAdSpec, brief: ProductBrief, opts: { goal: CampaignGoal; promo?: PromoInput; runDate: string; strictCompliance?: boolean }): { system: string; user: string } {
  const facts = offerFacts(opts.promo, opts.runDate);
  const system = `You are CreativeIntel's ad-cloning copywriter. A proven ad's STRUCTURE was cloned for our product: same beats, timings and shot types. Rewrite the VO and on-screen text of OUR plan so each beat makes the same rhetorical move as the reference beat at the same time (a POV setup stays a POV setup, a pain agitation stays a pain agitation, a code close stays a code close) — with our product and facts. Never reuse the reference's words, brand or product names. Output JSON only:
{"beats":[{"i":beatIndex,"vo":"spoken line","onScreenText":"≤ 6 words"}],"hooks":[{"hookId":"H..","openingText":"≤ 6 words","openingVO":"spoken opener"}]}
RULES
- Keep every beat's index, timing and purpose. VO fits its words budget (2.5 words per second); the lines read as one script.
- ${opts.strictCompliance ? "Stay inside each claim's safe wording." : "Sell hard: the boldest wording the FACTS support."} Only numbers that appear in FACTS or OFFER.
- On-screen text never repeats the VO word for word. The CTA beat matches the button "${plan.endCard.button}".`;
  const user = JSON.stringify({
    product: brief.product,
    bigIdea: brief.bigIdea?.proposition,
    facts: brief.sellingPoints.slice(0, 6).map((p) => ({ id: p.id, claim: p.claim, benefit: p.benefit })),
    offer: { ...facts, line: offerLine(facts), endCard: plan.endCard },
    reference: {
      hook: { type: ref.hookType, text: scrub(ref.hookText, ref) },
      whyItWorks: clip(scrub(ref.whyItWorks, ref), 300),
      beats: ref.beats.map((b) => ({ t: `${b.startSec}-${b.endSec}`, role: b.role, shot: b.shot, vo: clip(scrub(b.vo, ref), 120), onScreenText: clip(scrub(b.onScreenText, ref), 60) })),
    },
    hooks: plan.hookVariants.map((h) => ({ hookId: h.hookId, name: h.name, text: h.openingText, vo: h.openingVO, words: voBudget(h.durationSec) })),
    beats: plan.beats.map((b, i) => ({ i, t: `${b.t0}-${b.t1}`, purpose: b.purpose, shot: b.shotType, sellingPointId: b.sellingPointId, vo: b.vo, onScreenText: b.onScreenText, words: voBudget(b.t1 - b.t0) })),
  });
  return { system, user };
}

const defaultCopyLlm: LlmFn = async ({ system, user }) => {
  const { analyzeWithClaude } = await import("@/services/ai/claude-client");
  const { campaignCopySchema } = await import("./campaign-planner");
  return analyzeWithClaude({ systemPrompt: system, userPrompt: user, responseSchema: campaignCopySchema, maxTokens: 3000 });
};

export interface CloneAdInput {
  /** A stored teardown row, a saved structure row, raw teardown JSON, or a normalised reference. */
  reference: unknown;
  brief: ProductBrief;
  platform?: string | null;
  goal?: string | null;
  promo?: PromoInput;
  runDate?: string;
  strictCompliance?: boolean;
  /** Injected model call (tests); used for the hook fallback and the copy pass. */
  llm?: LlmFn;
}

export interface CloneAdResult {
  plan: PlatformPlan;
  reference: ReferenceAdSpec;
  hook: HookClassification;
  endCard: EndCardMatch;
  goal: CampaignGoal;
  platform: PlatformId;
}

export async function cloneAd(input: CloneAdInput): Promise<CloneAdResult> {
  const ref = toReference(input.reference);
  const runDate = input.runDate ?? new Date().toISOString();
  const platform = normalizePlatform(input.platform || ref.platform || "tiktok");
  const goal: CampaignGoal = input.goal ? normalizeGoal(input.goal) : ref.offer ? "promo" : ref.goalType ? normalizeGoal(ref.goalType) : "cold";
  const hook = await classifyHook(ref, { llm: input.llm });
  const endCard = mapEndCard(ref, { promo: input.promo, goal, runDate });
  const scaffold = scaffoldClone(ref, input.brief, { platform, goal, promo: input.promo, runDate, hookId: hook.hookId, endCard, strictCompliance: input.strictCompliance });
  scaffold.notes = [`hook ${hook.hookId} ${hook.name} (${hook.method}${hook.features.length ? `: ${hook.features.slice(0, 3).join(", ")}` : ""})`, ...(scaffold.notes ?? [])];
  let plan = scaffold;
  try {
    const raw = await (input.llm ?? defaultCopyLlm)(cloneCopyPrompts(scaffold, ref, input.brief, { goal, promo: input.promo, runDate, strictCompliance: input.strictCompliance }));
    const merged = mergeCampaignCopy(scaffold, raw, input.brief.product?.name || input.brief.product?.brand || "");
    if (!merged.applied) throw new Error("model returned no usable copy");
    plan = merged.plan;
  } catch (err) {
    plan = { ...scaffold, copySource: "scaffold", notes: [...(scaffold.notes ?? []), `copy pass failed (${clip(err instanceof Error ? err.message : String(err), 120)}) — scaffold copy kept`] };
  }
  return { plan, reference: ref, hook, endCard, goal, platform };
}

/**
 * Put a clone into the project's campaign plan: it leads (the script writer and the Studio pick the
 * first plan of a platform), an earlier clone of the same reference is replaced, the rest is kept.
 */
export function mergeClonedPlan(existing: CampaignPlan | null | undefined, clone: PlatformPlan, ctx: { brief: ProductBrief; goal: CampaignGoal; now?: Date; promo?: PromoInput }): CampaignPlan {
  const now = ctx.now ?? new Date();
  const note = `${clone.platform}: ${clone.label} (${now.toISOString().slice(0, 10)})`;
  if (existing && Array.isArray(existing.platforms)) {
    return { ...existing, platforms: [clone, ...existing.platforms.filter((p) => p.label !== clone.label)], notes: [...(existing.notes ?? []).filter((n) => !n.includes(clone.label)), note] };
  }
  return {
    version: 1,
    createdAt: now.toISOString(),
    productTitle: [ctx.brief.product?.brand, ctx.brief.product?.name].map(squash).filter(Boolean).join(" ") || "Product",
    goal: ctx.goal,
    bigIdea: squash(ctx.brief.bigIdea?.proposition),
    keywords: (ctx.brief.keywords ?? []).slice(0, 12).map((k) => k.term),
    platforms: [clone],
    notes: [note],
    runDate: now.toISOString(),
    ...(ctx.promo ? { promo: ctx.promo } : {}),
  };
}

/** END_CARDS re-export for callers that list the library next to a clone. */
export { END_CARDS };
