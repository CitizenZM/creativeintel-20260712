export interface DeepAnalysisTeardown {
  hookType: string;
  hookVisual: string;
  beats: { startSec?: number; endSec?: number; role?: string; visual?: string; vo?: string; onScreenText?: string }[];
  sellingPoints: string[];
  proofDevices: string[];
  ctaText?: string | null;
  ctaPlacement?: string | null;
  offer?: string | null;
  whyItWorks?: string;
  evidenceLevel?: string;
}

export interface DeepAnalysisInput {
  brandName: string;
  category?: string;
  productDescription?: string;
  productName?: string;
  campaignGoal?: string;
  platform?: string;
  targetDurationSec?: number;
  selectedEnvironment?: string;
  selectedActorRole?: string;
  selectedSellingPoints?: string[];
  audienceSummary?: string;
  topContent: {
    title: string;
    platform: string;
    narrativeType: string;
    overallScore: number;
    hookStrength: number;
    ctaQuality: number;
    emotionalAppeal: number;
    pacing: number;
    storytellingArc: number;
    hookText: string;
    keyMessages: string[];
    viewCount: number;
    contentCategory?: string | null;
    thumbnailUrl?: string;
    url?: string;
    owner?: string;
    teardown?: DeepAnalysisTeardown;
  }[];
  competitorSummaries?: { name: string; summary: string }[];
}

