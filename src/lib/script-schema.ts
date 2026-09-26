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
  // Scored 0-100; a model that answers on a 0-10 scale ("8.5") would otherwise
  // never win "Pick the best" against the 85s.
  predictedScore: z.coerce.number().default(70).transform((v) => (v > 0 && v <= 10 ? Math.round(v * 10) : v)),
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

// ---------------------------------------------------------------------------
// Compliance audit — deterministic, code-side check that a generated script
// stays inside the brand kit's approved claims and CTA pool. The prompt
// (script-writing.ts) already tells the model these rules; this is the
// backstop for when it doesn't listen.

export interface ScriptClaimsAuditInput {
  claimsAllowed?: string[];
  claimsForbidden?: string[];
  ctaOptions?: string[];
  offerText?: string;
  /**
   * Brand truth + briefing + claimsAllowed + offerText, concatenated — the
   * only place a number/percentage/count/ratio/star-rating/review-count
   * claim in the script is allowed to come from. Optional for backward
   * compatibility: when omitted, the numeric-claims check is skipped.
   */
  sourceText?: string;
}

export interface ScriptClaimsViolation {
  /** Dotted/indexed path into the script, e.g. "hook.text" or "body[1].voiceover". */
  path: string;
  /** The offending substring. */
  text: string;
  reason: string;
}

export interface ScriptClaimsAudit {
  ok: boolean;
  violations: ScriptClaimsViolation[];
}

/** Absolute / curative words that are never allowed, regardless of the brand kit. */
const ABSOLUTE_CLAIM_PATTERNS: Array<{ regex: RegExp; label: string }> = [
  { regex: /\berase[sd]?\b/i, label: "erase(d/s)" },
  { regex: /\bcures?\b/i, label: "cure(s)" },
  { regex: /\beliminates?\b/i, label: "eliminate(s)" },
  { regex: /\bpermanent(?:ly)?\b/i, label: "permanent(ly)" },
  { regex: /\bguaranteed\b/i, label: "guaranteed" },
  { regex: /\bproven\b/i, label: "proven" },
  { regex: /\bclinically\b/i, label: "clinically" },
  { regex: /\binstantly\s+reverses\b/i, label: "instantly reverses" },
  { regex: /\b100\s?%/i, label: "100%" },
];

/**
 * Social proof the model tends to invent: press mentions, star ratings, crowd
 * sizes, rankings. Allowed only when the brand's own sources say it.
 */
