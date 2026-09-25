/**
 * Pure helpers for the Setup-page suggestion flow (product definition +
 * campaign context). Kept side-effect free and framework-free so they're
 * cheap to unit test; the route that calls the AI and writes Prisma lives at
 * src/app/api/projects/[projectId]/setup-suggest/route.ts.
 */
import { z } from "zod";
import { GOAL_TYPES, type GoalType } from "@/lib/style-categories";
import type { FieldStatusMap } from "@/lib/field-status";

/** Marks written into Project.fieldStatus once the guard is done. */
export const SUGGESTED_AT_KEY = "__suggestedAt";

/** Prefix used for CampaignSelection fields stored in Project.fieldStatus. */
export const CAMPAIGN_PREFIX = "campaign.";

export function campaignFieldKey(field: string): string {
  return `${CAMPAIGN_PREFIX}${field}`;
}

/** Input shape the suggestion logic needs from the DB — trimmed to what's used. */
export interface SetupSuggestInput {
  project: {
    brandName: string | null;
    category: string | null;
    productName: string | null;
    productPageTitle: string | null;
    productPageText: string | null;
    brandUrl: string | null;
    briefingText: string | null;
    campaignGoal: string | null;
    goalType: string | null;
  };
  brand: {
    productCategory: string | null;
    productDescription: string | null;
    targetAudience: string | null;
  } | null;
  campaignSelection: {
    platform: string | null;
    selectedEnvironment: string | null;
    selectedActorRole: string | null;
  } | null;
}

/** What the model is asked to produce — every field optional; empty means "no suggestion". */
export const AISuggestionSchema = z.object({
  campaignGoal: z.string().trim().max(280).optional().nullable(),
  goalType: z.enum(GOAL_TYPES).optional().nullable(),
  platform: z.enum(["tiktok", "instagram", "youtube", "tvc", "amazon"]).optional().nullable(),
  targetAudience: z.string().trim().max(280).optional().nullable(),
});
export type AISuggestion = z.infer<typeof AISuggestionSchema>;

/** Fields this endpoint is allowed to fill, and where each one lives. */
export type SuggestableField =
  | "campaignGoal"
  | "goalType"
  | "campaign.platform";

/** True when the field is empty and therefore eligible to receive a suggestion. Never overwrites a value. */
export function isEmptyField(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  return false;
}

/**
 * Deterministic fallback used when nothing empty needs the AI, or as a floor
 * under the AI's answer: goalType defaults to "hybrid" unless the brief signals
 * clearly one way, matching the product owner's spec.
 */
export function inferGoalTypeFromText(text: string | null | undefined): GoalType {
  const t = (text || "").toLowerCase();
  const awarenessHit = /\b(awareness|brand story|storytelling|memorable|top.of.funnel|tof\b)\b/.test(t);
  const salesHit = /\b(sales|conversion|purchase|buy now|discount|promo|roas|cpa|direct response)\b/.test(t);
  if (awarenessHit && !salesHit) return "storytelling";
  if (salesHit && !awarenessHit) return "conversion";
  return "hybrid";
}

/** Builds the prompt text fed to analyzeWithClaude for setup suggestions. */
export function buildSetupSuggestPrompt(input: SetupSuggestInput): { systemPrompt: string; userPrompt: string } {
  const { project, brand, campaignSelection } = input;
  const systemPrompt =
    "You help fill in a blank ad-campaign setup form with a reasonable best guess. " +
    "Only suggest a value when you have a genuine signal from the provided context — otherwise return null for that field. " +
    "Respond with JSON only, matching the schema.";

  const lines = [
    `Brand: ${project.brandName || "unknown"}`,
    project.category ? `Category: ${project.category}` : null,
    brand?.productCategory ? `Product category: ${brand.productCategory}` : null,
    project.productName || project.productPageTitle ? `Product: ${project.productName || project.productPageTitle}` : null,
    brand?.productDescription || project.productPageText
      ? `Product description: ${(brand?.productDescription || project.productPageText || "").slice(0, 600)}`
      : null,
    project.brandUrl ? `Brand URL: ${project.brandUrl}` : null,
    project.briefingText ? `Brief: ${project.briefingText.slice(0, 1200)}` : null,
    brand?.targetAudience ? `Known audience: ${brand.targetAudience}` : null,
    campaignSelection?.platform ? `Platform already set: ${campaignSelection.platform}` : null,
  ].filter(Boolean);

  const userPrompt =
    `Given this project context, suggest:\n` +
    `- campaignGoal: one sentence describing what this campaign should achieve\n` +
    `- goalType: "storytelling" (awareness/brand), "conversion" (direct response/sales), or "hybrid" — default to hybrid unless the brief clearly leans one way\n` +
    `- platform: the best-fit ad platform for this brief (tiktok, instagram, youtube, tvc, or amazon)\n` +
    `- targetAudience: one sentence describing the likely target audience\n\n` +
    `Context:\n${lines.join("\n")}`;

  return { systemPrompt, userPrompt };
}

/**
 * Merges an AI suggestion into project-level update data + fieldStatus marks,
 * filling only fields that are currently empty. Never touches a field that
 * already has a value (suggested or confirmed) — the caller passes in only
 * the current values of fields it's allowed to fill.
 */
export function applySuggestions(
  current: { campaignGoal: string | null; goalType: string | null },
  suggestion: AISuggestion
): { projectData: Record<string, unknown>; statusPatch: FieldStatusMap } {
  const projectData: Record<string, unknown> = {};
  const statusPatch: FieldStatusMap = {};

  if (isEmptyField(current.campaignGoal) && suggestion.campaignGoal && !isEmptyField(suggestion.campaignGoal)) {
    projectData.campaignGoal = suggestion.campaignGoal;
    statusPatch.campaignGoal = "suggested";
  }
  if (isEmptyField(current.goalType) && suggestion.goalType) {
    projectData.goalType = suggestion.goalType;
    statusPatch.goalType = "suggested";
  }

  return { projectData, statusPatch };
}
