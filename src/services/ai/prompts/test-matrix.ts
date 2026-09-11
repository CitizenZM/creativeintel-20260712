import { VIDEO_TYPES, type ScriptTemplate } from "./script-templates";

export interface TestMatrixInput {
  brandName: string;
  hooks: string[];
  narrativeTypes: string[];
  ctas: string[];
  /** The template registry slice the matrix may draw from — replaces hardcoded formats. */
  templates: ScriptTemplate[];
  platformId?: string;
  totalDurationSec?: number;
}

export function buildTestMatrixPrompt(input: TestMatrixInput) {
  const dur = input.totalDurationSec || 30;
  const templateBlock = input.templates
    .map(
      (t) =>
        `- ${t.id} [${t.videoType}] ${t.name} — beats ${t.beats.hookPct}/${t.beats.bodyPct}/${t.beats.ctaPct} — use when: ${t.whenToUse}`
    )
    .join("\n");

  const system = `You are a performance marketing strategist creating a creative test matrix.

The matrix is a cross of SCRIPT TEMPLATE × VIDEO TYPE × HOOK × CTA. Templates and video types come from the registry below — never invent a template id, a video type, or an abstract "format" like "static" or "carousel".

VIDEO TYPES:
${Object.entries(VIDEO_TYPES)
  .map(([k, v]) => `- ${k}: ${v.goal}`)
  .join("\n")}

SCRIPT TEMPLATES AVAILABLE${input.platformId ? ` FOR ${input.platformId.toUpperCase()}` : ""}:
${templateBlock}

Generate the top 20 most promising variants. Cover all three video types and at least 8 distinct templates — a matrix that tests one archetype twenty ways tests nothing.

Respond with ONLY a JSON object:
{
  "variants": [
    {
      "hookVariant": "string",
      "narrativeType": "PROBLEM_SOLUTION|TESTIMONIAL|DEMONSTRATION|LIFESTYLE|EDUCATIONAL|COMPARISON|STORY_ARC|UGC_STYLE|TREND_RIDING|BEFORE_AFTER",
      "ctaVariant": "string",
      "templateId": "an id from the registry above, exactly as written",
      "videoType": "PRODUCT_INTRO|PROMO_OFFER|AWARENESS_INTEREST — must match the template's video type",
      "predictedScore": number,
      "rationale": "string - why this template + hook + CTA combination should work",
      "scriptOutline": "string - brief 2-sentence script concept following that template's beats"
    }
  ]
}

Score criteria (0-100):
- Predicted engagement from the hook × template fit
- Conversion likelihood from the CTA × video type fit
- Platform suitability
Present scores as AI PREDICTIONS, not guarantees.`;

  const user = `Create a ${dur}-second creative test matrix for "${input.brandName}"${
    input.platformId ? ` on ${input.platformId}` : ""
  }:

Available Hooks:
${input.hooks.map((h, i) => `${i + 1}. ${h}`).join("\n")}

Narrative Types:
${input.narrativeTypes.join(", ")}

CTA Options:
${input.ctas.map((c, i) => `${i + 1}. ${c}`).join("\n")}

Eligible templates (id [videoType]):
${input.templates.map((t) => `${t.id} [${t.videoType}]`).join(", ")}

Generate the top 20 combinations with predictive scores and rationale, spread across all three video types and at least 8 distinct templates.`;

  return { system, user };
}
