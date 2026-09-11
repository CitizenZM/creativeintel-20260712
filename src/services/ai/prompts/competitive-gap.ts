export const COMPETITIVE_GAP_PROMPT_VERSION = 1;

export const GAP_CATEGORIES = ["gap", "hook_opportunity", "offer_gap", "format_gap", "cta_gap"] as const;

export type GapCategory = (typeof GAP_CATEGORIES)[number];

export interface GapRollupSummary {
  competitorId: string;
  competitorName: string;
  dominantHooks: unknown;
  dominantFormats: unknown;
  offerLadder: unknown;
  ctaPatterns: unknown;
  cadence: unknown;
  summary: string;
  adCount: number;
}

export interface GapBrandSummary {
  brandName: string;
  brandPromise?: string | null;
  valueProposition?: string | null;
  toneOfVoice?: string | null;
  targetAudience?: string | null;
  pricingTheme?: string | null;
  productFeatures?: string[];
  ctaLanguage?: string[];
  ownHooks: { hookType: string; hookText: string; ctaText?: string | null; offer?: string | null }[];
}

function compact(value: unknown, limit = 900): string {
  if (value === null || value === undefined) return "none";
  try {
    return JSON.stringify(value).slice(0, limit);
  } catch {
    return "none";
  }
}

export function buildCompetitiveGapPrompt(input: {
  brand: GapBrandSummary;
  rollups: GapRollupSummary[];
}) {
  const system = `You are a creative strategy director. You will receive per-competitor creative rollups (built from real ad teardowns) plus our own brand's positioning and the hooks our own ads currently use.

Find what competitors are doing that we are not, and what nobody is doing that we could own. Every insight must name the specific competitor evidence it came from and must be actionable in a next ad — not a market platitude.

category MUST be exactly one of: ${GAP_CATEGORIES.join(" | ")}
- gap: a positioning, message or audience space left open
- hook_opportunity: an opening device competitors rely on (or all miss) that we should use
- offer_gap: promotional structure, pricing framing or guarantee we are missing
- format_gap: duration, aspect ratio, platform or production style we are not covering
- cta_gap: call-to-action wording, placement or destination weakness

Respond with ONLY a JSON object:
{
  "insights": [
    {
      "competitorName": "the competitor this is derived from, or \\"ALL\\" when it comes from the cross-competitor picture",
      "category": "gap|hook_opportunity|offer_gap|format_gap|cta_gap",
      "title": "short, specific (max 70 chars)",
      "description": "2-4 sentences naming the competitor evidence (quote a hook, CTA or offer) and why the opening exists",
      "importance": 1-100,
      "recommendation": "one concrete instruction a creative team can execute in the next ad",
      "evidence": ["verbatim hook / CTA / offer / format observed in the rollups"]
    }
  ]
}

Produce 2-4 insights per competitor plus 2-4 cross-competitor ones. Never repeat the same idea under two categories.`;

  const user = `OUR BRAND: ${input.brand.brandName}
Promise: ${input.brand.brandPromise || "unknown"}
Value proposition: ${input.brand.valueProposition || "unknown"}
Tone: ${input.brand.toneOfVoice || "unknown"}
Audience: ${input.brand.targetAudience || "unknown"}
Pricing theme: ${input.brand.pricingTheme || "unknown"}
Features: ${(input.brand.productFeatures || []).slice(0, 10).join(", ") || "unknown"}
CTAs we use on site: ${(input.brand.ctaLanguage || []).slice(0, 8).join(", ") || "unknown"}
Hooks our own ads use:
${
  input.brand.ownHooks.length > 0
    ? input.brand.ownHooks
        .map((h) => `  - [${h.hookType}] "${h.hookText}"${h.ctaText ? ` → CTA: "${h.ctaText}"` : ""}${h.offer ? ` | Offer: ${h.offer}` : ""}`)
        .join("\n")
    : "  (we have no analysed ads of our own)"
}

COMPETITOR ROLLUPS (${input.rollups.length}):
${input.rollups
  .map(
    (r, i) => `[${i + 1}] ${r.competitorName} — ${r.adCount} ads analysed
  Dominant hooks: ${compact(r.dominantHooks)}
  Dominant formats: ${compact(r.dominantFormats)}
  Offer ladder: ${compact(r.offerLadder)}
  CTA patterns: ${compact(r.ctaPatterns)}
  Cadence: ${compact(r.cadence, 400)}
  Playbook: ${r.summary}`
  )
  .join("\n\n")}

Produce the insights JSON. competitorName must exactly match one of the names above, or be "ALL".`;

  return { system, user };
}
