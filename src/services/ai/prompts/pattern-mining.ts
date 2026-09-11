export interface PatternTeardown {
  hookType: string;
  hookVisual: string;
  beats: { startSec?: number; endSec?: number; role?: string; visual?: string; vo?: string }[];
  sellingPoints: string[];
  proofDevices: string[];
  ctaText?: string | null;
  ctaPlacement?: string | null;
  offer?: string | null;
  whyItWorks?: string;
}

export interface ScoredContent {
  title: string;
  narrativeType: string;
  overallScore: number;
  hookText: string;
  keyMessages: string[];
  evidenceLevel?: string;
  owner?: string;
  teardown?: PatternTeardown;
}

export function buildPatternMiningPrompt(
  brandName: string,
  contents: ScoredContent[]
) {
  const system = `You are a creative strategist identifying content patterns and narrative trends.
Analyze the scored content and identify recurring narrative patterns.
Weight content with "evidence: transcript" or "evidence: vision_transcript" more heavily than "evidence: metadata" when judging what patterns actually work — evidenced scores reflect real content, metadata-only scores are conservative guesses.
Items that carry a TEARDOWN block have been decomposed beat by beat from real frames and transcript. Ground your patterns, selling points and best practices in those beats, hooks, proof devices and CTAs — quote them — rather than inferring from titles.
Respond with ONLY a JSON object:
{
  "patterns": [
    {
      "type": "PROBLEM_SOLUTION|TESTIMONIAL|DEMONSTRATION|LIFESTYLE|EDUCATIONAL|COMPARISON|STORY_ARC|UGC_STYLE|TREND_RIDING|BEFORE_AFTER",
      "name": "string - human-readable pattern name",
      "description": "string - what this pattern involves",
      "frequency": number,
      "avgPerformance": number,
      "bestPractices": ["array of tips for using this pattern effectively"]
    }
  ],
  "sellingPoints": [
    {
      "point": "string - the selling point",
      "category": "feature|benefit|emotional|social_proof|urgency",
      "strength": number,
      "frequency": number,
      "uniqueness": number
    }
  ],
  "topSignals": ["array of 5-8 key market signals or trends observed"]
}`;

  const user = `Analyze content patterns for "${brandName}":

Scored Content:
${contents
  .map((c, i) => {
    const t = c.teardown;
    const teardownBlock = t
      ? `
  TEARDOWN — hook type: ${t.hookType} | hook visual: ${t.hookVisual}
    Beats: ${t.beats
      .slice(0, 8)
      .map((b) => `${b.startSec ?? 0}-${b.endSec ?? 0}s [${b.role || "?"}] ${b.visual || ""}`)
      .join(" · ")}
    Selling points in-ad: ${t.sellingPoints.join(" | ") || "none"}
    Proof devices: ${t.proofDevices.join(" | ") || "none"}
    CTA: ${t.ctaText ? `"${t.ctaText}"` : "none"}${t.ctaPlacement ? ` (${t.ctaPlacement})` : ""}${t.offer ? ` | Offer: ${t.offer}` : ""}${t.whyItWorks ? `\n    Why it works: ${t.whyItWorks}` : ""}`
      : "";
    return `[${i + 1}] "${c.title}"${c.owner ? ` — ${c.owner}` : ""}
  Type: ${c.narrativeType} | Score: ${c.overallScore} | Evidence: ${c.evidenceLevel || "metadata"}
  Hook: ${c.hookText}
  Messages: ${c.keyMessages.join(", ")}${teardownBlock}`;
  })
  .join("\n\n")}

Identify:
1. Which narrative patterns appear most and perform best
2. Recurring selling points and claims
3. Key market signals and trends`;

  return { system, user };
}
