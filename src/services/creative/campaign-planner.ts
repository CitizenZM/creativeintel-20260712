/**
 * Campaign planner — the research's planning layer as a built-in agent capability.
 *
 *   scaffoldPlatformPlan  deterministic, pure: platform profile (length, aspect, hook second, pacing,
 *                         voice, captions, music) + selectCreative (3 hook variants, end card with the
 *                         promo facts filled in) + a timed beat map:
 *                         hook → [sale pitch inside 0–3 s for promo] → proof beats (one ranked selling
 *                         point each, shot = its proofVisual) → [benefit] → objection buster → [offer]
 *                         → final 1 s CTA (logo + bouncing button). Beat times sum to durationSec, the
 *                         product is on screen at least twice and every zoom lands on the product.
 *   writeCampaignScripts  ONE text-model call per platform fills VO, on-screen text and the three hook
 *                         openings; on any model failure the scaffold copy is kept (plan stays usable).
 *   planCampaign          brief × platforms → CampaignPlan (stored on Project.campaignPlan).
 *
 * Contract: ./campaign-plan.types.ts. Research: out/research/ad-research/01–03*.md.
 */
import { z } from "zod";
import type { CampaignPlan, EndCardPlan, HookVariant, PlanBeat, PlanOverrides, PlanScript, PlatformPlan } from "./campaign-plan.types";
import { END_CARDS, endCardById, hookById, inGiftingWindow, platformProfile, selectCreative } from "./library";
import { playbookSlice } from "./playbooks";
import { TO_CREATIVE_CATEGORY, type ProductBrief, type SpCategory } from "./product-brief";
import { campaignToPlatform, goalFromText } from "./prompt-blocks";
import type { CampaignGoal, CreativeInputs, EndCardDef, EndCardId, HookDef, PlatformId } from "./types";
import { PLATFORM_PROFILES } from "./platforms.data";

export type PromoInput = NonNullable<CreativeInputs["promo"]>;

export interface ScaffoldOptions {
  /** Requested length; clamped to the platform's range. Default: the platform's ideal length. */
  durationSec?: number;
  strictCompliance?: boolean;
  assets?: CreativeInputs["assets"];
  ctv?: boolean;
  /** User-pinned hook ids (≤ 3): they lead, the auto picks fill the rest. */
  hookIds?: string[];
  /** User-chosen end card: replaces the auto pick, which moves into the alternates. */
  endCardId?: EndCardId;
  /** Performance Agent score adjustments (hook / end-card id → points), see services/performance/bias.ts. */
  bias?: CreativeInputs["bias"];
}

/* ───────────────────────── helpers ───────────────────────── */

const r1 = (x: number) => Math.round(x * 10) / 10;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const squash = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const clip = (s: string | null | undefined, n: number) => {
  const t = squash(s);
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};
const clipWords = (s: string | null | undefined, n: number) => {
  const w = squash(s).split(" ").filter(Boolean);
  return w.length > n ? `${w.slice(0, Math.max(1, n)).join(" ").replace(/[,;:—-]+$/, "")}…` : w.join(" ");
};
const money = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
const lowerFirst = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);
const stripEnd = (s: string) => s.replace(/[.!?…\s]+$/, "");
/** 2.5 spoken words per second (the director's VO budget). */
const voBudget = (sec: number) => Math.max(2, Math.floor(sec * 2.5));

/**
 * Fit a spoken line to a word budget without ever cutting mid-sentence: keep whole sentences that
 * fit; if even the first one is too long, end it at its last clause break (",", ";", "—") inside the
 * budget, else at the budget. Always closes with real punctuation — never "…" (it is read aloud).
 */
