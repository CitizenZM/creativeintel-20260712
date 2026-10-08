/**
 * Plan → locked storyboard (the "URL-to-video" step): one campaign-plan script becomes a
 * locked-script storyboard the server executor renders as written. Timing, segments, refs,
 * cast lock, product zooms, first+last anchoring and the CTA end card are decided here in code;
 * one text-model call writes the keyframe / motion prompts, with a scaffold fallback.
 *
 * AI presenter (`presenter: true | personaId`): beats of a native/creator hook, and beats whose plan says
 * creator / POV / selfie, become talking-head frames — one persona (personas.ts, default casting) says
 * the beat's line to a selfie camera on Veo with native, lip-synced audio (talk-frame.ts). The persona is
 * the cast lock, so every talk frame shows the same presenter. A line too long for its beat stretches the
 * frame (later frames shift). The director pass never rewrites a talk frame.
 */
import { z } from "zod";
import type { LockedEngine, LockedFrame, LockedRefs } from "@/services/video-gen/locked-script";
import type { PlanBeat, PlanScript, PlatformPlan } from "./campaign-plan.types";
import type { LlmFn } from "./campaign-planner";
import { hookById } from "./library";
import { PLATFORM_PROFILES } from "./platforms.data";
import { personaById, personaCast, pickPersona, type CastingPrefs, type Persona } from "./personas";
import { speechSec, talkKeyframePrompt, talkVideoPrompt } from "@/services/video-gen/talk-frame";
import { captionStyleFor } from "@/services/video-gen/edit/caption-style";
import { platformEnergy, styleForBeat, type VoiceEnergy, type VoiceStyle } from "@/services/video-gen/voice-styles";
import { productFramingClause, validateProductCoverage, type CoverageIssue } from "./product-coverage";
import { pickMusicMood, type MoodId } from "@/services/video-gen/edit/music-moods";

export interface PlanStoryboardInput {
  plan: PlatformPlan;
  /** Which hook variant's script; default the first. */
  hookId?: string;
  productName: string;
  /** Lead cast description for the casting reference (first people shot). */
  cast?: string;
  /** Shared set dressing so every shot reads as one location. */
  setting?: string;
  engine?: LockedEngine;
  /** CTA button copy override (e.g. "Claim Coupon"); default the plan end card's button. */
  ctaButton?: string;
  /** AI presenter: true = pick a persona for platform × category × audience, or a persona id. */
  presenter?: boolean | string;
  /**
   * Product category: the persona pick (creative-library id) and the music bed with the plan's
   * musicMood (sp-1 or creative-library id).
   */
  category?: string;
  /** Who the presenter may be (personas.ts resolveCasting); default white / Latino. */
  casting?: CastingPrefs;
}

export interface PlanStoryboardFrame extends LockedFrame {
  textOverlay?: string;
  voiceover?: string;
  sellingPoint?: string;
  /** VO delivery: the beat purpose's style, shifted by the platform (voice-styles.ts). */
  voiceStyle?: VoiceStyle;
  voiceEnergy?: VoiceEnergy;
}

const PEOPLE = /\b(hands?|person|people|man|woman|mother|mom|father|dad|kid|child|children|family|girl|boy|couple|friends?|she|he|creator|user|customer|student|artist)\b/i;

const SEGMENT: Record<PlanBeat["purpose"], string> = { hook: "HOOK", pitch: "HOOK", proof: "BODY", benefit: "BODY", objection: "BODY", offer: "BODY", cta: "CTA" };

export function pickScript(plan: PlatformPlan, hookId?: string): PlanScript {
  const s = plan.scripts.find((x) => x.hookId === hookId) ?? plan.scripts[0];
  if (s?.beats?.length) return s;
  // Plans without scripts: the first hook variant over the shared body.
  const h = plan.hookVariants[0];
  const hook: PlanBeat[] = h ? [{ t0: 0, t1: h.durationSec, purpose: "hook", visual: h.openingVisual, onScreenText: h.openingText, vo: h.openingVO }] : [];
  return { hookId: h?.hookId ?? "", title: h?.name ?? plan.label, beats: [...hook, ...plan.beats.filter((b) => b.purpose !== "hook")] };
}

