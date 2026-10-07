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
  /** Product category (creative library id) for the persona pick. */
  category?: string;
  /** Who the presenter may be (personas.ts resolveCasting); default white / Latino. */
  casting?: CastingPrefs;
}

export interface PlanStoryboardFrame extends LockedFrame {
  textOverlay?: string;
  voiceover?: string;
  sellingPoint?: string;
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
    return {
      frameNumber: i + 1,
      startSec: b.t0 + shift,
      endSec: b.t1 + shift,
      segment: SEGMENT[b.purpose] ?? "BODY",
      imagePrompt: `${visual.replace(/\bthe (tablet|tv|product|device)\b/i, `the ${product} from image 1`)}.${subject}${setting} Photorealistic, 35mm, natural light, no on-screen text.`.replace(/\.\./g, "."),
      videoPrompt: productShot ? "Slow push-in toward the product, then hold. Natural speed." : "Natural, unhurried movement; gentle handheld drift. Natural speed.",
      locked,
      ...(b.onScreenText ? { textOverlay: b.onScreenText } : {}),
      ...(b.vo ? { voiceover: b.vo } : {}),
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
- imagePrompt: the first keyframe as one photorealistic still (subject, action, framing, lens, light, set). Refer to the product as "the <product> from image 1" and keep it exactly as the reference (shape, bezel, thickness, colour, logo). Never ask for readable text, UI or screen content you cannot control.
- videoPrompt: the motion inside the frame duration with second marks (e.g. "0–1s: … 1–3s: …"), natural speed; zooms always end on the product.
- endState: what the last frame of the clip shows (the clip is generated between the first and the last keyframe).
Keep the same people, wardrobe, location and light across frames. Return JSON {"frames":[{"i":1,"imagePrompt":"…","videoPrompt":"…","endState":"…"}]}.`;

const defaultLlm: LlmFn = async ({ system, user }) => {
  const { analyzeWithClaude } = await import("@/services/ai/claude-client");
  return analyzeWithClaude({ systemPrompt: system, userPrompt: user, responseSchema: directorCopySchema, maxTokens: 3500 });
};

export async function directPlanStoryboard(
  input: PlanStoryboardInput,
  deps: { llm?: LlmFn } = {}
): Promise<{ frames: PlanStoryboardFrame[]; title: string; source: "llm" | "fallback"; error?: string; presenter?: string }> {
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
      return `${f.frameNumber}. ${f.startSec}–${f.endSec}s ${b.purpose.toUpperCase()} refs=${f.locked.refs} — ${cleanVisual(b.visual, input.productName)}`;
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
      if (r.imagePrompt?.trim()) (f.imagePrompt = r.imagePrompt.trim()), applied++;
      if (r.videoPrompt?.trim()) f.videoPrompt = r.videoPrompt.trim();
      if (r.endState?.trim()) f.locked.endState = r.endState.trim();
    }
    const presenter = frames.find((f) => f.locked.talk)?.locked.talk?.persona;
    if (!applied && frames.some((f) => !f.locked.talk)) throw new Error("model returned no prompts");
    return { frames, title, source: "llm", ...(presenter ? { presenter } : {}) };
  } catch (err) {
    const presenter = frames.find((f) => f.locked.talk)?.locked.talk?.persona;
    return { frames, title, source: "fallback", error: err instanceof Error ? err.message : String(err), ...(presenter ? { presenter } : {}) };
  }
}
