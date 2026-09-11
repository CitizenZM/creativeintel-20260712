import { getPlatformPlaybook } from "./platform-playbooks";
import { templatesForPlatform, VIDEO_TYPES } from "./script-templates";

export interface AngleInput {
  brandName: string;
  category?: string;
  campaignGoal?: string;
  brandPromise?: string;
  valueProposition?: string;
  topSellingPoints: string[];
  topPatterns: string[];
  topSignals: string[];
  audienceSegments?: string[];
  painPoints?: string[];
  platformPreferences?: string[];
  briefing?: string;
  /** Campaign platform id (tiktok|instagram|youtube|tvc|amazon) — drives a lightweight format-constraint summary. */
  platformId?: string;
}

export function buildAngleGenerationPrompt(input: AngleInput) {
  const platformSummary = input.platformId
    ? `\n\nPLATFORM FORMAT CONSTRAINTS FOR "${input.platformId}" (angles must be viable within these constraints — do not propose angles that require formats the platform can't support, e.g. long story-arcs for a 5s pre-skip window, or external CTAs for Amazon PDP):\n${getPlatformPlaybook(input.platformId)}`
    : "";

  const templates = templatesForPlatform(input.platformId);
  const registryBlock = `\n\nSCRIPT TEMPLATE REGISTRY — every angle must declare a videoType and TWO candidate templateIds drawn from this list (ids only, exactly as written):\nVIDEO TYPES: ${Object.entries(
    VIDEO_TYPES
  )
    .map(([k, v]) => `${k} — ${v.goal}`)
    .join(" | ")}\n${templates
    .map((t) => `- ${t.id} [${t.videoType}] ${t.name} — use when: ${t.whenToUse}`)
    .join("\n")}`;

  const system = `You are an elite creative director at a top advertising agency.
Generate 10 distinct ad angles based on brand intelligence and content analysis.
Each angle should be production-ready and based on proven content patterns.${platformSummary}${registryBlock}

Spread the 10 angles across all three videoTypes — do not return ten PRODUCT_INTRO angles. The two templateIds on an angle must both belong to that angle's videoType and must be the two archetypes that would actually shoot this concept best.

Respond with ONLY a JSON object:
{
  "angles": [
    {
      "id": number,
      "title": "string - short angle name",
      "description": "string - 2-3 sentence description of the ad concept",
      "targetEmotion": "string - primary emotion to evoke",
      "narrativeType": "PROBLEM_SOLUTION|TESTIMONIAL|DEMONSTRATION|LIFESTYLE|EDUCATIONAL|COMPARISON|STORY_ARC|UGC_STYLE|TREND_RIDING|BEFORE_AFTER",
      "videoType": "PRODUCT_INTRO|PROMO_OFFER|AWARENESS_INTEREST",
      "templateIds": ["TEMPLATE_ID_1", "TEMPLATE_ID_2"],
      "predictedScore": number,
      "rationale": "string - why this angle will work based on the data, including why those two templates fit",
      "targetAudience": "string - who this angle speaks to",
      "platform": "string - best platform for this angle"
    }
  ]
}`;

  const user = `Generate 10 ad angles for "${input.brandName}":

Category: ${input.category || "General"}
Campaign Goal: ${input.campaignGoal || "Brand awareness & conversion"}
Brand Promise: ${input.brandPromise || "N/A"}
Value Proposition: ${input.valueProposition || "N/A"}

Top Selling Points:
${input.topSellingPoints.map((p, i) => `${i + 1}. ${p}`).join("\n")}

Top Content Patterns:
${input.topPatterns.map((p, i) => `${i + 1}. ${p}`).join("\n")}

Key Market Signals:
${input.topSignals.map((s, i) => `${i + 1}. ${s}`).join("\n")}
${input.audienceSegments?.length ? `
Target Audience Segments:
${input.audienceSegments.map((s, i) => `${i + 1}. ${s}`).join("\n")}` : ""}
${input.painPoints?.length ? `
Audience Pain Points:
${input.painPoints.map((p, i) => `${i + 1}. ${p}`).join("\n")}` : ""}
${input.platformPreferences?.length ? `
Best Platforms: ${input.platformPreferences.join(", ")}` : ""}
${input.briefing ? `
Project Brief:
${input.briefing.slice(0, 1500)}` : ""}

Generate 10 diverse, data-backed ad angles. Each angle should target a specific audience segment and address a real pain point. Assign each angle to the platform where it will perform best, declare its videoType, and name the two templateIds from the registry that would shoot it best.`;

  return { system, user };
}