export function buildDeepAnalysisPrompt(input: DeepAnalysisInput) {
  const system = `You are a senior advertising creative director and cinematographer analyzing video ads for ${input.brandName}.

Your job: produce a deep multi-dimensional analysis that a creative team can use to produce better video ads.
Analyze the content provided and identify patterns across FIVE dimensions:
(1) Selling points — what product benefits appear and how effectively
(2) Environments — where the product is shown and how settings are used
(3) Camera angles & movements — cinematography patterns
(4) Hook formulas — how the first 3 seconds are constructed
(5) Platform-specific behaviors — what works where

Output ONLY valid JSON with ALL these keys:

{
  "videoStructure": {
    "openingPatterns": [{"pattern": "string", "frequency": number, "effectiveness": "high|medium|low", "example": "string"}],
    "hookDurationRange": "string",
    "productRevealTiming": "string",
    "averageLength": "string",
    "structuralInsights": ["string"]
  },
  "vibeAnalysis": {
    "dominantTones": [{"tone": "string", "frequency": number, "avgScore": number, "example": "string"}],
    "emotionalTriggers": [{"trigger": "string", "usage": "string", "examples": ["string"]}],
    "visualStyleNotes": "string",
    "pacingProfile": "string",
    "vibeInsights": ["string"]
  },
  "ctaAnalysis": {
    "commonCTAs": [{"cta": "string", "frequency": number, "type": "direct|soft|urgency|informational", "effectiveness": "high|medium|low"}],
    "placement": "string",
    "urgencyLevel": "high|medium|low",
    "conversionDrivers": ["string"],
    "ctaInsights": ["string"]
  },
  "sellingPointDeep": {
    "topPerformers": [{"point": "string", "whyItWorks": "string", "bestPlatforms": ["string"], "exampleContent": "string"}],
    "underutilized": [{"point": "string", "opportunity": "string"}],
    "messagingInsights": ["string"]
  },
  "competitiveGaps": [{"gap": "string", "recommendation": "string", "priority": "high|medium|low"}],
  "recommendations": [{"title": "string", "description": "string", "impact": "high|medium|low", "effort": "high|medium|low", "category": "string"}],
  "environmentAnalysis": [
    {
      "environment": "Environment name, e.g. 'Modern Kitchen', 'Living Room with Pets', 'Outdoor Garden'",
      "frequency": number,
      "description": "How this environment is used in ads — lighting, props, mood",
      "lightingNotes": "e.g. 'Natural morning light through large windows, warm 5200K'",
      "bestFor": "Which selling points this environment supports",
      "examples": ["content title or quote"]
    }
  ],
  "cameraAngles": [
    {
      "shot": "Shot name, e.g. 'Extreme close-up product reveal', 'Over-shoulder user POV', 'Low angle hero shot'",
      "movement": "Camera movement, e.g. 'Slow dolly push-in', 'Static locked off', 'Handheld UGC drift'",
      "frequency": number,
      "whenToUse": "Which moment in the ad — hook, product demo, CTA",
      "adEffect": "What emotional or perceptual effect this creates",
      "apertureSuggestion": "e.g. 'f/1.8 for shallow bokeh' or 'f/8 for sharp product detail'",
      "examples": ["content title"]
    }
  ],
  "hookFormulas": [
    {
      "type": "Hook type, e.g. 'Problem-Agitate', 'Curiosity Gap', 'Before-After Reveal', 'Social Proof Shock', 'Macro Product Reveal'",
      "formula": "Step-by-step formula, e.g. 'Show problem → pause 0.5s → show product solving it'",
      "openingLine": "Example first line of VO or on-screen text",
      "visualDescription": "What the first 3 seconds look like visually",
      "why": "Why this hook stops scrolling for this product/audience",
      "platformFit": ["youtube", "tiktok", "instagram"],
      "scoreImpact": "high|medium|low",
      "examples": ["content title"]
    }
  ],
  "platformInsights": [
    {
      "platform": "youtube|tiktok|instagram|facebook",
      "contentStyle": "Description of what works on this platform for this brand",
      "topFormats": ["format names"],
      "avgEngagement": "e.g. '4.2% avg engagement rate on top content'",
      "bestPractices": ["actionable tip"],
      "avoidPatterns": ["what NOT to do on this platform"]
    }
  ],
  "sellingPointVisuals": [
    {
      "point": "The selling point, e.g. 'Anti-Hair Wrap technology'",
      "visualTreatment": "How to show it visually, e.g. 'Slow-motion macro of brush roll separating hair'",
      "screenTime": "e.g. '3-5 seconds in mid-section'",
      "placement": "Where in the ad — hook, body, pre-CTA",
      "cameraRecommendation": "Specific shot for this point",
      "examples": ["content title"]
    }
  ],
  "videoTimeline": {
    "recommendedDurationSec": MATCH_THE_TARGET_DURATION_EXACTLY,
    "platform": "tiktok|instagram|youtube|tvc",
    "segments": [
      {
        "segment": "Hook",
        "startSec": 0,
        "endSec": 5,
        "label": "Scroll-Stopping Hook",
        "description": "What happens visually in this segment",
        "cameraNote": "Camera type and movement for this segment",
        "voiceover": "VO or text overlay for this segment",
        "purpose": "Why this timing works"
      }
    ],
    "rationale": "Why this timing structure works for the platform and goal"
  }
}`;

  const durationNote = input.targetDurationSec
    ? `\nVIDEO TARGET: ${input.targetDurationSec}s ${input.platform || "TikTok"} video — videoTimeline.recommendedDurationSec MUST equal ${input.targetDurationSec}, segments must sum to exactly ${input.targetDurationSec}s`
    : "";

  const user = `Deep creative analysis for "${input.brandName}"${input.category ? ` (${input.category})` : ""}${input.productDescription ? `\nProduct: ${input.productDescription.slice(0, 200)}` : ""}${input.productName ? `\nSPECIFIC PRODUCT: ${input.productName}` : ""}${input.campaignGoal ? `\nCAMPAIGN GOAL: ${input.campaignGoal}` : ""}${durationNote}${input.selectedEnvironment ? `\nSELECTED ENVIRONMENT: ${input.selectedEnvironment}` : ""}${input.selectedActorRole ? `\nSELECTED ACTOR ROLE: ${input.selectedActorRole}` : ""}${input.selectedSellingPoints?.length ? `\nPRIORITY SELLING POINTS:\n${input.selectedSellingPoints.map((p, i) => `${i + 1}. ${p}`).join("\n")}` : ""}${input.audienceSummary ? `\nAUDIENCE: ${input.audienceSummary}` : ""}:

SCORED AD CONTENT (${input.topContent.length} pieces):
${input.topContent.map((c, i) => {
    const t = c.teardown;
    const teardownBlock = t
      ? `
  TEARDOWN (evidence: ${t.evidenceLevel || "unknown"}) — hook type: ${t.hookType}
    Hook visual: ${t.hookVisual}
    Beats: ${t.beats
      .slice(0, 10)
      .map((b) => `${b.startSec ?? 0}-${b.endSec ?? 0}s [${b.role || "?"}] ${b.visual || ""}${b.onScreenText ? ` | text: "${b.onScreenText}"` : ""}`)
      .join("\n           ")}
    Selling points shown: ${t.sellingPoints.join(" | ") || "none"}
    Proof devices: ${t.proofDevices.join(" | ") || "none"}
    CTA: ${t.ctaText ? `"${t.ctaText}"` : "none"}${t.ctaPlacement ? ` (${t.ctaPlacement})` : ""}${t.offer ? ` | Offer: ${t.offer}` : ""}${t.whyItWorks ? `\n    Why it works: ${t.whyItWorks}` : ""}`
      : "";
    return `[${i + 1}] "${c.title}"${c.owner ? ` — ${c.owner}` : ""} | ${c.platform} | Score:${c.overallScore} | Views:${c.viewCount.toLocaleString()}
  Hook:${c.hookStrength} CTA:${c.ctaQuality} Emotion:${c.emotionalAppeal} Pacing:${c.pacing} Story:${c.storytellingArc}
  Narrative: ${c.narrativeType} | Category: ${c.contentCategory || "N/A"}
  Hook text: "${c.hookText}"
  Key messages: ${c.keyMessages.slice(0, 4).join(" | ")}${teardownBlock}`;
  }).join("\n")}
${
  input.competitorSummaries?.length
    ? `\nCOMPETITOR PLAYBOOKS:\n${input.competitorSummaries.map((c) => `- ${c.name}: ${c.summary}`).join("\n")}\n`
    : ""
}
Produce comprehensive analysis across ALL required dimensions. Be specific — name actual shots, environments, hook formulas.
Where a TEARDOWN block exists, every environment, camera angle and hook formula you report must be traceable to its beats — do not invent visuals for ads with no teardown.
For cameraAngles, give at least 5 different shot types observed or recommended.
For hookFormulas, give at least 4 different hook types with complete formulas.
For environmentAnalysis, name at least 3 specific environments with lighting details.
For sellingPointVisuals, give visual treatment for each top selling point.`;

  return { system, user };
}
