/**
 * Comparison shots without collages. Image models asked for a "split screen" /
 * "side by side" / "before and after" in ONE image return stacked, garbled
 * collages (the AI director's top finding). Instead the compiler splits such a
 * keyframe into two clean single-subject images — ours (animated as usual) and
 * the other (a still) — and the edit engine stacks them itself with labels.
 */
import { z } from "zod";
import type { CompiledJobDraft } from "./libtv-compile";

const COMPARISON_RE =
  /\b(split[- ]screen|side[- ]by[- ]side|before[- ](and|&|vs\.?)[- ]after|versus|vs\.?\s|comparison|compared (to|with)|next to (an?|the) (old|older|other|competitor|regular|standard))/i;

export function isComparisonPrompt(prompt: string): boolean {
  return COMPARISON_RE.test(prompt);
}

export interface ComparisonSplit {
  ours: string;
  other: string;
  labelOurs: string;
  labelOther: string;
}

const splitSchema = z.object({
  ours: z.string().min(8),
  other: z.string().min(8),
  labelOurs: z.string().min(1).max(24),
  labelOther: z.string().min(1).max(24),
});

export const SPLIT_SYSTEM = `You turn ONE ad keyframe description that asks for a comparison (split screen, side by side, before/after) into TWO separate single-subject photographs that an editor will stack. Return JSON only:
{"ours": "the brand's side as one photograph, ≤ 60 words", "other": "the other side (old way / generic competitor, never a named brand or logo) as one photograph in the same setting and framing, ≤ 60 words", "labelOurs": "≤ 3 words, e.g. the product name", "labelOther": "≤ 3 words, e.g. OTHER TVs / BEFORE"}
Neither description may mention split screens, panels, collages, comparisons or text.`;

/** Deterministic fallback when the model is unavailable. Pure. */
export function fallbackSplit(prompt: string, product: string): ComparisonSplit {
  const base = prompt
    .replace(COMPARISON_RE, "")
    .replace(/\b(left|right|top|bottom)\s+(half|side|panel)[^.,;]*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return {
    ours: `${base.slice(0, 380)} Only the ${product}, shown at its best — one continuous photograph.`,
    other: `The same setting and framing with a generic older unbranded product performing poorly — dull, washed-out, flat. One continuous photograph, no logos.`,
    labelOurs: product.split(/\s+/).slice(0, 3).join(" ").toUpperCase(),
    labelOther: "OTHERS",
  };
}

export async function splitComparison(prompt: string, product: string): Promise<ComparisonSplit> {
  try {
    const { analyzeWithClaude } = await import("@/services/ai/claude-client");
    const r = await analyzeWithClaude({
      systemPrompt: SPLIT_SYSTEM,
      userPrompt: `Product: ${product}\nKeyframe: ${prompt.replace(/\s+/g, " ").slice(0, 1500)}`,
      responseSchema: splitSchema,
      maxTokens: 500,
      tier: "fast",
    });
    return { ...r, labelOurs: r.labelOurs.toUpperCase(), labelOther: r.labelOther.toUpperCase() };
  } catch (err) {
    console.warn("[comparison] split failed, using the fallback:", err instanceof Error ? err.message.slice(0, 160) : err);
    return fallbackSplit(prompt, product);
  }
}

/**
 * Rewrite comparison keyframes in place: K<n> becomes "ours", a new K<n>X job
 * renders "the other", and K<n> carries the pairing for the edit.
 */
export async function splitComparisonDrafts(
  drafts: CompiledJobDraft[],
  opts: { product: string; split?: (prompt: string, product: string) => Promise<ComparisonSplit> }
): Promise<number> {
  const split = opts.split ?? splitComparison;
  const targets = drafts.filter(
    (d) => d.kind === "image" && /^K\d+$/.test(d.nodeName) && !(d.settings as { compositeLocally?: boolean }).compositeLocally && isComparisonPrompt(d.prompt ?? "")
  );
  for (const d of targets) {
    const s = await split(d.prompt, opts.product);
    const otherNode = `${d.nodeName}X`;
    d.prompt = s.ours;
    const directed = (d.settings as { directed?: number }).directed ? { directedKeyframe: s.ours } : {};
    d.settings = { ...(d.settings as Record<string, unknown>), ...directed, comparison: { otherNode, labelOurs: s.labelOurs, labelOther: s.labelOther } };
    drafts.splice(drafts.indexOf(d) + 1, 0, {
      shotIndex: d.shotIndex,
      kind: "image",
      nodeName: otherNode,
      leftRefs: [],
      prompt: s.other,
      modelName: d.modelName,
      settings: { ...(d.settings as Record<string, unknown>), ...(directed.directedKeyframe ? { directedKeyframe: s.other } : {}), comparison: undefined, comparisonOf: (d.settings as { frameNumber?: number }).frameNumber ?? null, frameNumber: null, coversFrames: [] },
      sourceUrl: null,
      creditsEstimated: d.creditsEstimated,
    });
  }
  return targets.length;
}
