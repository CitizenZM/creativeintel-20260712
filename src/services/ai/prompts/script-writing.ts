import { getPlatformPlaybook, getHookFormulas } from "./platform-playbooks";
import { describeTemplate, type ScriptTemplate, type VideoType, VIDEO_TYPES } from "./script-templates";
import { HOW_EXPRESSED_MODES } from "@/lib/script-schema";

export interface TeardownHighlight {
  competitor?: string;
  hookType?: string;
  hookText?: string;
  ctaText?: string;
  offer?: string;
}

export interface DeepAnalysisBlocks {
  sellingPointVisuals?: unknown;
  ctaAnalysis?: unknown;
  competitiveGaps?: unknown;
  videoStructure?: unknown;
  vibeAnalysis?: unknown;
  environmentAnalysis?: unknown;
}

export interface ScriptInput {
  brandName: string;
  productName?: string;
  productDescription?: string;
  /** The archetype this script must follow. Required — there is no untemplated path. */
  template: ScriptTemplate;
  /** Usually the template's own video type; carried explicitly so callers can override. */
  videoType: VideoType;
  angle?: {
    title: string;
    description: string;
    targetEmotion: string;
    narrativeType: string;
    predictedScore?: number;
  };
  sellingPoints: string[];
  campaignGoal?: string;
  platform?: string;
  totalDurationSec?: number;
  selectedEnvironment?: string;
  selectedActorRole?: string;
  selectedActorDesc?: string;
  videoTimeline?: Array<{ segment: string; startSec: number; endSec: number; label: string; description: string }>;
  hookFormulas?: Array<{ type: string; formula: string; openingLine: string; visualDescription: string }>;
  cameraAngles?: Array<{ shot: string; movement: string; whenToUse: string }>;
  environmentNotes?: string;
  audienceSummary?: string;
  briefing?: string;
  /** Campaign platform id from CAMPAIGN_PLATFORMS (tiktok|instagram|youtube|tvc|amazon). */
  platformId?: string;
  /** "What's working in this niche" summary derived from DeepAnalysis.platformInsights. */
  nicheResearch?: string;
  /** Brand truth block from src/services/brand-kit.ts — logo, colours, claims, tone, do-not-show. */
  brandTruth?: string;
  /** Approved CTA copy pool from the Brand Kit. Nothing outside this pool may be written as a CTA. */
  ctaPool?: string[];
  offer?: string;
  landingUrl?: string;
  /** Brand Kit claimsAllowed — the only claims the script may make (paraphrase ok, never stronger). */
  claimsAllowed?: string[];
  /** Brand Kit claimsForbidden — must never appear, even implied. */
  claimsForbidden?: string[];
  /** Previously orphaned DeepAnalysis fields — injected when present. */
  deepAnalysis?: DeepAnalysisBlocks;
  /** Top competitor ad teardowns — hook + CTA evidence, max 5 lines. */
  teardowns?: TeardownHighlight[];
}

const MAX_BLOCK_CHARS = 1200;

