/**
 * Plan → locked storyboard (the "URL-to-video" step): one campaign-plan script becomes a
 * locked-script storyboard the server executor renders as written. Timing, segments, refs,
 * cast lock, product zooms, first+last anchoring and the CTA end card are decided here in code;
 * one text-model call writes the keyframe / motion prompts, with a scaffold fallback.
 */
import { z } from "zod";
import type { LockedEngine, LockedFrame, LockedRefs } from "@/services/video-gen/locked-script";
import type { PlanBeat, PlanScript, PlatformPlan } from "./campaign-plan.types";
import type { LlmFn } from "./campaign-planner";

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

/** Deterministic frames; prompts are usable as-is when the model pass fails. */
export function scaffoldLockedFrames(input: PlanStoryboardInput): PlanStoryboardFrame[] {
  const script = pickScript(input.plan, input.hookId);
  const engine = input.engine ?? "veo";
  const product = input.productName || "product";
  const setting = input.setting ? ` ${input.setting}.` : "";
  let castGiven = false;
  return script.beats.map((b, i) => {
    const refs = refsFor(b.visual, b.purpose);
    const people = refs === "cast" || refs === "cast+product";
    const productShot = refs === "product";
    const visual = b.purpose === "cta" ? `Hero shot of the ${product} from image 1, centered, on a warm softly lit table` : cleanVisual(b.visual, product);
    const locked: PlanStoryboardFrame["locked"] = { engine, refs, anchorEnd: true };
    if (people && !castGiven && input.cast) {
      locked.castLock = input.cast;
      castGiven = true;
    }
    if (productShot) locked.zoomHit = { x: 0.5, y: 0.5 };
    if (b.purpose === "cta") {
      const ec = input.plan.endCard;
      locked.endCard = { id: ec.id, data: { ...(ec.data ?? {}), button: input.ctaButton?.trim() || ec.button, ...(ec.headline ? { headline: ec.headline } : {}) } };
    }
    const subject = refs === "none" ? "" : ` The ${product} from image 1 matches the reference exactly.`;
    return {
      frameNumber: i + 1,
      startSec: b.t0,
      endSec: b.t1,
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
): Promise<{ frames: PlanStoryboardFrame[]; title: string; source: "llm" | "fallback"; error?: string }> {
  const frames = scaffoldLockedFrames(input);
  const script = pickScript(input.plan, input.hookId);
  const title = `${input.plan.label} · ${script.title}`;
  const user = [
    `PRODUCT: ${input.productName}`,
    input.cast ? `LEAD CAST: ${input.cast}` : "",
    input.setting ? `SET: ${input.setting}` : "",
    `PLATFORM: ${input.plan.label} ${input.plan.aspect}, ${input.plan.durationSec}s. Style: ${input.plan.styleNotes}`,
    "FRAMES:",
    ...frames.map((f, k) => {
      const b = script.beats[k];
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
      if (!f) continue;
      if (r.imagePrompt?.trim()) (f.imagePrompt = r.imagePrompt.trim()), applied++;
      if (r.videoPrompt?.trim()) f.videoPrompt = r.videoPrompt.trim();
      if (r.endState?.trim()) f.locked.endState = r.endState.trim();
    }
    if (!applied) throw new Error("model returned no prompts");
    return { frames, title, source: "llm" };
  } catch (err) {
    return { frames, title, source: "fallback", error: err instanceof Error ? err.message : String(err) };
  }
}
