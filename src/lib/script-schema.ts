// Structured script v2 — the shape the script writer must emit and the shape
// persisted across Script.hook / Script.bodyBeats / Script.cta.
//
// Durations are never trusted from the model: `validateAndRepairDurations`
// rescales hook + body beats + CTA in code so they sum to exactly the
// requested total, and `renderScriptBody` flattens the structure back into the
// legacy `Script.body` string so existing displays keep working.

import { z } from "zod";
import { isVideoType, type VideoType } from "@/services/ai/prompts/script-templates";

export const HOW_EXPRESSED_MODES = [
  "demonstration",
  "on-screen proof",
  "VO claim + evidence",
  "testimonial",
  "comparison",
] as const;

export const scriptHookSchema = z.object({
  text: z.string().default(""),
  visual: z.string().default(""),
  shot: z.string().default(""),
  durationSec: z.coerce.number().default(3),
  hookFormula: z.string().default(""),
});

export const scriptBodyBeatSchema = z.object({
  beat: z.string().default(""),
  sellingPoint: z.string().default(""),
  howExpressed: z.string().default(""),
  shot: z.string().default(""),
  startSec: z.coerce.number().default(0),
  endSec: z.coerce.number().default(0),
  voiceover: z.string().default(""),
  textOverlay: z.string().default(""),
  proof: z.string().default(""),
});

export const scriptCtaSchema = z.object({
  text: z.string().default(""),
  offer: z.string().default(""),
  urgency: z.string().default(""),
  visual: z.string().default(""),
  shot: z.string().default(""),
  durationSec: z.coerce.number().default(3),
});

export const scriptSceneSchema = z.object({
  sceneNumber: z.coerce.number().default(1),
  startSec: z.coerce.number().default(0),
  endSec: z.coerce.number().default(5),
  segmentLabel: z.string().default(""),
  shotType: z.string().default(""),
  focalLength: z.string().default(""),
  cameraMovement: z.string().default(""),
  aperture: z.string().default(""),
  location: z.string().default(""),
  lighting: z.string().default(""),
  actorAction: z.string().default(""),
  productAction: z.string().default(""),
  voiceover: z.string().default(""),
  textOverlay: z.string().default(""),
  transition: z.string().default(""),
});

const EMPTY_HOOK = {
  text: "",
  visual: "",
  shot: "",
  durationSec: 3,
  hookFormula: "",
};

const EMPTY_CTA = {
  text: "",
  offer: "",
  urgency: "",
  visual: "",
  shot: "",
  durationSec: 3,
};

export const scriptV2Schema = z.object({
  title: z.string(),
  angle: z.string().default(""),
  format: z.string().default(""),
  duration: z.string().default(""),
  platform: z.string().default(""),
  videoType: z.string().default(""),
  template: z.string().default(""),
  totalDurationSec: z.coerce.number().default(30),

  hook: scriptHookSchema.default(EMPTY_HOOK),
  body: z.array(scriptBodyBeatSchema).default([]),
  cta: scriptCtaSchema.default(EMPTY_CTA),

  hookVariants: z.array(z.string()).default([]),
  ctaVariants: z.array(z.string()).default([]),
  narrativeType: z.string().default("DEMONSTRATION"),
  targetEmotion: z.string().default(""),
  predictedScore: z.coerce.number().default(70),
  platformTechniques: z.array(z.string()).default([]),
  scenes: z.array(scriptSceneSchema).default([]),
});

export type ScriptHook = z.infer<typeof scriptHookSchema>;
export type ScriptBodyBeat = z.infer<typeof scriptBodyBeatSchema>;
export type ScriptCta = z.infer<typeof scriptCtaSchema>;
export type ScriptScene = z.infer<typeof scriptSceneSchema>;
export type ScriptV2 = z.infer<typeof scriptV2Schema>;

function clampInt(n: unknown, fallback: number): number {
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) ? Math.round(v) : fallback;
}

/**
 * Rescale hook / body beats / CTA so the three sections sum to exactly
 * `totalDurationSec`. Body beat start/end seconds are rebuilt contiguously so
 * the 2-second storyboard grid can always find a beat for every window.
 */
