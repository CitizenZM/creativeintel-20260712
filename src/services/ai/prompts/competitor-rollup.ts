export const COMPETITOR_ROLLUP_PROMPT_VERSION = 1;

export interface RollupTeardown {
  assetId: string;
  title: string;
  rank?: number | null;
  platform?: string | null;
  format?: string | null;
  durationSec?: number | null;
  viewCount?: number | null;
  publishedAt?: Date | null;
  hookType: string;
  hookText: string;
  hookVisual: string;
  beats: { startSec?: number; endSec?: number; role?: string; visual?: string; vo?: string }[];
  sellingPoints: { point?: string }[];
  proofDevices: { type?: string; description?: string }[];
  ctaText?: string | null;
  ctaPlacement?: string | null;
  offer?: string | null;
  landingUrl?: string | null;
  whyItWorks: string;
  evidenceLevel: string;
}

export interface CompetitorRollupInput {
  competitorName: string;
  competitorUrl?: string | null;
  teardowns: RollupTeardown[];
}

export function buildCompetitorRollupPrompt(input: CompetitorRollupInput) {
  const system = `You are a competitive creative analyst. You will receive the full structured teardowns of ONE competitor's top-performing ads. Summarise that competitor's creative system — what they repeatedly do, not what any single ad does.

Every claim must be traceable to the teardowns supplied. Do not import outside knowledge about this company. When only one or two ads are supplied, say so in "summary" and keep the pattern claims tentative.

Respond with ONLY a JSON object:
{
  "dominantHooks": [
    { "hookType": "hook type as it appears in the teardowns", "count": number, "example": "verbatim hookText from one of the ads", "whyItLands": "1 sentence" }
  ],
  "dominantFormats": [
    { "format": "e.g. 9:16 UGC talking head, 16:9 studio demo, split-screen comparison", "count": number, "typicalDurationSec": number, "notes": "1 sentence" }
  ],
  "offerLadder": [
    { "offer": "the offer as stated", "frequency": number, "placement": "where in the ad it appears", "aggressiveness": "hard|soft|none" }
  ],
  "ctaPatterns": [
    { "ctaText": "verbatim CTA", "placement": "end_card|mid_roll|persistent_overlay|none", "frequency": number, "destination": "landing URL or 'unknown'" }
  ],
  "cadence": {
    "avgDurationSec": number,
    "hookWindowSec": number,
    "productRevealSec": number,
    "ctaStartPct": number,
    "beatsPerAd": number,
    "notes": "how their ads are paced — 1-2 sentences"
  },
  "summary": "5-8 sentences: this competitor's creative playbook — who they talk to, what they promise, how they open, how they prove it, how they close, and what they consistently avoid."
}

Order every array most-frequent first. Counts must match what you actually observe in the teardowns.`;

  const user = `COMPETITOR: ${input.competitorName}${input.competitorUrl ? ` (${input.competitorUrl})` : ""}
TEARDOWNS SUPPLIED: ${input.teardowns.length}

${input.teardowns
  .map((t, i) => {
    const beats = t.beats
      .slice(0, 10)
      .map((b) => `    ${b.startSec ?? 0}s-${b.endSec ?? 0}s [${b.role || "?"}] ${b.visual || ""}${b.vo ? ` | VO: "${b.vo}"` : ""}`)
      .join("\n");
    return `[${i + 1}] "${t.title}"${t.rank ? ` (rank #${t.rank})` : ""}
  Platform: ${t.platform || "unknown"} | Format: ${t.format || "unknown"} | Duration: ${t.durationSec ? `${Math.round(t.durationSec)}s` : "unknown"} | Views: ${t.viewCount?.toLocaleString() || "unknown"}${t.publishedAt ? ` | Published: ${t.publishedAt.toISOString().slice(0, 10)}` : ""}
  Evidence: ${t.evidenceLevel}
  Hook (${t.hookType}): "${t.hookText}" — visual: ${t.hookVisual}
  Beats:
${beats}
  Selling points: ${t.sellingPoints.map((s) => s.point).filter(Boolean).join(" | ") || "none recorded"}
  Proof devices: ${t.proofDevices.map((p) => `${p.type}: ${p.description}`).filter(Boolean).join(" | ") || "none recorded"}
  CTA: ${t.ctaText ? `"${t.ctaText}"` : "none"} (${t.ctaPlacement || "n/a"})${t.offer ? ` | Offer: ${t.offer}` : ""}${t.landingUrl ? ` | Landing: ${t.landingUrl}` : ""}
  Why it works: ${t.whyItWorks}`;
  })
  .join("\n\n")}

Produce the rollup JSON for ${input.competitorName}.`;

  return { system, user };
}