function digest(label: string, value: unknown): string {
  if (value == null) return "";
  let text: string;
  if (typeof value === "string") text = value;
  else if (Array.isArray(value)) {
    text = value
      .map((row) =>
        typeof row === "string"
          ? `- ${row}`
          : `- ${Object.entries(row as Record<string, unknown>)
              .filter(([, v]) => v != null && v !== "" && typeof v !== "object")
              .map(([k, v]) => `${k}: ${v}`)
              .join(" | ")}`
      )
      .filter((l) => l.length > 3)
      .join("\n");
  } else {
    text = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v != null && v !== "")
      .map(([k, v]) => `- ${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
      .join("\n");
  }
  text = text.trim();
  if (!text) return "";
  return `\n${label}:\n${text.slice(0, MAX_BLOCK_CHARS)}`;
}

export function buildScriptWritingPrompt(input: ScriptInput) {
  const durationSec = input.totalDurationSec || 30;
  const platform = input.platform || "video";
  const platformId = input.platformId || input.platform;
  const template = input.template;

  const platformPlaybook = getPlatformPlaybook(platformId);
  const platformHookFormulas = getHookFormulas(platformId);
  const hookFormulaNamesBlock = `\nPLATFORM HOOK FORMULAS (hook.hookFormula and every hookVariant must reference one of these NAMES):\n${platformHookFormulas
    .map((h) => `- ${h.name}: ${h.pattern} (When to use: ${h.whenToUse})`)
    .join("\n")}`;

  const templateBlock = describeTemplate(template, durationSec);

  const system = `You are a senior creative director and script writer for ${platform} ads.
Write ONE production-ready video ad script that follows the assigned template exactly and that a director can shoot from without asking a question.

${templateBlock}

${platformPlaybook}
${hookFormulaNamesBlock}

STRUCTURAL RULES (non-negotiable):
- The script has exactly three labelled sections: hook{}, body[] and cta{}.
- EVERY body beat must name ONE selling point (sellingPoint), state HOW that selling point is expressed on screen (howExpressed — one of: ${HOW_EXPRESSED_MODES.join(" / ")}), and specify the shot that carries it (shot: shot size + lens + camera movement).
- A beat that only asserts a benefit in voiceover without a visual mechanism is invalid. If howExpressed is "VO claim + evidence" the beat must still carry the evidence in the proof field.
- Body beats must move through the template's named beats, in order.
- The hook must apply the template's hook style AND the platform playbook's opening-frame requirements, and must name one platform hook formula.
- The CTA must respect the platform playbook's CTA rules and, where an approved CTA pool is supplied, must use copy from that pool verbatim.
- hook.durationSec + every body beat span + cta.durationSec must total exactly ${durationSec} seconds. Body beats are contiguous: beat n's endSec equals beat n+1's startSec.
- Character actions at millimetre precision (not "she smiles" → "left corner of mouth rises 0.5cm, exhale through nose, eyes soften"). Every environment: room type + lighting source + colour temperature + key props.

OUTPUT JSON (no markdown, no extra keys):
{
  "title": "string",
  "angle": "string — the creative angle in one line",
  "format": "short_form|long_form|ugc|testimonial|tvc",
  "duration": "${durationSec}s",
  "platform": "${platform}",
  "videoType": "${input.videoType}",
  "template": "${template.id}",
  "totalDurationSec": ${durationSec},
  "hook": {
    "text": "exact spoken/on-screen hook line",
    "visual": "what the viewer sees in frame 1 — subject, action, framing",
    "shot": "shot size + focal length + camera movement",
    "durationSec": number,
    "hookFormula": "one of the platform hook formula NAMES above"
  },
  "body": [
    {
      "beat": "the template beat this covers",
      "sellingPoint": "ONE selling point, verbatim from the list supplied",
      "howExpressed": "${HOW_EXPRESSED_MODES.join("|")}",
      "shot": "shot size + focal length + camera movement",
      "startSec": number,
      "endSec": number,
      "voiceover": "exact VO text or empty string",
      "textOverlay": "exact on-screen text or empty string",
      "proof": "the concrete evidence shown — number, demo result, review quote, side-by-side"
    }
  ],
  "cta": {
    "text": "exact CTA copy (from the approved pool when one is supplied)",
    "offer": "the offer stated, or empty string",
    "urgency": "deadline / scarcity device, or empty string",
    "visual": "what is on screen during the CTA",
    "shot": "shot size + focal length + camera movement",
    "durationSec": number
  },
  "hookVariants": ["3 alternative hooks — each '[hook-formula-name] opening visual + first spoken word'"],
  "ctaVariants": ["3 alternative CTAs with visual direction, respecting this platform's CTA rules"],
  "narrativeType": "PROBLEM_SOLUTION|TESTIMONIAL|DEMONSTRATION|LIFESTYLE|EDUCATIONAL|COMPARISON|STORY_ARC|UGC_STYLE|TREND_RIDING|BEFORE_AFTER",
  "targetEmotion": "string",
  "predictedScore": number,
  "platformTechniques": ["each playbook technique actually applied, e.g. 'native text overlay in frame 1'"],
  "scenes": [
    {
      "sceneNumber": 1,
      "startSec": 0,
      "endSec": 3,
      "segmentLabel": "HOOK|BODY|CTA",
      "shotType": "Extreme close-up",
      "focalLength": "100mm macro",
      "cameraMovement": "Static, then slow push-in over 3 seconds",
      "aperture": "f/1.8",
      "location": "Modern living room — honed marble floor, morning light",
      "lighting": "5200K natural window light from camera-left, 3:1 ratio",
      "actorAction": "Woman (32yo, South Asian, linen tee) bends to vacuum — does NOT look at camera",
      "productAction": "Brush head engages carpet, dust visibly drawn in",
      "voiceover": "Exact VO text here",
      "textOverlay": "None",
      "transition": "Cut on motion to Scene 2"
    }
  ]
}

"scenes" mirrors hook/body/cta on the same timeline and is what the storyboard and prompt compiler read — it must cover 0s to ${durationSec}s with no gaps.`;

  const brandTruthBlock = input.brandTruth?.trim()
    ? `\nBRAND TRUTH (every frame, claim and CTA must stay inside this — it overrides your instincts):\n${input.brandTruth.trim().slice(0, 2500)}`
    : "";

  const complianceBlock =
    input.claimsAllowed?.length ||
    input.claimsForbidden?.length ||
    input.ctaPool?.length ||
    input.offer
      ? `\nCOMPLIANCE (hard constraints — the script fails legal/brand review if any of these are broken):
- Claims: make ONLY claims drawn from the ALLOWED CLAIMS above. Paraphrasing is fine; making the claim sound stronger, more certain, or more absolute than approved is not.${
          input.claimsForbidden?.length
            ? `\n- Never say, or imply through visual/VO/text-overlay, anything on this FORBIDDEN list: ${input.claimsForbidden.join(" | ")}.`
            : ""
        }
- Never use absolute or curative language anywhere in the script (hook, body, proof, CTA): erase/erases/erased, cure/cures, eliminate/eliminates, permanent/permanently, guaranteed, proven, clinically, "instantly reverses", 100%.
- Never invent an offer, discount, or urgency/deadline device that is not explicitly present in the approved offer text or CTA pool above.${
          input.ctaPool?.length
            ? `\n- cta.text and every ctaVariant must be copied verbatim from the APPROVED CTA POOL above — do not edit, combine, or invent CTA copy.`
            : ""
        }
- cta.urgency must be an empty string unless the approved offer text itself states a deadline — never add urgency on your own initiative.`
      : "";

  const numericClaimsBlock = `\nNUMERIC CLAIMS (hard constraint, applies even when no claims/CTA data is supplied above): any number, percentage, count, "X in Y" / "X out of Y" ratio, review count, or star rating you write anywhere (hook, body, proof, CTA) MUST appear verbatim — or as the exact same number — in BRAND TRUTH, the PROJECT BRIEF, the ALLOWED CLAIMS list, or the approved offer text below. Never invent, round, estimate, or infer a statistic from category knowledge or "common sense" ("most women notice X by 40" is not license to say "84%"). If no sourced stat exists for a beat that calls for one, write a qualitative hook instead (e.g. "Most women over forty notice lip lines first" rather than "Eighty-four percent of women over forty…") and set hook.hookFormula to note "no sourced stat available".`;

  const ctaBlock =
    input.ctaPool?.length || input.offer || input.landingUrl
      ? `\nAPPROVED CTA POOL (cta.text and every ctaVariant must come from this list — do not invent new CTA copy):\n${(input.ctaPool ?? [])
          .map((c, i) => `${i + 1}. ${c}`)
          .join("\n")}${input.offer ? `\nApproved offer: ${input.offer}` : ""}${
          input.landingUrl ? `\nLanding URL: ${input.landingUrl}` : ""
        }`
      : "";

  const deep = input.deepAnalysis ?? {};
  const deepBlocks = [
    digest("SELLING-POINT VISUAL TREATMENTS (use these to fill howExpressed/shot)", deep.sellingPointVisuals),
    digest("CTA ANALYSIS (what CTA patterns work in this category)", deep.ctaAnalysis),
    digest("COMPETITIVE GAPS (say what competitors do not)", deep.competitiveGaps),
    digest("VIDEO STRUCTURE PATTERNS (pacing observed in the category)", deep.videoStructure),
    digest("VIBE / TONE ANALYSIS", deep.vibeAnalysis),
    digest("ENVIRONMENT ANALYSIS (where these ads are shot)", deep.environmentAnalysis),
  ]
    .filter(Boolean)
    .join("\n");

  const teardownBlock = input.teardowns?.length
    ? `\nTOP COMPETITOR AD TEARDOWNS (what actually runs in this category — beat these, do not copy them):\n${input.teardowns
        .slice(0, 5)
        .map(
          (t, i) =>
            `${i + 1}. ${[
              t.competitor && `[${t.competitor}]`,
              t.hookType && `hook(${t.hookType})`,
              t.hookText && `"${t.hookText.slice(0, 120)}"`,
              t.ctaText && `CTA: "${t.ctaText.slice(0, 80)}"`,
              t.offer && `offer: ${t.offer.slice(0, 60)}`,
            ]
              .filter(Boolean)
              .join(" · ")}`
        )
        .join("\n")}`
    : "";

  const hookFormulasBlock = input.hookFormulas?.length
    ? `\nRESEARCHED HOOK FORMULAS (pick ONE for hook.hookFormula):\n${input.hookFormulas
        .map(
          (h, i) =>
            `${i + 1}. [${h.type}] Formula: ${h.formula}\n   Opening line: "${h.openingLine}"\n   Visual: ${h.visualDescription}`
        )
        .join("\n")}`
    : "";

  const cameraAnglesBlock = input.cameraAngles?.length
    ? `\nAPPROVED CAMERA ANGLES (every shot field must draw from these):\n${input.cameraAngles
        .map((c, i) => `${i + 1}. ${c.shot} | Movement: ${c.movement} | Use when: ${c.whenToUse}`)
        .join("\n")}`
    : "";

  const timelineBlock = input.videoTimeline?.length
    ? `\nVIDEO TIMELINE STRUCTURE (reconcile with the template's time budget; template wins on conflict):\n${input.videoTimeline
        .map((t) => `[${t.startSec}s–${t.endSec}s] ${t.segment} — ${t.label}: ${t.description}`)
        .join("\n")}`
    : "";

  const environmentBlock = input.selectedEnvironment
    ? `\nSELECTED ENVIRONMENT: ${input.selectedEnvironment}${
        input.environmentNotes ? `\nEnvironment notes: ${input.environmentNotes}` : ""
      }`
    : "";

  const actorBlock = input.selectedActorRole
    ? `\nSELECTED ACTOR ROLE: ${input.selectedActorRole}${
        input.selectedActorDesc ? `\nActor visual description: ${input.selectedActorDesc}` : ""
      }`
    : "";

  const nicheResearchBlock = input.nicheResearch
    ? `\nWHAT'S WORKING IN THIS NICHE (inform choices, don't copy verbatim):\n${input.nicheResearch.slice(0, 1500)}`
    : "";

  const angleBlock = input.angle
    ? `CREATIVE ANGLE: ${input.angle.title}
Angle Description: ${input.angle.description}
Target Emotion: ${input.angle.targetEmotion}
Narrative Type: ${input.angle.narrativeType}${
        input.angle.predictedScore ? `\nPredicted Score: ${input.angle.predictedScore}` : ""
      }`
    : `CREATIVE ANGLE: derive one from the template "${template.name}" and the top selling points below.`;

  const user = `Write a production-ready ${durationSec}-second ${platform} ad script for "${input.brandName}" using the ${template.name} template (${input.videoType} — ${VIDEO_TYPES[input.videoType].goal}):

PRODUCT: ${input.productName || input.brandName}
${input.productDescription ? `PRODUCT DESCRIPTION: ${input.productDescription}` : ""}

${angleBlock}
Campaign Goal: ${input.campaignGoal || "Conversion"}
${input.audienceSummary ? `\n${input.audienceSummary}` : ""}
${brandTruthBlock}
${complianceBlock}
${numericClaimsBlock}

KEY SELLING POINTS (each body beat must name exactly one of these, verbatim):
${input.sellingPoints.map((p, i) => `${i + 1}. ${p}`).join("\n")}
${ctaBlock}
${deepBlocks}
${teardownBlock}
${environmentBlock}
${actorBlock}
${hookFormulasBlock}
${cameraAnglesBlock}
${timelineBlock}
${nicheResearchBlock}

${input.briefing ? `PROJECT BRIEF:\n${input.briefing.slice(0, 1000)}` : ""}

DELIVERABLE CHECKLIST:
- hook{} honours the template hook style, names a platform hook formula, and fits its share of ${durationSec}s
- body[] covers the template beats in order: ${template.bodyBeats.join(" → ")}
- every body beat has sellingPoint + howExpressed + shot + proof
- cta{} follows: ${template.ctaStyle}${input.ctaPool?.length ? " — using approved CTA copy only" : ""}
- scenes[] covers 0s–${durationSec}s with no gaps, each scene fully specified
- 3 hookVariants and 3 ctaVariants
- platformTechniques[] lists the concrete playbook techniques actually applied`;

  return { system, user };
}