export function validateAndRepairDurations(script: ScriptV2, totalDurationSec: number): ScriptV2 {
  const total = Math.max(4, clampInt(totalDurationSec, 30));

  let hookDur = Math.max(1, clampInt(script.hook?.durationSec, Math.round(total * 0.2)));
  let ctaDur = Math.max(1, clampInt(script.cta?.durationSec, Math.round(total * 0.2)));

  if (hookDur + ctaDur > total - 1) {
    const budget = total - 1;
    const scale = budget / (hookDur + ctaDur);
    hookDur = Math.max(1, Math.floor(hookDur * scale));
    ctaDur = Math.max(1, Math.min(budget - hookDur, Math.floor(ctaDur * scale)));
  }

  const bodySpan = total - hookDur - ctaDur;
  const beats = script.body.length ? script.body : [];

  const rawDurations = beats.map((b) => {
    const d = clampInt(b.endSec, 0) - clampInt(b.startSec, 0);
    return d > 0 ? d : bodySpan / Math.max(1, beats.length) || 1;
  });
  const rawSum = rawDurations.reduce((a, b) => a + b, 0) || 1;

  let cursor = hookDur;
  const repairedBeats: ScriptBodyBeat[] = beats.map((b, i) => {
    const isLast = i === beats.length - 1;
    const share = (rawDurations[i] / rawSum) * bodySpan;
    const end = isLast ? hookDur + bodySpan : Math.min(hookDur + bodySpan, Math.round(cursor + share));
    const start = cursor;
    cursor = Math.max(start + 1, end);
    return { ...b, startSec: start, endSec: Math.max(start + 1, end) };
  });

  if (repairedBeats.length) {
    repairedBeats[repairedBeats.length - 1].endSec = hookDur + bodySpan;
  }

  return {
    ...script,
    totalDurationSec: total,
    duration: `${total}s`,
    hook: { ...script.hook, durationSec: hookDur },
    body: repairedBeats,
    cta: { ...script.cta, durationSec: ctaDur },
  };
}

/**
 * Flatten the structured script into the labelled plain-text body stored on
 * `Script.body`, so every existing reader (export package, studio brief,
 * legacy UI) keeps working against a single string.
 */
export function renderScriptBody(script: ScriptV2): string {
  const total = script.totalDurationSec || 30;
  const hookDur = Math.max(1, clampInt(script.hook?.durationSec, 3));
  const ctaDur = Math.max(1, clampInt(script.cta?.durationSec, 3));
  const ctaStart = Math.max(hookDur, total - ctaDur);

  const lines: string[] = [];

  lines.push(`[HOOK 0–${hookDur}s] ${script.hook?.text || ""}`.trimEnd());
  if (script.hook?.visual) lines.push(`  Visual: ${script.hook.visual}`);
  if (script.hook?.shot) lines.push(`  Shot: ${script.hook.shot}`);
  if (script.hook?.hookFormula) lines.push(`  Hook formula: ${script.hook.hookFormula}`);
  lines.push("");

  script.body.forEach((b, i) => {
    const label = [b.beat || `beat ${i + 1}`, b.sellingPoint, b.howExpressed]
      .filter(Boolean)
      .join(" · ");
    lines.push(`[BODY ${label}] ${b.startSec}–${b.endSec}s`);
    if (b.shot) lines.push(`  Shot: ${b.shot}`);
    if (b.voiceover) lines.push(`  VO: ${b.voiceover}`);
    if (b.textOverlay) lines.push(`  Text: ${b.textOverlay}`);
    if (b.proof) lines.push(`  Proof: ${b.proof}`);
    lines.push("");
  });

  lines.push(`[CTA ${ctaStart}–${total}s] ${script.cta?.text || ""}`.trimEnd());
  if (script.cta?.offer) lines.push(`  Offer: ${script.cta.offer}`);
  if (script.cta?.urgency) lines.push(`  Urgency: ${script.cta.urgency}`);
  if (script.cta?.visual) lines.push(`  Visual: ${script.cta.visual}`);
  if (script.cta?.shot) lines.push(`  Shot: ${script.cta.shot}`);

  return lines.join("\n").trim();
}

/** Resolve the video type the model returned, falling back to the template's. */
export function resolveVideoType(raw: unknown, fallback: VideoType): VideoType {
  const up = typeof raw === "string" ? raw.toUpperCase() : "";
  return isVideoType(up) ? up : fallback;
}