/** Every ad frame shows the product (an unreferenced product shot is where the model invents one). */
function refsFor(visual: string, purpose: PlanBeat["purpose"]): LockedRefs {
  if (purpose === "cta" || purpose === "offer" || purpose === "pitch") return "product";
  return PEOPLE.test(visual) ? "cast+product" : "product";
}

/** Plan visuals mention edit-time layers ("End card E02: …", "Overlay: '…'", "badge slam"); keyframes must not. */
export function cleanVisual(visual: string, product: string): string {
  const v = visual
    .replace(/^\s*(end card|logo)[^:]*:\s*/i, "")
    .replace(/\boverlay:?\s*(['"“]).*?\1/gi, "")
    .replace(/[^.]*\b(badge|button|end card|logo|overlay|caption|text on screen)\b[^.]*\.?/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return v || `Hero shot of the ${product} from image 1, centered, softly lit`;
}

/** The presenter for this storyboard, or null when none was asked for. */
export function presenterFor(input: Pick<PlanStoryboardInput, "presenter" | "plan" | "category" | "casting">): Persona | null {
  if (!input.presenter) return null;
  if (typeof input.presenter === "string") {
    const named = personaById(input.presenter);
    if (named) return named;
  }
  return pickPersona(input.plan.platform, input.category, input.plan.audience, { casting: input.casting });
}

const CREATOR_BEAT = /\b(creator|pov|selfie|talking head|talks? (straight )?(in)?to (the )?camera|to-camera|ugc|vlog)\b/i;
const HOLDS_PRODUCT = /\b(holds?|holding|held|shows?|showing|unbox\w*|in (her|his|their) hands?|taps?|tapping|points? (at|to))\b/i;
const DELIVERY: Record<PlanBeat["purpose"], string> = {
  hook: "surprised, punchy, pattern-interrupt opener",
  pitch: "excited, conversational",
  proof: "convinced, matter-of-fact",
  benefit: "warm, genuinely happy",
  objection: "candid, reassuring",
  offer: "urgent, excited, like sharing a deal with a friend",
  cta: "direct, upbeat",
};

/** Which beats a presenter says on camera: the native/creator hook's opening, and creator / POV / selfie beats. */
export function talkBeats(script: PlanScript, plan: PlatformPlan): boolean[] {
  const family = hookById(script.hookId)?.family ?? plan.hookVariants.find((h) => h.hookId === script.hookId)?.family;
  const can = (b: PlanBeat) => b.purpose !== "cta" && !!b.vo?.trim();
  const picks = script.beats.map((b) => can(b) && ((family === "native" && (b.purpose === "hook" || b.purpose === "pitch")) || CREATOR_BEAT.test(`${b.visual} ${b.shotType ?? ""}`)));
  if (!picks.some(Boolean)) {
    // Asked for a presenter but the script has no creator beat: the opening line goes on camera.
    const k = script.beats.findIndex((b) => can(b) && (b.purpose === "hook" || b.purpose === "pitch"));
    if (k >= 0) picks[k] = true;
  }
  return picks;
}

// ---------- comparison visuals ----------
// Image models asked for a split screen / "slide between X and Y" in ONE image return stacked collages or a
// small product next to a big rival (live run 2026-10-07: K3, K5). A comparison beat becomes two generated
// shots instead: the keyframe shows only our product, full frame; `locked.compare.other` renders the other
// side separately and the edit stacks the two with labels (render-v2 compareFilter).

const CMP_WORDS = /\b(split[- ]screens?|side[- ]by[- ]side|before\s*(?:\/|and|&|vs\.?|-|to)\s*after|versus|vs\.?(?=\s|$)|comparisons?|compared (?:to|with)|two[- ]panel|diptych)/gi;
const SLIDE_BETWEEN = /\b(?:slides?|swipes?|cuts?|pans?|switch(?:es)?|moves?|toggles?|alternates?|glances?)\s+between\s+([^,.;:]+?)\s+and\s+([^,.;:]+)/i;
const PAIR = /([^,.;:]+?)\s+(?:vs\.?|versus|compared (?:to|with)|side[- ]by[- ]side with|next to|beside|alongside)\s+([^,.;:]+)/i;
/** "X and Y side-by-side …" (live autopilot plan: "NXTPAPER 14 and a glossy iPad side-by-side under a harsh desk lamp"). */
const AND_PAIR = /([^,.;:]+?)\s+and\s+([^,.;:]+?)\s+(?:side[- ]by[- ]side|next to each other|together)\b/i;
const BEFORE_AFTER = /\bbefore\b[^:]*?:\s*([^.;]+?),?\s+(?:then|→|->|and after|after)\s+([^.;]+)/i;
const BRAND = /\b(?:apple\s+)?i ?pads?(?:\s+(?:pro|air|mini))?\b|\b(?:samsung\s+)?galaxy\s+tab\w*\b|\bsamsung\b|\bkindle\b|\bsurface(?:\s+pro)?\b|\bremarkable\b|\bboox\b|\biphones?\b|\b(?:lg|sony|vizio|hisense)\b/gi;
const RIVAL = /\b(glossy|regular|ordinary|old(?:er)?|other|generic|typical|standard|cheap(?:er)?|competitor'?s?|conventional|lcd|oled|backlit|reflective|mirror-like|shiny)\b/i;
const DEVICE = "(?:tablets?|tvs?|televisions?|screens?|phones?|displays?|monitors?|laptops?|e-?readers?|devices?)";
const RIVAL_PHRASE = new RegExp(`(?:\\b(?:an?|the)\\s+)?(?:(?:${RIVAL.source.slice(3, -3)}|\\w+-free)\\s+){1,3}(?:\\w+\\s+)?${DEVICE}\\b|${BRAND.source}`, "i");
/** A model prompt that asks the image model for a layout it cannot draw. */
export const SPLIT_LAYOUT = /\b(split[- ]screens?|side[- ]by[- ]side|collages?|two[- ]panels?|diptych|\bpanels?\b|grid of|stacked (?:images|frames))/i;

function categoryOf(text: string): string {
  const m = text.match(/\b(tablet|ipad|galaxy tab|tv|television|phone|iphone|laptop|monitor|e-?reader|kindle)\b/i)?.[1].toLowerCase() ?? "";
  return /ipad|galaxy tab/.test(m) ? "tablet" : /iphone/.test(m) ? "phone" : /kindle/.test(m) ? "e-reader" : m === "television" ? "TV" : m === "tv" ? "TV" : m || "device";
}

const tidy = (t: string) =>
  t
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/([,;:])\1+/g, "$1")
    .replace(/^[\s,.;:\-–—]+|[\s,;:\-–—]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
const stripArticle = (t: string) => t.replace(/^\s*(?:an?|the|on|of)\s+/i, "").trim();

/** "TCL NXTPAPER 14 tablet" → "NXTPAPER 14": the model name without the brand and the category noun. */
export function productShortName(product: string): string {
  let w = product.trim().split(/\s+/).filter((x) => !/^(tablet|tv|television|phone|laptop|monitor|device|qd-mini|mini|led|oled|qled)$/i.test(x));
  if (w.length > 2) w = w.slice(1);
  return w.slice(0, 2).join(" ") || product.trim();
}

/** Significant tokens of the product name ("NXTPAPER", "14"): a side that names one is ours. */
function mentionsProduct(text: string, product: string): boolean {
  if (/\bimage 1\b|\bour (?:tablet|tv|product|device)\b/i.test(text)) return true;
  return product
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !/^(tablet|tv|phone|the|and)$/i.test(t))
    .some((t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));
}

/** Debrand the other side: "a glossy iPad" → "a glossy tablet". */
function debrand(text: string, category: string): string {
  return tidy(
    text
      .replace(BRAND, category)
      .replace(new RegExp(`\\b(${category})(\\s+\\1)+\\b`, "gi"), "$1")
  );
}

export interface ComparisonMapping {
  /** Our keyframe: only the product, single subject, full frame. */
  ours: string;
  /** The other side's keyframe (generated separately, no product reference). */
  other: string;
  labelOurs: string;
  labelOther: string;
}

const SINGLE = "A single device filling the frame (single subject, full frame), one continuous photograph; no split screen, no second device, no panels, no text.";

/**
 * Detect a comparison visual ("split-screen", "vs", "side by side", "slide between X and Y", "before/after")
 * and map it to two single-subject keyframe prompts plus labels. Null when the visual is not a comparison.
 * Pure.
 */
export function detectComparison(visual: string, product: string): ComparisonMapping | null {
  const v = visual.replace(/\s+/g, " ").trim();
  const cmpWord = new RegExp(CMP_WORDS.source, "i").test(v);
  const slide = v.match(SLIDE_BETWEEN);
  const near = /\b(next to|beside|alongside)\b/i.test(v) && RIVAL_PHRASE.test(v);
  if (!cmpWord && !(slide && (RIVAL_PHRASE.test(v) || mentionsProduct(slide[0], product))) && !near) return null;
  if (slide && !cmpWord && !near && !(mentionsProduct(slide[1], product) || mentionsProduct(slide[2], product)) && !RIVAL_PHRASE.test(slide[0])) return null;

  const category = categoryOf(`${product} ${v}`);
  const people = PEOPLE.test(v);
  let oursSide = "";
  let otherSide = "";
  let rest = v;
  let beforeAfter = false;
  const pair = slide ?? v.match(BEFORE_AFTER) ?? v.match(PAIR) ?? v.match(AND_PAIR);
  if (pair) {
    beforeAfter = pair !== slide && /\bbefore\b/i.test(pair[0]) && BEFORE_AFTER.test(pair[0]);
    let [a, b] = [pair[1].trim(), pair[2].trim()];
    // Ours names the product; else the rival side is the other; else the second / "after" side is ours.
    const aOurs = mentionsProduct(a, product), bOurs = mentionsProduct(b, product);
    if (aOurs && !bOurs) [a, b] = [b, a];
    else if (!aOurs && !bOurs && RIVAL_PHRASE.test(b) && !RIVAL_PHRASE.test(a)) [a, b] = [b, a];
    // Where it happens ("… on a sunlit desk", "… in noon sun") is shared by both shots, not one side's.
    const where = /\s+((?:on|in|under|at|against|by|beside|near)\s+(?:an?\s+|the\s+)?[^,]+)$/i;
    let place = "";
    const lastSide = pair[2].trim() === b ? "b" : "a";
    const m = (lastSide === "b" ? b : a).match(where);
    if (m && !mentionsProduct(m[1], product) && !RIVAL_PHRASE.test(m[1])) {
      place = m[1];
      if (lastSide === "b") b = b.slice(0, m.index).trim();
      else a = a.slice(0, m.index).trim();
    }
    otherSide = a;
    oursSide = b;
    // The slide verb's subject stays as context ("Hands slide between …" → "Hands").
    const keep = slide ? pair[0].slice(0, pair[0].search(/\bbetween\b/i)).replace(/\b\w+\s*$/, "") : " ";
    rest = v.replace(pair[0], `${keep} ${place}§`);
    // A short trailing clause right after the pair ("…matte screen, no glare") belongs to the side that ended there.
    rest = rest.replace(/§\s*,\s*([^,.;:]{1,32})(?=[.;]|$)/, (_m, tail: string) => {
      if (lastSide === "b") oursSide = `${oursSide}, ${tail.trim()}`;
      else otherSide = `${otherSide}, ${tail.trim()}`;
      return "";
    });
    rest = rest.replace("§", "");
  }
  // Leftover clauses: the ones about our product join ours, the rival's join the other side, the rest is shared.
  const shared: string[] = [];
  for (const clause of rest.replace(CMP_WORDS, " ").replace(/\bbefore\b\s*:?|\bafter\b\s*:?/gi, (m) => (beforeAfter ? " " : m)).split(/[;.]|:\s|,\s(?=on |then )/)) {
    const c = tidy(clause.replace(/\b(?:flicker )?test\b\s*$/i, (m) => m));
    if (!c) continue;
    if (mentionsProduct(c, product)) oursSide = tidy(`${oursSide} ${oursSide ? "— " : ""}${c}`);
    else if (RIVAL_PHRASE.test(c) && !otherSide) otherSide = c;
    else if (RIVAL_PHRASE.test(c)) otherSide = tidy(`${otherSide}, ${c}`);
    else if (!/^(hands?|a hand|person|she|he)$/i.test(c)) shared.push(people ? c.replace(/^(?:hands?|a hand)\s+/i, "") : c);
  }
  if (!otherSide) otherSide = beforeAfter ? "" : `an ordinary ${category}`;

  // Our side: the product name dropped (the prompt names it), what remains is detail.
  const productRe = new RegExp(`\\b(?:the\\s+)?${product.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}\\b`, "gi");
  const oursDetail = tidy(oursSide.replace(productRe, " ").replace(/\b(on|with)\s*$/i, "").replace(/^\s*(?:on|with)\s+/i, ""));
  const otherDesc = debrand(otherSide, category);
  const otherNoun = otherDesc.match(RIVAL_PHRASE)?.[0] ?? otherDesc.match(new RegExp(`(?:\\w+\\s+){0,2}${DEVICE}\\b`, "i"))?.[0] ?? "";
  const labelBase = stripArticle(otherNoun).replace(/\s+/g, " ").split(" ").slice(0, 3).join(" ");
  const labelOther = labelBase ? labelBase.charAt(0).toUpperCase() + labelBase.slice(1) : beforeAfter ? "Before" : "Others";
  const ctx = tidy(shared.join(", "));
  const hold = people ? "Hands hold " : "";
  const detail = stripArticle(oursDetail) ? ` — ${stripArticle(oursDetail)}` : "";
  const ours = tidy(`${hold}${people ? "the" : "The"} ${product} from image 1${detail}${ctx ? `, ${ctx}` : ""}. Only the ${product}. ${SINGLE}`);
  // "a glossy tablet …" gets its article back; a scene ("tired eyes reading …") does not.
  const subj = otherDesc ? stripArticle(otherDesc) : `${category} used the old way`;
  const device = new RegExp(`^(?:${RIVAL.source.slice(3, -3)}|${DEVICE})\\b`, "i").test(subj) || !otherDesc;
  const article = device ? (/^[aeiou]/i.test(subj) && !/^(?:one|uni|eu)/i.test(subj) ? "an " : "a ") : "";
  const lead = `${hold}${article}${subj}`;
  const other = tidy(
    `${lead.charAt(0).toUpperCase()}${lead.slice(1)}${ctx ? `, ${ctx}` : ""}, same framing and light as the product shot. Generic and unbranded: no logos, no brand names. ${SINGLE}`
  );
  return { ours, other, labelOurs: productShortName(product), labelOther };
}

/** Deterministic frames; prompts are usable as-is when the model pass fails. */
export function scaffoldLockedFrames(input: PlanStoryboardInput): PlanStoryboardFrame[] {
  const script = pickScript(input.plan, input.hookId);
  const engine = input.engine ?? "veo";
  const product = input.productName || "product";
  const setting = input.setting ? ` ${input.setting}.` : "";
  const persona = presenterFor(input);
  const talking = persona ? talkBeats(script, input.plan) : script.beats.map(() => false);
  // With a presenter, the presenter IS the lead cast (one face across talk and B-roll people shots).
  const castText = persona ? personaCast(persona) : input.cast;
  const profileCaptions = input.plan.captionStyle || PLATFORM_PROFILES.find((p) => p.id === input.plan.platform)?.captionStyle;
  const nativeCaptions = captionStyleFor(profileCaptions) === "native";
  let castGiven = false;
  // A talk line longer than its beat stretches the frame; every later frame shifts by the overflow.
  let shift = 0;
  return script.beats.map((b, i) => {
    if (persona && talking[i]) {
      const line = b.vo!.trim();
      const t0 = b.t0 + shift;
      const len = Math.max(b.t1 - b.t0, Math.min(8, Math.ceil(speechSec(line) * 2) / 2));
      shift += len - (b.t1 - b.t0);
      const holdsProduct = HOLDS_PRODUCT.test(b.visual);
      const delivery = DELIVERY[b.purpose];
      const locked: PlanStoryboardFrame["locked"] = {
        engine: engine === "veo1080" ? "veo1080" : "veo",
        refs: holdsProduct ? "cast+product" : "cast",
        anchorEnd: false,
        talk: { line, persona: persona.id, delivery, ...(holdsProduct ? { holdsProduct: true } : {}) },
      };
      if (!castGiven && castText) {
        locked.castLock = castText;
        castGiven = true;
      }
      if (i === 0 && nativeCaptions) locked.captionStyle = "native";
      return {
        frameNumber: i + 1,
        startSec: t0,
        endSec: t0 + len,
        segment: SEGMENT[b.purpose] ?? "BODY",
        imagePrompt: talkKeyframePrompt({ persona, product, holdsProduct, setting: input.setting }),
        videoPrompt: talkVideoPrompt({ line, persona, delivery, frameSec: len, product, holdsProduct }),
        locked,
        ...(b.onScreenText ? { textOverlay: b.onScreenText } : {}),
        voiceover: line,
        ...(b.sellingPointId ? { sellingPoint: b.sellingPointId } : {}),
      };
    }
    const refs = refsFor(b.visual, b.purpose);
    const people = refs === "cast" || refs === "cast+product";
    const productShot = refs === "product";
    const visual = b.purpose === "cta" ? `Hero shot of the ${product} from image 1, centered, on a warm softly lit table` : cleanVisual(b.visual, product);
    // Product shots name the product as the centred main subject at ≥ 40 % of the frame (product-coverage.ts).
    const framing = productShot ? ` ${productFramingClause(product)}` : "";
    const locked: PlanStoryboardFrame["locked"] = { engine, refs, anchorEnd: true };
    if (people && !castGiven && castText) {
      locked.castLock = castText;
      castGiven = true;
    }
    if (i === 0 && nativeCaptions) locked.captionStyle = "native";
    if (productShot) locked.zoomHit = { x: 0.5, y: 0.5 };
    if (b.purpose === "cta") {
      const ec = input.plan.endCard;
      locked.endCard = { id: ec.id, data: { ...(ec.data ?? {}), button: input.ctaButton?.trim() || ec.button, ...(ec.headline ? { headline: ec.headline } : {}) } };
    }
    const subject = refs === "none" ? "" : ` The ${product} from image 1 matches the reference exactly.`;
    // A comparison beat: two generated shots, stacked in the edit; our keyframe shows only the product.
    const cmp = b.purpose === "cta" ? null : detectComparison(visual, product);
    if (cmp) locked.compare = { other: `${cmp.other}${setting} Photorealistic, 35mm, natural light.`, labelOurs: cmp.labelOurs, labelOther: cmp.labelOther };
    const shot = cmp ? cmp.ours : visual.replace(/\bthe (tablet|tv|product|device)\b/i, `the ${product} from image 1`);
    return {
      frameNumber: i + 1,
      startSec: b.t0 + shift,
      endSec: b.t1 + shift,
      segment: SEGMENT[b.purpose] ?? "BODY",
      imagePrompt: `${shot}.${subject}${framing}${setting} Photorealistic, 35mm, natural light, no on-screen text.`.replace(/\.\./g, "."),
      videoPrompt: productShot
        ? `Slow push-in toward the product, then hold. The camera keeps the ${product} centered and fully in frame; it never pans or drifts away from it. Natural speed.`
        : "Natural, unhurried movement; gentle handheld drift. Natural speed.",
      locked,
      // The CTA's on-screen line says what the button says ("Claim Coupon"), not the plan's generic "Shop the sale".
      ...(b.purpose === "cta" && input.ctaButton?.trim() ? { textOverlay: input.ctaButton.trim().toUpperCase() } : b.onScreenText ? { textOverlay: b.onScreenText } : {}),
      ...(b.vo ? { voiceover: b.vo, voiceStyle: styleForBeat(b.purpose, input.plan.platform), ...(platformEnergy(input.plan.platform) ? { voiceEnergy: platformEnergy(input.plan.platform) } : {}) } : {}),
      ...(b.sellingPointId ? { sellingPoint: b.sellingPointId } : {}),
    };
  });
}

const optStr = z.string().nullable().optional().catch(undefined);
export const directorCopySchema = z
  .object({ frames: z.array(z.object({ i: z.coerce.number().int(), imagePrompt: optStr, videoPrompt: optStr, endState: optStr }).catch({ i: -1 })).catch([]) })
  .partial()
  .catch({});

const DIRECTOR_SYSTEM = `You are the director of a short vertical product video ad. For each numbered frame write:
- NEVER add badges, stickers, labels, certification marks, logos, buttons, price tags, captions or any text to the product or the scene, and never leave "space for" them — every overlay, end card and button is added later in the edit and must not be mentioned. The product carries only what the reference shows.
- NEVER ask the image model for split-screens, collages, side-by-side or two-panel layouts, grids, or a second competing device: every keyframe is ONE continuous photograph of a single scene. A frame marked COMPARE shows ONLY our product, single subject, full frame — the other side is generated separately and stacked in the edit; never mention the other device in its imagePrompt, videoPrompt or endState.
- imagePrompt: the first keyframe as one photorealistic still (subject, action, framing, lens, light, set). Refer to the product as "the <product> from image 1" and keep it exactly as the reference (shape, bezel, thickness, colour, logo). Never ask for readable text, UI or screen content you cannot control.
- videoPrompt: the motion inside the frame duration with second marks (e.g. "0–1s: … 1–3s: …"), natural speed; zooms always end on the product, and the camera never pans or drifts off it.
- Product shots (refs=product) and the CTA: the product is the main subject, centered, filling at least 40% of the frame height, fully in frame — never small, in a corner or half out of frame. The CTA is a front-view product hero.
- The product is visible in frame 1 and in most frames.
- endState: what the last frame of the clip shows (the clip is generated between the first and the last keyframe).
Keep the same people, wardrobe, location and light across frames. Return JSON {"frames":[{"i":1,"imagePrompt":"…","videoPrompt":"…","endState":"…"}]}.`;

const defaultLlm: LlmFn = async ({ system, user }) => {
  const { analyzeWithClaude } = await import("@/services/ai/claude-client");
  return analyzeWithClaude({ systemPrompt: system, userPrompt: user, responseSchema: directorCopySchema, maxTokens: 3500 });
};

/** The music bed for a plan: its musicMood (platform musicStyle by default), the category, the platform, seasonal copy. */
export function planMusicMood(input: PlanStoryboardInput): MoodId {
  const script = pickScript(input.plan, input.hookId);
  const copy = script.beats.map((b) => `${b.onScreenText ?? ""} ${b.vo ?? ""}`).join(" ") + ` ${input.plan.endCard?.headline ?? ""}`;
  return pickMusicMood({ planMood: input.plan.musicMood, category: input.category, platform: input.plan.platform, copy });
}

/** Product coverage check + auto-fix (product-coverage.ts) and the music bed on frame 1. */
function finishFrames(frames: PlanStoryboardFrame[], input: PlanStoryboardInput): { frames: PlanStoryboardFrame[]; coverage: CoverageIssue[] } {
  const checked = validateProductCoverage(frames, { productName: input.productName || "product" });
  const out = checked.frames;
  if (out[0]) out[0].locked.musicMood = planMusicMood(input);
  return { frames: out, coverage: checked.issues };
}

export async function directPlanStoryboard(
  input: PlanStoryboardInput,
  deps: { llm?: LlmFn } = {}
): Promise<{ frames: PlanStoryboardFrame[]; title: string; source: "llm" | "fallback"; error?: string; presenter?: string; coverage: CoverageIssue[] }> {
  const frames = scaffoldLockedFrames(input);
  const script = pickScript(input.plan, input.hookId);
  const title = `${input.plan.label} · ${script.title}`;
  const user = [
    `PRODUCT: ${input.productName}`,
    (frames.find((f) => f.locked.castLock)?.locked.castLock ?? input.cast) ? `LEAD CAST: ${frames.find((f) => f.locked.castLock)?.locked.castLock ?? input.cast}` : "",
    input.setting ? `SET: ${input.setting}` : "",
    `PLATFORM: ${input.plan.label} ${input.plan.aspect}, ${input.plan.durationSec}s. Style: ${input.plan.styleNotes}`,
    "FRAMES:",
    ...frames.map((f, k) => {
      const b = script.beats[k];
      if (f.locked.talk) return `${f.frameNumber}. ${f.startSec}–${f.endSec}s ${b.purpose.toUpperCase()} — presenter talking-head frame, prompts fixed: skip it`;
      const line = `${f.frameNumber}. ${f.startSec}–${f.endSec}s ${b.purpose.toUpperCase()} refs=${f.locked.refs} — `;
      return f.locked.compare
        ? `${line}COMPARE (the edit stacks it against "${f.locked.compare.labelOther}"; show ONLY the ${input.productName}): ${f.imagePrompt}`
        : `${line}${cleanVisual(b.visual, input.productName)}`;
    }),
  ]
    .filter(Boolean)
    .join("\n");
  try {
    const raw = directorCopySchema.parse((await (deps.llm ?? defaultLlm)({ system: DIRECTOR_SYSTEM, user })) ?? {});
    let applied = 0;
    for (const r of raw.frames ?? []) {
      const f = frames.find((x) => x.frameNumber === r.i);
      // Talk frames carry the quoted line and lip-sync brief: never rewritten.
      if (!f || f.locked.talk) continue;
      // A prompt that asks for a split layout (or, on a COMPARE frame, shows the other device) keeps the scaffold.
      const cmp = f.locked.compare;
      const rival = (t: string) => !!cmp && (RIVAL_PHRASE.test(t) || /\b(between|both|two)\b[^.]*\b(tablets?|tvs?|screens?|devices?|phones?)\b/i.test(t) || new RegExp(`\\b${cmp.labelOther}\\b`, "i").test(t));
      const ok = (t?: string | null): boolean => !!t?.trim() && !SPLIT_LAYOUT.test(t!) && !rival(t!);
      if (ok(r.imagePrompt)) f.imagePrompt = r.imagePrompt!.trim();
      if (r.imagePrompt?.trim()) applied++;
      if (ok(r.videoPrompt)) f.videoPrompt = r.videoPrompt!.trim();
      if (ok(r.endState)) f.locked.endState = r.endState!.trim();
    }
    const presenter = frames.find((f) => f.locked.talk)?.locked.talk?.persona;
    if (!applied && frames.some((f) => !f.locked.talk)) throw new Error("model returned no prompts");
    return { ...finishFrames(frames, input), title, source: "llm", ...(presenter ? { presenter } : {}) };
  } catch (err) {
    const presenter = frames.find((f) => f.locked.talk)?.locked.talk?.persona;
    return { ...finishFrames(frames, input), title, source: "fallback", error: err instanceof Error ? err.message : String(err), ...(presenter ? { presenter } : {}) };
  }
}
