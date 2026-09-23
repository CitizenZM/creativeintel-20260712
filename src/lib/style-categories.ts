/**
 * Creative goal and ad-style taxonomy.
 *
 * Two levels: the project's goal type (why the ad exists) and style categories
 * (how it tells the story). Style categories group the analysis pipeline's
 * NarrativeType values, so every mined pattern and every scored ad already
 * belongs to one. Funnel stage (VIDEO_TYPES in script-templates) stays a
 * separate axis.
 */

export const GOAL_TYPES = ["storytelling", "conversion", "hybrid"] as const;
export type GoalType = (typeof GOAL_TYPES)[number];

export const GOAL_TYPE_INFO: Record<GoalType, { label: string; description: string }> = {
  storytelling: {
    label: "Storytelling / brand",
    description: "Build memory and affinity. Favors ads people watch through and share.",
  },
  conversion: {
    label: "Conversion / direct response",
    description: "Drive the click or purchase now. Favors long-running paid ads with a clear offer.",
  },
  hybrid: {
    label: "Hybrid",
    description: "A story that still closes with an offer. Balances both signals.",
  },
};

export function isGoalType(value: unknown): value is GoalType {
  return typeof value === "string" && (GOAL_TYPES as readonly string[]).includes(value);
}

export interface StyleCategory {
  id: string;
  label: string;
  /** Which goal this style naturally serves; "either" fits both. */
  axis: "storytelling" | "conversion" | "either";
  description: string;
  narrativeTypes: string[];
}

export const STYLE_CATEGORIES: StyleCategory[] = [
  {
    id: "brand_story",
    label: "Brand story",
    axis: "storytelling",
    description: "A character, a moment, an arc — the product is part of a life, not the headline.",
    narrativeTypes: ["STORY_ARC", "LIFESTYLE", "TREND_RIDING"],
  },
  {
    id: "direct_response",
    label: "Direct response",
    axis: "conversion",
    description: "Name the problem, show the fix, prove it, ask for the sale.",
    narrativeTypes: ["PROBLEM_SOLUTION", "BEFORE_AFTER", "COMPARISON"],
  },
  {
    id: "ugc_creator",
    label: "UGC / creator",
    axis: "either",
    description: "Filmed like a real customer or creator on their phone.",
    narrativeTypes: ["UGC_STYLE"],
  },
  {
    id: "demo_explainer",
    label: "Demo & explainer",
    axis: "conversion",
    description: "Show exactly how it works and why that matters.",
    narrativeTypes: ["DEMONSTRATION", "EDUCATIONAL"],
  },
  {
    id: "social_proof",
    label: "Social proof",
    axis: "either",
    description: "Reviews, testimonials and results from people like the viewer.",
    narrativeTypes: ["TESTIMONIAL"],
  },
];

const BY_ID = new Map(STYLE_CATEGORIES.map((c) => [c.id, c]));

export function getStyleCategory(id: string): StyleCategory | undefined {
  return BY_ID.get(id);
}

export function styleCategoryForNarrative(type: string | null | undefined): StyleCategory | undefined {
  return type ? STYLE_CATEGORIES.find((c) => c.narrativeTypes.includes(type)) : undefined;
}

/** Keep only known category ids, in taxonomy order, at most `max`. */
export function sanitizeStyleCategories(value: unknown, max = 3): string[] {
  if (!Array.isArray(value)) return [];
  const wanted = new Set(value.filter((v): v is string => typeof v === "string"));
  return STYLE_CATEGORIES.filter((c) => wanted.has(c.id))
    .slice(0, max)
    .map((c) => c.id);
}

export function isRecommendedFor(category: StyleCategory, goal: GoalType | null | undefined): boolean {
  if (!goal || goal === "hybrid") return true;
  return category.axis === goal || category.axis === "either";
}

/** One line for prompts: goal + chosen styles and the narrative forms they cover. */
export function creativeDirectionLine(goal: string | null | undefined, styleIds: unknown): string {
  const parts: string[] = [];
  if (isGoalType(goal)) parts.push(`Creative goal: ${GOAL_TYPE_INFO[goal].label} — ${GOAL_TYPE_INFO[goal].description}`);
  const styles = sanitizeStyleCategories(styleIds).map((id) => BY_ID.get(id)!);
  if (styles.length) {
    parts.push(
      `Required ad styles (write only in these): ${styles
        .map((s) => `${s.label} [${s.narrativeTypes.join("/")}] — ${s.description}`)
        .join("; ")}`
    );
  }
  return parts.join("\n");
}

/** Narrative types covered by the chosen styles (empty = no restriction). */
export function narrativeTypesFor(styleIds: unknown): string[] {
  return sanitizeStyleCategories(styleIds).flatMap((id) => BY_ID.get(id)!.narrativeTypes);
}