export function fitSpoken(text: string, maxWords: number): string {
  const t = squash(text);
  const words = (x: string) => x.split(/\s+/).filter(Boolean).length;
  if (words(t) <= maxWords) return t;
  // Split after sentence punctuation followed by a space ("3.0" and "$4.99" stay whole).
  const sentences = t.split(/(?<=[.!?]["')\]]?)\s+/).filter(Boolean);
  let out = "";
  for (const sn of sentences) {
    const next = out ? `${out} ${sn}` : sn;
    if (words(next) > maxWords) break;
    out = next;
  }
  if (out) return out;
  const w = sentences[0].replace(/[.!?…]+$/, "").split(/\s+/).slice(0, maxWords);
  let cut = w.length;
  for (let i = w.length - 1; i >= 1; i--) {
    if (/[,;:—–-]$/.test(w[i])) {
      cut = i + 1;
      break;
    }
  }
  // A hard cut must not end on a dangling function word ("…that saves your." on a live autopilot hook).
  let kept = w.slice(0, cut);
  while (kept.length > 2 && DANGLING.test(kept[kept.length - 1].replace(/[,;:—–-]+$/, ""))) kept = kept.slice(0, -1);
  return `${kept.join(" ").replace(/[,;:—–-]+$/, "")}.`;
}

const DANGLING = /^(a|an|the|your|my|our|their|his|her|its|this|that|these|those|to|of|for|with|and|or|but|in|on|at|by|from|as|is|are|was|be|so|than|who|which|while|into|onto|about)$/i;

const PLATFORM_IDS = new Set<string>(PLATFORM_PROFILES.map((p) => p.id));
export const PLATFORM_LABELS: Record<PlatformId, string> = {
  tiktok: "TikTok",
  instagram_reels: "Instagram Reels",
  instagram_stories: "Instagram Stories",
  meta_feed: "Meta Feed",
  facebook_reels: "Facebook Reels",
  youtube_instream_skippable: "YouTube In-stream",
  youtube_instream_nonskippable_15s: "YouTube 15 s Non-skip",
  youtube_bumper_6s: "YouTube Bumper",
  youtube_shorts: "YouTube Shorts",
  google_demand_gen: "Google Demand Gen",
  pinterest: "Pinterest",
  snapchat: "Snapchat",
};
const GOALS = new Set<string>(["cold", "retarget", "promo", "awareness", "app_install", "lead"]);

/** Accept profile ids ("instagram_reels") and campaign ids / free text ("instagram", "youtube"). */
export function normalizePlatform(id: string): PlatformId {
  const s = squash(id).toLowerCase();
  return PLATFORM_IDS.has(s) ? (s as PlatformId) : campaignToPlatform(s);
}

export function normalizeGoal(goal?: string | null): CampaignGoal {
  const g = squash(goal).toLowerCase();
  return GOALS.has(g) ? (g as CampaignGoal) : goalFromText(g);
}

/** The sale event a run date falls in (drives the first-3-s pitch line). */
export function saleEvent(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  if (m === 11 && day >= 20 && day <= 29) return "Black Friday";
  if ((m === 11 && day >= 30) || (m === 12 && day <= 2)) return "Cyber Monday";
  if (m === 12 && day <= 24) return "Holiday Sale";
  if ((m === 12 && day >= 26) || (m === 1 && day <= 7)) return "New Year Sale";
  if (m === 2 && day <= 14) return "Valentine's Sale";
  if (m === 5 && inGiftingWindow(iso)) return "Mother's Day Sale";
  return "";
}

/** What the gift question names ("Want a New Year gift?"). */
function giftOccasion(iso: string): string {
  const d = new Date(iso);
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  if ((m === 11 && day >= 15) || (m === 12 && day <= 24)) return m === 11 ? "New Year" : "Christmas";
  if (m === 12 || m === 1) return "New Year";
  if (m === 2) return "Valentine's";
  if (m === 5) return "Mother's Day";
  return "";
}

export interface OfferFacts {
  pct: number | null;
  price: number | null;
  comparePrice: number | null;
  code: string | null;
  deadline: string | null;
  event: string;
}

export function offerFacts(promo: PromoInput | undefined, runDate: string): OfferFacts {
  const p = promo ?? {};
  const derived = p.comparePrice && p.price && p.comparePrice > p.price ? Math.round((1 - p.price / p.comparePrice) * 100) : null;
  const pct = p.pct && p.pct > 0 ? Math.round(p.pct) : derived;
  const deadline = p.deadline && Date.parse(p.deadline) > Date.parse(runDate) ? p.deadline : null;
  return { pct: pct || null, price: p.price ?? null, comparePrice: p.comparePrice ?? null, code: p.code?.trim() || null, deadline, event: saleEvent(runDate) };
}

/** The offer line for the pitch / offer beat ("20% OFF THIS BLACK FRIDAY"). */
export function offerLine(f: OfferFacts): string {
  const when = f.event ? ` THIS ${f.event.toUpperCase()}` : " — LIMITED TIME";
  if (f.pct) return `${f.pct}% OFF${when}`;
  if (f.price && f.comparePrice && f.comparePrice > f.price) return `NOW ${money(f.price)} (WAS ${money(f.comparePrice)})`;
  if (f.code) return `CODE ${f.code.toUpperCase()}${when}`;
  if (f.price) return `ONLY ${money(f.price)}${when}`;
  return f.event ? `${f.event.toUpperCase()} DEAL` : "LIMITED-TIME DEAL";
}

function weekday(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
}

function fillCopy(tpl: string, f: OfferFacts): string | null {
  let out = tpl;
  const vals: Record<string, string | null> = {
    pct: f.pct ? String(f.pct) : null,
    code: f.code,
    price: f.price ? money(f.price) : null,
    day: f.deadline ? weekday(f.deadline) : null,
  };
  for (const [k, v] of Object.entries(vals)) {
    if (!out.includes(`{${k}}`)) continue;
    if (!v) return null;
    out = out.replaceAll(`{${k}}`, v);
  }
  return out;
}

function endCardPlan(e: EndCardDef, f: OfferFacts): EndCardPlan {
  const button = e.copy.map((c) => fillCopy(c, f)).find((c): c is string => !!c && !/[{}]/.test(c)) ?? "Shop now";
  const data: Record<string, string | number> = {};
  if (f.pct) data.pct = f.pct;
  if (f.code) data.code = f.code;
  if (f.price) data.price = f.price;
  if (f.comparePrice) data.comparePrice = f.comparePrice;
  if (f.deadline) data.deadline = f.deadline;
  if (f.event) data.event = f.event;
  const promoCard = ["E02", "E03", "E04", "E05", "E08", "E11"].includes(e.id);
  return {
    id: e.id,
    name: e.name,
    button,
    ...(promoCard && (f.pct || f.code || f.price) ? { headline: offerLine(f) } : {}),
    ...(Object.keys(data).length ? { data } : {}),
  };
}

const keyword = (s: string) => clipWords(stripEnd(squash(s)).replace(/[!?]/g, ""), 4).replace(/…$/, "").toUpperCase();
/** On-screen text: the brief's overlay when it is a short caption, else the claim's lead words. */
const overlayOf = (overlay: string | undefined, claim: string) => {
  const o = squash(overlay);
  return o && o.split(" ").length <= 5 && !/[:;]/.test(o) ? o.toUpperCase() : keyword(claim);
};
/** The first spoken option that fits the word budget; otherwise the first one cut (no ellipsis — it is spoken). */
function fitVO(options: string[], budget: number): string {
  const opts = options.map(squash).filter(Boolean);
  const fit = opts.find((o) => o.split(" ").length <= budget);
  if (fit) return fit;
  return `${stripEnd(clipWords(opts[0] ?? "", budget).replace(/…$/, "")).replace(/[,;:—-]+$/, "")}.`;
}

/* ───────────────────────── scaffold ───────────────────────── */

interface CopyCtx {
  product: string;
  goal: CampaignGoal;
  facts: OfferFacts;
  gift: string;
  brief: ProductBrief;
}

/** Deterministic opening copy for one hook variant (the LLM pass sharpens it). `k` = variant index. */
function hookCopy(h: HookDef, c: CopyCtx, k: number): { text: string; vo: string } {
  const pts = c.brief.sellingPoints;
  const top = pts[0];
  const numbered = pts.find((p) => /\d/.test(p.claim)) ?? top;
  const pain = squash(c.brief.forces?.push?.[0] ?? "");
  const doubt = squash(c.brief.objections?.[0]?.objection ?? "");
  const painQuestion = pain ? `Still putting up with ${lowerFirst(clipWords(stripEnd(pain), 6).replace(/…$/, ""))}?` : `Ready for a better ${c.product}?`;
  const big = stripEnd(squash(c.brief.bigIdea?.proposition)) || c.product;
  if (h.id === "H16") return { text: offerLine(c.facts), vo: `${c.facts.event ? `${c.facts.event}: ` : ""}${stripEnd(offerLine(c.facts).replace(/ THIS .*$| — .*$/, "").toLowerCase())} the ${c.product}.` };
  if (c.goal === "promo") {
    // Sale pitch: each variant asks a different occasion / need question; the pitch beat lands the offer.
    const qs = [c.gift ? `Want a ${c.gift} gift?` : "", `Ready to upgrade to ${c.product}?`, painQuestion].filter(Boolean);
    const q = qs[k % qs.length];
    return { text: q.toUpperCase(), vo: q };
  }
  if (h.id === "H26" && doubt) return { text: `"${clipWords(stripEnd(doubt), 8)}?"`, vo: `${stripEnd(doubt)}? Watch this.` };
  if (h.id === "H13") return { text: `3 REASONS TO SWITCH`, vo: `Three reasons people are switching to ${c.product}.` };
  if (h.id === "H14" || h.id === "H30" || h.id === "H09") return { text: painQuestion.toUpperCase(), vo: painQuestion };
  if (h.family === "native") return { text: `POV: ${clipWords(lowerFirst(stripEnd(squash(top?.benefit)) || `you found the ${c.product}`), 7)}`, vo: `Okay, I need to talk about the ${c.product}.` };
  if (h.family === "reveal") return { text: c.product.toUpperCase(), vo: `${c.product}. ${clipWords(big, 8)}.` };
  if (h.family === "claim") return { text: numbered ? keyword(numbered.claim) : keyword(big), vo: fitVO([`${stripEnd(squash(numbered?.claim))}.`, `${big}.`], 8) };
  return { text: keyword(big), vo: fitVO([`${big}.`], 8) };
}

function hookVariant(h: HookDef, hookEnd: number, c: CopyCtx, k: number): HookVariant {
  const fill = (s: string) => squash(s).replace(/_{2,}/g, c.product);
  const copy = hookCopy(h, c, k);
  return {
    hookId: h.id,
    name: h.name,
    family: h.family,
    durationSec: hookEnd,
    openingVisual: clip(`${fill(h.keyframe)} Move: ${fill(h.motion)} Frame 1 bright, ${c.product} or the subject in shot.`, 420),
    openingText: copy.text,
    openingVO: clipWords(copy.vo, voBudget(hookEnd) + 2),
  };
}

function hookBeat(v: HookVariant): PlanBeat {
  return { t0: 0, t1: v.durationSec, purpose: "hook", visual: v.openingVisual, shotType: v.hookId, vo: v.openingVO, onScreenText: v.openingText };
}

export function buildScripts(plan: Pick<PlatformPlan, "label" | "hookVariants" | "beats">): PlanScript[] {
  return plan.hookVariants.map((v) => ({ hookId: v.hookId, title: `${plan.label} · ${v.hookId} ${v.name}`, beats: [hookBeat(v), ...plan.beats] }));
}

type BodySlot = { purpose: PlanBeat["purpose"]; want: number; make: (t0: number, t1: number) => PlanBeat };

/**
 * Deterministic platform plan: hooks, end card and a timed beat map whose times sum to the
 * platform-fitted duration. Copy is formula-based; writeCampaignScripts sharpens it.
 */
export function scaffoldPlatformPlan(
  brief: ProductBrief,
  platform: PlatformId,
  goal: CampaignGoal,
  promo: PromoInput | undefined,
  runDate: string,
  opts: ScaffoldOptions = {}
): PlatformPlan {
  const profile = platformProfile(platform);
  const D = Math.round(clamp(opts.durationSec ?? profile.durationSec.ideal, Math.max(5, profile.durationSec.range[0]), profile.durationSec.max));
  const strict = !!opts.strictCompliance;
  const category = TO_CREATIVE_CATEGORY[brief.category as SpCategory] ?? "gifts";
  const auto = selectCreative({ category, platform, goal, promo, runDate, assets: opts.assets, ctv: opts.ctv, strictCompliance: strict, bias: opts.bias });
  const choice = applyOverrides(auto, opts);
  const facts = offerFacts(promo, runDate);
  const product = squash(brief.product?.name) || squash(brief.product?.brand) || "the product";
  const c: CopyCtx = { product, goal, facts, gift: inGiftingWindow(runDate) ? giftOccasion(runDate) : "", brief };
  const isPromo = goal === "promo";
  const short = D <= 8;

  // Hook window: promo hooks hand over to the sale pitch so the offer lands inside 0–3 s.
  const primary = choice.hooks[0]?.hook;
  const hookCap = Math.min(profile.hookSec, short ? 1.5 : 3);
  const hookEnd = isPromo ? Math.min(1.5, profile.hookSec) : clamp(Math.round((primary?.durationSec[1] ?? 2) * 2) / 2, 1, hookCap);
  const pitchEnd = isPromo ? Math.min(3, D - 2) : hookEnd;
  const ctaStart = D - 1;
  const endCard = endCardPlan(choice.endCard, facts);
  const hasOffer = !short && (isPromo || goal === "retarget" || !!endCard.headline);
  const offerLen = hasOffer ? (D >= 12 ? 2 : 1.5) : 0;
  const bodyEnd = ctaStart - offerLen;
  const window = bodyEnd - pitchEnd;

  // Body: one proof beat per ranked selling point (+ benefit beats on long cuts) + one objection buster.
  const points = brief.sellingPoints.filter((p) => !strict || p.compliance?.riskLevel !== "blocked");
  const zoomOn = (what: string) => `Zoom-in lands on the ${product}${what ? ` (${what})` : ""}.`;
  const proofSlot = (p: (typeof points)[number]): BodySlot => ({
    purpose: "proof",
    want: clamp(Number(p.proofVisual?.durationSec) || 2.5, 1.5, 4),
    make: (t0, t1) => ({
      t0,
      t1,
      purpose: "proof",
      sellingPointId: p.id,
      visual: `${stripEnd(squash(p.proofVisual.shot))} — the ${product} in frame. ${zoomOn(clip(p.proofVisual.overlayText || p.claim, 40))}`,
      shotType: p.proofVisual.device || "demo",
      vo: fitVO([`${stripEnd(squash(p.claim))}${p.benefit ? ` — ${lowerFirst(stripEnd(squash(p.benefit)))}` : ""}.`, `${stripEnd(squash(p.claim))}.`, `${stripEnd(squash(p.benefit))}.`], voBudget(t1 - t0)),
      onScreenText: overlayOf(p.proofVisual.overlayText, p.claim),
    }),
  });
  const maxProofs = clamp(Math.floor(window / 3.2), 1, 6);
  const slots: BodySlot[] = points.slice(0, maxProofs).map(proofSlot);
  if (!slots.length) {
    slots.push({
      purpose: "proof",
      want: 3,
      make: (t0, t1) => ({ t0, t1, purpose: "proof", visual: `Hands-only demo: the ${product} working on frame 1 of the shot. ${zoomOn("")}`, shotType: "pov_use", vo: clipWords(`${brief.bigIdea.proposition || product}.`, voBudget(t1 - t0)), onScreenText: keyword(brief.bigIdea.proposition || product) }),
    });
  }
  // Long cuts with few points: lifestyle benefit beats from the buying situations / alternate angles.
  const situations = [...(brief.categoryEntryPoints ?? []).map((x) => x.w || x.hookIdea), ...(brief.bigIdea.alternates ?? [])].filter(Boolean);
  for (let k = 0; k < situations.length && k < 2 && window / (slots.length + 1) > 4.5; k++) {
    const s = situations[k];
    slots.push({
      purpose: "benefit",
      want: 2.5,
      make: (t0, t1) => ({ t0, t1, purpose: "benefit", visual: `Lifestyle moment: ${stripEnd(squash(s))} — the ${product} in use, in frame.`, shotType: "lifestyle", vo: clipWords(`${stripEnd(squash(s))}.`, voBudget(t1 - t0)), onScreenText: keyword(s) }),
    });
  }
  const obj = brief.objections?.[0];
  if (obj?.objection && D >= 12) {
    slots.push({
      purpose: "objection",
      want: 2,
      make: (t0, t1) => ({
        t0,
        t1,
        purpose: "objection",
        visual: `${stripEnd(squash(obj.bustingVisual || obj.answer || obj.objection))} — the ${product} in frame.`,
        shotType: "objection_buster",
        vo: fitVO([`${stripEnd(squash(obj.objection))}? ${stripEnd(squash(obj.answer)) || "Not anymore"}.`, `${stripEnd(squash(obj.objection))}? Not this one.`], voBudget(t1 - t0)),
        onScreenText: `${keyword(obj.objection)}?`,
      }),
    });
  }
  const MIN = 1.2;
  while (slots.length > 1 && slots.length * MIN > window) {
    const drop = [...slots].reverse().findIndex((s) => s.purpose !== "proof");
    slots.splice(drop >= 0 ? slots.length - 1 - drop : slots.length - 1, 1);
  }
  // Objection before the offer; proofs/benefits keep their rank order.
  slots.sort((a, b) => Number(a.purpose === "objection") - Number(b.purpose === "objection"));

  const total = slots.reduce((s, x) => s + x.want, 0);
  const beats: PlanBeat[] = [];
  if (isPromo && pitchEnd > hookEnd) {
    beats.push({
      t0: hookEnd,
      t1: pitchEnd,
      purpose: "pitch",
      visual: `The ${product} hero shot, bright, with the offer badge popping beside it (sale pitch inside the first 3 s).`,
      shotType: "push_in",
      vo: clipWords(`${facts.event ? `${facts.event}: ` : ""}${stripEnd(offerLine(facts).replace(/ THIS .*$/, "").toLowerCase())}!`, voBudget(pitchEnd - hookEnd) + 2),
      onScreenText: offerLine(facts),
    });
  }
  let cursor = pitchEnd;
  let acc = 0;
  slots.forEach((s, k) => {
    acc += s.want;
    const end = k === slots.length - 1 ? bodyEnd : r1(pitchEnd + (window * acc) / total);
    beats.push(s.make(cursor, end));
    cursor = end;
  });
  if (hasOffer) {
    beats.push({
      t0: bodyEnd,
      t1: ctaStart,
      purpose: "offer",
      visual: `End card ${endCard.id} ${endCard.name}: official ${product} packshot${endCard.headline ? ` + "${endCard.headline}"` : ""}.`,
      shotType: endCard.id,
      vo: clipWords(isPromo || facts.pct || facts.code ? `${offerLine(facts).replace(/ THIS .*$/, "").toLowerCase()}${facts.code ? ` with code ${facts.code}` : ""}.` : `${product}, ${clipWords(brief.bigIdea.proposition, 6)}.`, voBudget(offerLen) + 1),
      onScreenText: endCard.headline ?? keyword(brief.bigIdea.proposition || product),
    });
  }
  beats.push({
    t0: ctaStart,
    t1: D,
    purpose: "cta",
    visual: `Brand logo + bouncing "${endCard.button}" button (last 1 s) over the ${product} packshot${hasOffer ? "" : ` (end card ${endCard.id} ${endCard.name})`}.`,
    shotType: "end_card",
    vo: clipWords(`${endCard.button}${facts.code && !hasOffer ? ` — code ${facts.code}` : ""}.`, 4),
    onScreenText: endCard.button.toUpperCase(),
  });

  // k counts the question-led variants only (a deal slam opens on the offer itself).
  let q = 0;
  const hookVariants = choice.hooks.map((h) => hookVariant(h.hook, hookEnd, c, h.hook.id === "H16" ? 0 : q++));
  const aspect = (Array.isArray(profile.aspect) ? profile.aspect[0] : profile.aspect) as PlatformPlan["aspect"];
  const plan: PlatformPlan = {
    platform,
    label: PLATFORM_LABELS[platform] ?? profile.platform,
    durationSec: D,
    aspect,
    audience: `${profile.audience.ageCore}, ${profile.audience.genderSkew}; ${profile.audience.mindset}`,
    styleNotes: `${profile.audience.tone}; ${profile.styleTags.slice(0, 5).join(", ")}`,
    pacing: `hook + key message by ${profile.hookSec} s; a cut every ~${r1(1 / profile.cutsPerSec.first6s)} s in the first 6 s, ~${r1(1 / profile.cutsPerSec.body)} s after; sound ${profile.soundMode}`,
    voice: profile.voiceTone,
    captionStyle: profile.captionStyle,
    musicMood: profile.musicStyle,
    hookVariants,
    endCard,
    endCardAlternates: choice.alternates.map((e) => endCardPlan(e, facts)),
    beats,
    scripts: [],
    copySource: "scaffold",
    notes: [...choice.notes, ...choice.labels.map((l) => `label: ${l}`)],
  };
  plan.scripts = buildScripts(plan);
  return plan;
}

/**
 * Studio overrides: pinned hooks (≤ 3, valid ids) lead and the auto picks fill the rest; a chosen
 * end card replaces the auto pick, which moves to the front of the alternates.
 */
export function applyOverrides(choice: ReturnType<typeof selectCreative>, o: Pick<ScaffoldOptions, "hookIds" | "endCardId">): ReturnType<typeof selectCreative> {
  const notes = [...choice.notes];
  let hooks = choice.hooks;
  const pinned = [...new Set((o.hookIds ?? []).map((id) => squash(id).toUpperCase()))]
    .map((id) => hookById(id))
    .filter((h): h is HookDef => !!h)
    .slice(0, 3);
  if (pinned.length) {
    const ids = new Set(pinned.map((h) => h.id));
    hooks = [...pinned.map((hook) => choice.hooks.find((x) => x.hook.id === hook.id) ?? { hook, score: 0, why: ["pinned by user"] }), ...choice.hooks.filter((x) => !ids.has(x.hook.id))].slice(0, 3);
    notes.push(`hooks pinned by user: ${pinned.map((h) => h.id).join(", ")}`);
  }
  let { endCard, alternates } = choice;
  const chosen = o.endCardId && END_CARDS.some((e) => e.id === o.endCardId) ? endCardById(o.endCardId) : null;
  if (chosen && chosen.id !== endCard.id) {
    alternates = [endCard, ...alternates.filter((e) => e.id !== chosen.id && e.id !== endCard.id)].slice(0, 3);
    endCard = chosen;
    notes.push(`end card chosen by user: ${chosen.id}`);
  }
  return { ...choice, hooks, endCard, alternates, notes };
}

/** Accept the UI shape { [platform]: { hookIds, endCardId } } and the flat { pinnedHooks, endCards } shape. */
export function normalizeOverrides(raw: unknown): PlanOverrides {
  const out: PlanOverrides = {};
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  const put = (platform: string, patch: { hookIds?: string[]; endCardId?: EndCardId }) => {
    const id = normalizePlatform(platform);
    out[id] = { ...out[id], ...patch };
  };
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : []);
  const isCard = (v: unknown): v is EndCardId => typeof v === "string" && END_CARDS.some((e) => e.id === v);
  for (const [k, v] of Object.entries(r)) {
    if (k === "pinnedHooks" || k === "endCards") continue;
    if (!v || typeof v !== "object") continue;
    const p = v as { hookIds?: unknown; endCardId?: unknown };
    const hookIds = strs(p.hookIds);
    put(k, { ...(hookIds.length ? { hookIds } : {}), ...(isCard(p.endCardId) ? { endCardId: p.endCardId } : {}) });
  }
  for (const [k, v] of Object.entries((r.pinnedHooks as Record<string, unknown>) ?? {})) if (strs(v).length) put(k, { hookIds: strs(v) });
  for (const [k, v] of Object.entries((r.endCards as Record<string, unknown>) ?? {})) if (isCard(v)) put(k, { endCardId: v });
  return out;
}

/* ───────────────────────── copy pass (one LLM call) ───────────────────────── */

export type LlmFn = (args: { system: string; user: string }) => Promise<unknown>;

const optStr = z.string().nullable().optional().catch(undefined);
const beatCopySchema = z.object({ i: z.coerce.number().int(), vo: optStr, onScreenText: optStr, visual: optStr });
const hookCopySchema = z.object({ hookId: z.string(), openingVisual: optStr, openingText: optStr, openingVO: optStr });
export const campaignCopySchema = z
  .object({ beats: z.array(z.unknown()).catch([]), hooks: z.array(z.unknown()).catch([]) })
  .partial()
  .catch({});

export interface WriteOptions {
  goal: CampaignGoal;
  promo?: PromoInput;
  runDate?: string;
  strictCompliance?: boolean;
  /** Injected model call (tests). Default: the script writer's text model (analyzeWithClaude). */
  llm?: LlmFn;
}

export function campaignCopyPrompts(scaffold: PlatformPlan, brief: ProductBrief, opts: WriteOptions): { system: string; user: string } {
  const strict = !!opts.strictCompliance;
  const facts = offerFacts(opts.promo, opts.runDate ?? new Date().toISOString());
  const system = `You are CreativeIntel's campaign copywriter. You receive one platform's timed ad plan and write its copy. Output JSON only:
{"beats":[{"i":beatIndex,"vo":"spoken line","onScreenText":"≤ 6 words","visual":"optional sharper shot description"}],"hooks":[{"hookId":"H..","openingVisual":"frame 1 + move","openingText":"≤ 6 words","openingVO":"spoken opener"}]}
RULES
- Keep every beat's index, timing and purpose. VO fits its words budget (2.5 words per second); lines read as one script in order. The CTA beat is the last second: offer + action, matching the button.
- ${opts.goal === "promo" ? `First 3 s = the sale pitch: each hook opening asks the occasion/need question, the pitch beat lands the offer ("${offerLine(facts)}"). Example: "Want a New Year gift?" → "20% OFF this Black Friday".` : "The hook states the value proposition by the platform hook second."}
- Write a distinct opening for EVERY hook variant, following its recipe; the body is shared.
- ${strict ? "Stay inside each claim's safe wording and keep required disclosures." : "Sell hard: the boldest, most persuasive wording the FACTS support — superlatives, urgency and direct comparisons are welcome when a fact carries them."} Only numbers that appear in FACTS or OFFER.
- Visuals keep the product in frame; every zoom lands on the product. On-screen text never repeats the VO word for word.
${playbookSlice({ category: brief.category, platform: scaffold.platform, goal: opts.goal, maxWords: 300 })}`;
  const user = JSON.stringify({
    product: brief.product,
    bigIdea: brief.bigIdea?.proposition,
    audience: brief.audience?.primary,
    facts: brief.sellingPoints.slice(0, 6).map((p) => ({ id: p.id, claim: p.claim, benefit: p.benefit, evidence: p.sourceEvidence?.slice(0, 2).map((e) => clip(e.quote, 140)) })),
    objection: brief.objections?.[0],
    offer: { ...facts, line: offerLine(facts), endCard: scaffold.endCard },
    platform: { id: scaffold.platform, durationSec: scaffold.durationSec, voice: scaffold.voice, captions: scaffold.captionStyle, pacing: scaffold.pacing },
    hooks: scaffold.hookVariants.map((h) => ({ hookId: h.hookId, name: h.name, family: h.family, recipe: clip(h.openingVisual, 260), text: h.openingText, vo: h.openingVO })),
    beats: scaffold.beats.map((b, i) => ({ i, t: `${b.t0}-${b.t1}`, purpose: b.purpose, sellingPointId: b.sellingPointId, visual: clip(b.visual, 240), vo: b.vo, onScreenText: b.onScreenText, words: voBudget(b.t1 - b.t0) })),
  });
  return { system, user };
}

const defaultLlm: LlmFn = async ({ system, user }) => {
  const { analyzeWithClaude } = await import("@/services/ai/claude-client");
  return analyzeWithClaude({ systemPrompt: system, userPrompt: user, responseSchema: campaignCopySchema, maxTokens: 3500 });
};

/** Merge model copy into the scaffold; timings, purposes and ids never change. */
export function mergeCampaignCopy(scaffold: PlatformPlan, raw: unknown, productName = ""): { plan: PlatformPlan; applied: number } {
  const parsed = campaignCopySchema.parse(raw ?? {});
  const beats = scaffold.beats.map((b) => ({ ...b }));
  const hooks = scaffold.hookVariants.map((h) => ({ ...h }));
  const product = squash(productName).toLowerCase();
  let applied = 0;
  for (const item of parsed.beats ?? []) {
    const r = beatCopySchema.safeParse(item);
    if (!r.success || !beats[r.data.i]) continue;
    const b = beats[r.data.i];
    if (r.data.vo?.trim()) {
      b.vo = fitSpoken(r.data.vo, voBudget(b.t1 - b.t0) + 3);
      applied++;
    }
    if (r.data.onScreenText?.trim()) {
      b.onScreenText = clipWords(r.data.onScreenText, 8).replace(/…$/, "");
      applied++;
    }
    // A rewritten visual must keep the product in frame (and with it every zoom on the product).
    if (r.data.visual?.trim() && (!product || r.data.visual.toLowerCase().includes(product))) {
      b.visual = clip(r.data.visual, 420);
      applied++;
    }
  }
  for (const item of parsed.hooks ?? []) {
    const r = hookCopySchema.safeParse(item);
    const h = r.success ? hooks.find((x) => x.hookId === r.data.hookId) : undefined;
    if (!r.success || !h) continue;
    if (r.data.openingVisual?.trim()) {
      h.openingVisual = clip(r.data.openingVisual, 420);
      applied++;
    }
    if (r.data.openingText?.trim()) {
      h.openingText = clipWords(r.data.openingText, 8).replace(/…$/, "");
      applied++;
    }
    if (r.data.openingVO?.trim()) {
      h.openingVO = fitSpoken(r.data.openingVO, voBudget(h.durationSec) + 3);
      applied++;
    }
  }
  const plan: PlatformPlan = { ...scaffold, beats, hookVariants: hooks, copySource: applied ? "llm" : "scaffold" };
  plan.scripts = buildScripts(plan);
  return { plan, applied };
}

/** ONE text-model call per platform; any failure keeps the scaffold copy so the plan stays usable. */
export async function writeCampaignScripts(
  scaffold: PlatformPlan,
  brief: ProductBrief,
  opts: WriteOptions
): Promise<{ plan: PlatformPlan; source: "llm" | "fallback"; error?: string }> {
  const llm = opts.llm ?? defaultLlm;
  try {
    const raw = await llm(campaignCopyPrompts(scaffold, brief, opts));
    const { plan, applied } = mergeCampaignCopy(scaffold, raw, brief.product?.name || brief.product?.brand || "");
    if (!applied) throw new Error("model returned no usable copy");
    return { plan, source: "llm" };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const plan: PlatformPlan = { ...scaffold, copySource: "scaffold", notes: [...(scaffold.notes ?? []), `copy pass failed (${clip(error, 120)}) — scaffold copy kept`] };
    return { plan, source: "fallback", error };
  }
}

/* ───────────────────────── campaign ───────────────────────── */

export interface PlanCampaignInput {
  projectId?: string;
  brief: ProductBrief;
  platforms: string[];
  goal: CampaignGoal | string;
  promo?: PromoInput;
  runDate?: string;
  durationSec?: number;
  strictCompliance?: boolean;
  assets?: CreativeInputs["assets"];
  /** Studio choices per platform (pinned hooks, chosen end card); either accepted shape, see normalizeOverrides. */
  overrides?: PlanOverrides | Record<string, unknown>;
  llm?: LlmFn;
  now?: Date;
  /** Performance Agent bias from real results (performanceBias(projectId)); optional. */
  bias?: CreativeInputs["bias"];
}

export const DEFAULT_PLAN_PLATFORMS: PlatformId[] = ["tiktok", "instagram_reels", "meta_feed"];

export async function planCampaign(input: PlanCampaignInput): Promise<CampaignPlan> {
  const now = input.now ?? new Date();
  const runDate = input.runDate ?? now.toISOString();
  const goal = normalizeGoal(input.goal);
  const ids = [...new Set((input.platforms.length ? input.platforms : DEFAULT_PLAN_PLATFORMS).map(normalizePlatform))];
  const notes: string[] = [];
  const overrides = normalizeOverrides(input.overrides);
  const platforms = await Promise.all(
    ids.map(async (platform) => {
      const o = overrides[platform];
      const scaffold = scaffoldPlatformPlan(input.brief, platform, goal, input.promo, runDate, { durationSec: input.durationSec, strictCompliance: input.strictCompliance, assets: input.assets, hookIds: o?.hookIds, endCardId: o?.endCardId, bias: input.bias });
      const res = await writeCampaignScripts(scaffold, input.brief, { goal, promo: input.promo, runDate, strictCompliance: input.strictCompliance, llm: input.llm });
      if (res.source === "fallback") notes.push(`${platform}: copy pass failed, scaffold copy used (${clip(res.error, 100)})`);
      return res.plan;
    })
  );
  const biased = Object.entries(input.bias ?? {}).filter(([, v]) => v);
  if (biased.length) notes.push(`performance bias from real results: ${biased.map(([k, v]) => `${k} ${v! > 0 ? "+" : ""}${v}`).join(", ")}`);
  const productTitle = [input.brief.product?.brand, input.brief.product?.name].map(squash).filter(Boolean).join(" ") || "Product";
  return {
    version: 1,
    createdAt: now.toISOString(),
    productTitle,
    goal,
    bigIdea: squash(input.brief.bigIdea?.proposition),
    keywords: (input.brief.keywords ?? []).slice(0, 12).map((k) => k.term),
    platforms,
    notes,
    runDate,
    ...(input.promo ? { promo: input.promo } : {}),
    ...(input.strictCompliance ? { strictCompliance: true } : {}),
  };
}

/** Compact view for API / operator responses. */
export function summarizePlan(plan: CampaignPlan) {
  return {
    productTitle: plan.productTitle,
    goal: plan.goal,
    bigIdea: plan.bigIdea,
    createdAt: plan.createdAt,
    platforms: plan.platforms.map((p) => ({
      platform: p.platform,
      durationSec: p.durationSec,
      aspect: p.aspect,
      hooks: p.hookVariants.map((h) => `${h.hookId} ${h.name}: ${h.openingText}`),
      endCard: `${p.endCard.id} ${p.endCard.name} — ${p.endCard.button}`,
      beats: p.beats.map((b) => `${b.t0}–${b.t1}s ${b.purpose}${b.onScreenText ? `: ${b.onScreenText}` : ""}`),
      scripts: p.scripts.length,
      copySource: p.copySource,
    })),
    notes: plan.notes,
  };
}