const SOCIAL_PROOF_PATTERNS: RegExp[] = [
  /\b(?:featured in|as seen (?:in|on))\b:?\s*([^.!?\n]+)/i,
  /\b(?:five|5)[- ]star\b/i,
  /\b(?:thousands|millions|hundreds) of (?:[a-z-]+ )?(?:customers|users|reviews|fans|founders|travell?ers|businesses)\b/i,
  /(?:#1|\bno\.? ?1\b|\bnumber one\b|\bbest[- ]selling\b|\baward[- ]winning\b)/i,
];

/** Social-proof phrases in `text` that the brand's source text never states. */
export function findUnsourcedSocialProof(text: string, sourceText: string): string[] {
  const source = sourceText.toLowerCase();
  const hits: string[] = [];
  for (const regex of SOCIAL_PROOF_PATTERNS) {
    const m = text.match(regex);
    if (!m) continue;
    if (m[1]) {
      // "Featured in: TechCrunch, Forbes" — every outlet named must be sourced.
      const outlets = m[1].split(/,|\band\b|&/).map((o) => o.trim()).filter((o) => o.length > 1);
      if (outlets.some((o) => !source.includes(o.toLowerCase()))) hits.push(m[0].trim());
    } else if (!source.includes(m[0].toLowerCase())) {
      hits.push(m[0]);
    }
  }
  return hits;
}

/** Words/phrases that hint at a deadline — used to check cta.urgency against the offer text. */
const URGENCY_SIGNAL_REGEX =
  /\b(today|tonight|hours?|days?|weeks?|deadline|expir(?:es|ing)|ending|ends?|until|limited(?:\s+time)?|last chance|midnight|countdown|this\s+week(?:end)?)\b/i;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findForbiddenMatches(text: string, forbiddenPhrases: string[]): string[] {
  const hits: string[] = [];
  for (const phrase of forbiddenPhrases) {
    const trimmed = phrase.trim();
    if (!trimmed) continue;
    const pattern = new RegExp(`\\b${escapeRegExp(trimmed).replace(/\s+/g, "\\s+")}\\b`, "i");
    const match = text.match(pattern);
    if (match) hits.push(match[0]);
  }
  return hits;
}

function findAbsoluteMatches(text: string): string[] {
  const hits: string[] = [];
  for (const { regex } of ABSOLUTE_CLAIM_PATTERNS) {
    const match = text.match(regex);
    if (match) hits.push(match[0]);
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Numeric-claim extraction — catches fabricated stats ("84% of women…") that
// slip past the forbidden-phrase and absolute-word checks above because the
// number itself, not a banned word, is the fabrication.

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

/** "eighty-four" -> 84, "twelve" -> 12. Only covers one..ninety-nine. */
function spelledToNumber(phrase: string): number | null {
  const parts = phrase.toLowerCase().trim().split(/[\s-]+/);
  if (parts.length === 1) {
    return NUMBER_WORDS[parts[0]] ?? null;
  }
  if (parts.length === 2) {
    const tens = NUMBER_WORDS[parts[0]];
    const ones = NUMBER_WORDS[parts[1]];
    if (tens !== undefined && tens % 10 === 0 && tens >= 20 && ones !== undefined && ones < 10) {
      return tens + ones;
    }
  }
  return null;
}

function parseNumericLiteral(raw: string): number {
  return Number(raw.replace(/,/g, ""));
}

/**
 * Structural timing/measurement numbers that are never a "claim": "10s",
 * "2 sec", "7-day", "Day 1" — and beat-range spans like "3–4.2s" (rendered
 * with an en dash, and using the raw, pre-repair fractional seconds the
 * audit runs against before `validateAndRepairDurations` rounds them), where
 * the *start* of the range sits one or more dash/number hops before the unit.
 */
const DASH_CLASS = "\\s\\-\\u2010-\\u2015"; // ascii space/hyphen + unicode hyphen..horizontal-bar (incl. en/em dash)
const STRUCTURAL_UNIT_AFTER = new RegExp(
  `^[${DASH_CLASS}]*(?:\\d[\\d,]*(?:\\.\\d+)?[${DASH_CLASS}]*)?(seconds?|secs?|s|mm|cm|ml|oz|fps|year[-\\s]?olds?|years?\\s+old|yo)\\b`,
  "i"
);
const STRUCTURAL_DAY_AFTER = new RegExp(`^[${DASH_CLASS}]*days?\\b`, "i");
const STRUCTURAL_DAY_BEFORE = new RegExp(`\\bdays?[${DASH_CLASS}]*$`, "i");

function isStructuralNumber(text: string, start: number, end: number): boolean {
  const after = text.slice(end, end + 12);
  const before = text.slice(Math.max(0, start - 12), start);
  return (
    STRUCTURAL_UNIT_AFTER.test(after) || STRUCTURAL_DAY_AFTER.test(after) || STRUCTURAL_DAY_BEFORE.test(before)
  );
}

export interface NumericClaim {
  /** The matched substring, e.g. "84%", "4.8-star", "10,000 reviews", "3 in 4". */
  raw: string;
  value: number;
}

/**
 * Extract every number-like claim from `text`: percentages, star ratings,
 * review/rating counts, "X in Y" / "X out of Y" ratios, spelled-out numbers
 * (one..ninety-nine) followed by "percent"/"%"/"in"/"out of", and any other
 * bare number — excluding structural timing/measurement numbers (durations,
 * "Day N", units).
 */
export function extractNumericClaims(text: string): NumericClaim[] {
  if (!text) return [];
  const claims: NumericClaim[] = [];
  const claimedRanges: Array<[number, number]> = [];

  const overlaps = (start: number, end: number) =>
    claimedRanges.some(([s, e]) => start < e && end > s);

  const claim = (start: number, end: number, raw: string, value: number) => {
    if (!Number.isFinite(value)) return;
    claimedRanges.push([start, end]);
    claims.push({ raw, value });
  };

  // Percent: "84%" / "84 percent"
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?\s?(%|percent\b)/gi)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const numMatch = m[0].match(/\d[\d,]*(?:\.\d+)?/);
    if (numMatch) claim(start, end, m[0], parseNumericLiteral(numMatch[0]));
  }

  // Star ratings: "4.8-star" / "4.8 stars"
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?[\s-]*stars?\b/gi)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (overlaps(start, end)) continue;
    const numMatch = m[0].match(/\d[\d,]*(?:\.\d+)?/);
    if (numMatch) claim(start, end, m[0], parseNumericLiteral(numMatch[0]));
  }

  // Review / rating counts: "10,000 reviews"
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?\+?\s+(?:reviews?|ratings?)\b/gi)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (overlaps(start, end)) continue;
    const numMatch = m[0].match(/\d[\d,]*(?:\.\d+)?/);
    if (numMatch) claim(start, end, m[0], parseNumericLiteral(numMatch[0]));
  }

  // "X in Y" / "X out of Y"
  for (const m of text.matchAll(/\b(\d+)\s+(?:in|out of)\s+(\d+)\b/gi)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (overlaps(start, end)) continue;
    claimedRanges.push([start, end]);
    claims.push({ raw: m[0], value: Number(m[1]) });
    claims.push({ raw: m[0], value: Number(m[2]) });
  }

  // Spelled-out numbers followed by percent/%/in/out of
  for (const m of text.matchAll(/\b([a-z]+(?:[\s-][a-z]+)?)\s+(percent|%|in|out of)\b/gi)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (overlaps(start, end)) continue;
    const value = spelledToNumber(m[1]);
    if (value != null) claim(start, end, m[0], value);
  }

  // Any remaining bare number, excluding structural timing/measurement numbers
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (overlaps(start, end)) continue;
    if (isStructuralNumber(text, start, end)) continue;
    claim(start, end, m[0], parseNumericLiteral(m[0]));
  }

  return claims;
}

