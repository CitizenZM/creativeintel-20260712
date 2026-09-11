import type { CrawlResult } from "@/services/research/website-crawler";

export interface CompetitorAdEvidence {
  title: string;
  hookType?: string;
  hookText?: string;
  ctaText?: string | null;
  offer?: string | null;
}

export function buildCompetitorIntelPrompt(
  brandName: string,
  brandCrawl: CrawlResult | null,
  competitorName: string,
  competitorCrawl: CrawlResult,
  adEvidence?: CompetitorAdEvidence[]
) {
  const system = `You are a competitive intelligence analyst.
You will receive TWO companies' websites. Analyze ONLY the competitor (the second one), then compare against the brand.

CRITICAL: All "brandPromise", "valueProposition", "toneOfVoice", "pricingTheme", "productFeatures", "ctaLanguage", "socialProof" fields MUST describe THE COMPETITOR — not the brand. Read the competitor's website data only when filling those fields.

Respond with ONLY a JSON object:
{
  "brandPromise": "the COMPETITOR's promise (1 sentence, derived from competitor headings/copy)",
  "valueProposition": "the COMPETITOR's value prop (1-2 sentences, derived from competitor copy)",
  "toneOfVoice": "the COMPETITOR's tone (e.g. 'authoritative fintech', 'friendly + casual')",
  "pricingTheme": "the COMPETITOR's pricing approach (e.g. 'subscription $X/mo', 'free + premium', 'per-transaction')",
  "productFeatures": ["features named on the COMPETITOR's site"],
  "ctaLanguage": ["CTA buttons on the COMPETITOR's site"],
  "socialProof": ["testimonials/stats on the COMPETITOR's site"],
  "strengths": ["competitor strengths vs the brand"],
  "weaknesses": ["competitor weaknesses vs the brand"],
  "opportunities": ["opportunities for the brand based on competitor gaps"]
}

If the competitor crawl is sparse or seems to be the wrong domain, set fields to short honest descriptions like "insufficient data" — do NOT copy the brand's data.`;

  const brandSection = brandCrawl
    ? `Brand "${brandName}" Website:
Title: ${brandCrawl.title}
Description: ${brandCrawl.metaDescription}
Headings: ${brandCrawl.headings.slice(0, 10).join(", ")}
CTAs: ${brandCrawl.ctaTexts.join(", ")}
Features: ${brandCrawl.productFeatures.slice(0, 10).join(", ")}
Content: ${brandCrawl.bodyText.slice(0, 1000)}`
    : `Brand "${brandName}" (no website data available)`;

  const user = `BRAND (for context only — do NOT copy these into competitor fields):
${brandSection}

===================================
COMPETITOR (the subject of the analysis): "${competitorName}"
Website URL: ${competitorCrawl.url}
Title: ${competitorCrawl.title}
Description: ${competitorCrawl.metaDescription}
Headings: ${competitorCrawl.headings.slice(0, 10).join(", ")}
CTAs: ${competitorCrawl.ctaTexts.join(", ")}
Features: ${competitorCrawl.productFeatures.slice(0, 10).join(", ")}
Content: ${competitorCrawl.bodyText.slice(0, 1500)}
${
  adEvidence?.length
    ? `\nTHEIR ACTUAL ADS (torn down from real creative — weight these above website copy):\n${adEvidence
        .map(
          (a, i) =>
            `  [${i + 1}] "${a.title}" — hook (${a.hookType || "?"}): "${a.hookText || ""}"${a.ctaText ? ` | CTA: "${a.ctaText}"` : ""}${a.offer ? ` | Offer: ${a.offer}` : ""}`
        )
        .join("\n")}\n`
    : ""
}===================================

Fill the JSON with data about "${competitorName}" ONLY (using its own website above). The "strengths"/"weaknesses"/"opportunities" arrays compare the competitor against "${brandName}".`;

  return { system, user };
}