/** Does `value` occur anywhere in `sourceText`, as a number (digits or spelled-out)? */
function numberOccursIn(value: number, sourceText: string): boolean {
  if (!sourceText) return false;
  if (extractNumericClaims(sourceText).some((c) => c.value === value)) return true;
  const spelled = Object.entries(NUMBER_WORDS).find(([, n]) => n === value)?.[0];
  return spelled ? new RegExp(`\\b${spelled}\\b`, "i").test(sourceText) : false;
}

/**
 * Deterministic post-generation compliance scan. Checks hook/body/cta text
 * fields plus the fully rendered body for brand-forbidden phrases and a fixed
 * list of absolute/curative words, confirms the CTA came from the approved
 * pool verbatim, and flags urgency copy the offer text never authorized.
 */
/**
 * Run the same forbidden / absolute-word and unsourced-number checks over one
 * free-text block. Used when a human edits a script by hand — the structured
 * beats are untouched, so only the prose they changed can be audited.
 */
export function auditScriptText(text: string, opts: ScriptClaimsAuditInput): ScriptClaimsAudit {
  const claimsForbidden = (opts.claimsForbidden ?? []).filter(
    (c): c is string => typeof c === "string" && c.trim().length > 0
  );
  const sourceText = opts.sourceText ?? "";
  const violations: ScriptClaimsViolation[] = [];

  for (const hit of findForbiddenMatches(text, claimsForbidden)) {
    violations.push({ path: "body", text: hit, reason: `forbidden claim: "${hit}"` });
  }
  for (const hit of findAbsoluteMatches(text)) {
    violations.push({ path: "body", text: hit, reason: `absolute/curative claim: "${hit}"` });
  }
  if (sourceText) {
    for (const nc of extractNumericClaims(text)) {
      if (!numberOccursIn(nc.value, sourceText)) {
        violations.push({
          path: "body",
          text: nc.raw,
          reason: `unsourced numeric claim: "${nc.raw}" does not appear in brand truth / briefing / claimsAllowed / offer text`,
        });
      }
    }
  }
  return { ok: violations.length === 0, violations };
}

export function auditScriptClaims(script: ScriptV2, opts: ScriptClaimsAuditInput): ScriptClaimsAudit {
  const claimsForbidden = (opts.claimsForbidden ?? []).filter(
    (c): c is string => typeof c === "string" && c.trim().length > 0
  );
  const ctaOptions = (opts.ctaOptions ?? []).map((c) => c.trim()).filter(Boolean);
  const offerText = opts.offerText ?? "";
  const sourceText = opts.sourceText ?? "";

  const violations: ScriptClaimsViolation[] = [];

  const fields: Array<{ path: string; text: string }> = [
    { path: "hook.text", text: script.hook?.text ?? "" },
    ...(script.body ?? []).flatMap((beat, i) => [
      { path: `body[${i}].voiceover`, text: beat.voiceover ?? "" },
      { path: `body[${i}].textOverlay`, text: beat.textOverlay ?? "" },
      { path: `body[${i}].proof`, text: beat.proof ?? "" },
    ]),
    { path: "cta.text", text: script.cta?.text ?? "" },
    { path: "cta.offer", text: script.cta?.offer ?? "" },
    { path: "cta.urgency", text: script.cta?.urgency ?? "" },
    { path: "body (rendered)", text: renderScriptBody(script) },
  ];

  for (const field of fields) {
    if (!field.text) continue;

    for (const hit of findForbiddenMatches(field.text, claimsForbidden)) {
      violations.push({ path: field.path, text: hit, reason: `forbidden claim: "${hit}"` });
    }
    for (const hit of findAbsoluteMatches(field.text)) {
      violations.push({ path: field.path, text: hit, reason: `absolute/curative claim: "${hit}"` });
    }
    if (field.path !== "body (rendered)") {
      for (const hit of findUnsourcedSocialProof(field.text, sourceText)) {
        violations.push({ path: field.path, text: hit, reason: `unsourced social proof: "${hit}" is not in brand truth / briefing / claimsAllowed` });
      }
    }
    // The rendered body repeats every field above plus structural timing
    // ("[BODY beat 1 …] 3–4.2s"), so numbers are only audited on the spoken /
    // on-screen fields where they would actually be a claim.
    if (sourceText && field.path !== "body (rendered)") {
      for (const nc of extractNumericClaims(field.text)) {
        if (!numberOccursIn(nc.value, sourceText)) {
          violations.push({
            path: field.path,
            text: nc.raw,
            reason: `unsourced numeric claim: "${nc.raw}" does not appear (as the same number) in brand truth / briefing / claimsAllowed / offer text`,
          });
        }
      }
    }
  }

  const ctaText = (script.cta?.text ?? "").trim();
  if (ctaOptions.length && ctaText && !ctaOptions.includes(ctaText)) {
    violations.push({
      path: "cta.text",
      text: ctaText,
      reason: "CTA text is not one of the approved CTA options, verbatim",
    });
  }

  const urgency = (script.cta?.urgency ?? "").trim();
  if (urgency && !URGENCY_SIGNAL_REGEX.test(offerText)) {
    violations.push({
      path: "cta.urgency",
      text: urgency,
      reason: "urgency/deadline stated but the brand's offer text names no deadline",
    });
  }

  return { ok: violations.length === 0, violations };
}
