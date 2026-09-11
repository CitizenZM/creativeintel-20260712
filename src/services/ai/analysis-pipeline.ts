import { z } from "zod";
import { prisma } from "@/lib/db";
import { analyzeWithClaude, getVisionModel } from "./claude-client";
import { buildBrandAnalysisPrompt } from "./prompts/brand-analysis";
import { buildContentScoringPrompt, type VideoEvidence, type ScoringItem } from "./prompts/content-scoring";
import { buildPatternMiningPrompt, type PatternTeardown } from "./prompts/pattern-mining";
import { buildCompetitorIntelPrompt } from "./prompts/competitor-intel";
import { buildAudienceResearchPrompt } from "./prompts/audience-research";
import { buildDeepAnalysisPrompt, type DeepAnalysisTeardown } from "./prompts/deep-analysis";
import {
  buildAdTeardownPrompt,
  AD_TEARDOWN_PROMPT_VERSION,
  HOOK_TYPES,
  type EvidenceLevel,
  type TeardownTranscriptSegment,
} from "./prompts/ad-teardown";
import { buildCompetitorRollupPrompt, COMPETITOR_ROLLUP_PROMPT_VERSION, type RollupTeardown } from "./prompts/competitor-rollup";
import { buildCompetitiveGapPrompt, GAP_CATEGORIES, type GapCategory } from "./prompts/competitive-gap";
import { crawlWebsite, type CrawlResult } from "@/services/research/website-crawler";
import { collectVideoSignal } from "@/services/research/video-signal";
import { extractKeyframes, extractTranscriptSegments, frameTimestamps } from "@/services/video/frames";
import { NarrativeType } from "@/generated/prisma/enums";
import { cached } from "@/services/cache";
import { pMap } from "@/lib/parallel";

const TOP_N_DEEP = Number(process.env.TOP_N_DEEP) || 5;
const SCORING_BATCH_SIZE = Number(process.env.CONTENT_SCORING_BATCH) || 10;
const STAGE_BUDGET_MS = Number(process.env.ANALYSIS_BUDGET_MS) || 45_000;
const TEARDOWN_CACHE_TTL_SEC = 30 * 24 * 60 * 60;
const ROLLUP_CONCURRENCY = 2;

export type AnalysisStage =
  | "brand"
  | "competitor_intel"
  | "scoring"
  | "teardown"
  | "rollup"
  | "gap"
  | "patterns";

export const ANALYSIS_STAGES: AnalysisStage[] = [
  "brand",
  "competitor_intel",
  "scoring",
  "teardown",
  "rollup",
  "gap",
  "patterns",
];

const STAGE_LABELS: Record<AnalysisStage, string> = {
  brand: "Brand analysis",
  competitor_intel: "Competitor intel",
  scoring: "Content scoring",
  teardown: "Ad teardowns",
  rollup: "Competitor rollups",
  gap: "Competitive gaps",
  patterns: "Pattern mining & deep analysis",
};

export interface StageResult {
  stage: AnalysisStage;
  ok: boolean;
  count: number;
  error?: string;
}

export interface AnalysisPipelineResult {
  done: boolean;
  nextStage: AnalysisStage | null;
  stages: StageResult[];
}

export interface AnalysisPipelineOptions {
  onProgress?: (step: string, pct: number) => void;
  jobId?: string;
  startStage?: AnalysisStage;
  budgetMs?: number;
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const brandAnalysisSchema = z.object({
  productCategory: z.string().optional(),
  productDescription: z.string().optional(),
  brandPromise: z.string(),
  valueProposition: z.string(),
  toneOfVoice: z.string(),
  targetAudience: z.string(),
  pricingTheme: z.string(),
  productFeatures: z.array(z.string()),
  ctaLanguage: z.array(z.string()),
  socialProof: z.array(z.string()),
  useEnvironments: z.array(z.object({
    name: z.string(),
    description: z.string(),
    imagePrompt: z.string(),
    typicalUser: z.string(),
  })).optional(),
  actorSettings: z.array(z.object({
    role: z.string(),
    ageRange: z.string(),
    scenario: z.string(),
    visualDescription: z.string(),
    painPoint: z.string(),
    productInteraction: z.string(),
  })).optional(),
  displayGuidelines: z.array(z.object({
    rule: z.string(),
    example: z.string(),
    antiExample: z.string(),
  })).optional(),
});

const strategicInsightSchema = z.object({
  insights: z.array(z.object({
    category: z.string(),
    title: z.string(),
    description: z.string(),
    importance: z.coerce.number(),
    recommendation: z.string(),
  })).min(1),
});

const contentScoreSchema = z.object({
  scores: z.array(z.object({
    videoId: z.string(),
    overallScore: z.coerce.number(),
    hookStrength: z.coerce.number(),
    productVisibility: z.coerce.number(),
    storytellingArc: z.coerce.number(),
    ctaQuality: z.coerce.number(),
    emotionalAppeal: z.coerce.number(),
    pacing: z.coerce.number(),
    hookText: z.string(),
    narrativeType: z.string(),
    keyMessages: z.array(z.string()),
    analysis: z.string(),
    contentCategory: z.string().optional().default("OTHER"),
    evidenceLevel: z.enum(["transcript", "thumbnail", "metadata"]),
    confidence: z.enum(["high", "medium", "low"]),
  })),
});

const competitorSchema = z.object({
  brandPromise: z.string(), valueProposition: z.string(), toneOfVoice: z.string(),
  pricingTheme: z.string(), productFeatures: z.array(z.string()),
  ctaLanguage: z.array(z.string()), strengths: z.array(z.string()),
  weaknesses: z.array(z.string()), opportunities: z.array(z.string()),
});

const teardownSchema = z.object({
  hookType: z.string(),
  hookText: z.string(),
  hookVisual: z.string().optional().default(""),
  beats: z.array(z.object({
    startSec: z.coerce.number().optional().default(0),
    endSec: z.coerce.number().optional().default(0),
    role: z.string().optional().default(""),
    visual: z.string().optional().default(""),
    vo: z.string().optional().default(""),
    onScreenText: z.string().optional().default(""),
  })).optional().default([]),
  sellingPoints: z.array(z.object({
    point: z.string().optional().default(""),
    evidenceTimestamp: z.string().optional().default(""),
  })).optional().default([]),
  proofDevices: z.array(z.object({
    type: z.string().optional().default(""),
    description: z.string().optional().default(""),
    timestamp: z.string().optional().default(""),
  })).optional().default([]),
  ctaText: z.string().nullish(),
  ctaPlacement: z.string().nullish(),
  offer: z.string().nullish(),
  landingUrl: z.string().nullish(),
  whyItWorks: z.string().optional().default(""),
  evidenceLevel: z.string().optional().default("metadata"),
  confidence: z.string().optional().default("low"),
});

type TeardownPayload = z.infer<typeof teardownSchema>;

const rollupSchema = z.object({
  dominantHooks: z.array(z.object({
    hookType: z.string().optional().default(""),
    count: z.coerce.number().optional().default(0),
    example: z.string().optional().default(""),
    whyItLands: z.string().optional().default(""),
  })).optional().default([]),
  dominantFormats: z.array(z.object({
    format: z.string().optional().default(""),
    count: z.coerce.number().optional().default(0),
    typicalDurationSec: z.coerce.number().optional().default(0),
    notes: z.string().optional().default(""),
  })).optional().default([]),
  offerLadder: z.array(z.object({
    offer: z.string().optional().default(""),
    frequency: z.coerce.number().optional().default(0),
    placement: z.string().optional().default(""),
    aggressiveness: z.string().optional().default("none"),
  })).optional().default([]),
  ctaPatterns: z.array(z.object({
    ctaText: z.string().optional().default(""),
    placement: z.string().optional().default(""),
    frequency: z.coerce.number().optional().default(0),
    destination: z.string().optional().default("unknown"),
  })).optional().default([]),
  cadence: z.object({
    avgDurationSec: z.coerce.number().optional().default(0),
    hookWindowSec: z.coerce.number().optional().default(0),
    productRevealSec: z.coerce.number().optional().default(0),
    ctaStartPct: z.coerce.number().optional().default(0),
    beatsPerAd: z.coerce.number().optional().default(0),
    notes: z.string().optional().default(""),
  }).optional().default({}),
  summary: z.string().optional().default(""),
});

const gapSchema = z.object({
  insights: z.array(z.object({
    competitorName: z.string().optional().default("ALL"),
    category: z.string(),
    title: z.string(),
    description: z.string(),
    importance: z.coerce.number().optional().default(60),
    recommendation: z.string().optional().default(""),
    evidence: z.array(z.string()).optional().default([]),
  })).optional().default([]),
});

const audienceSchema = z.object({
  segments: z.array(z.object({ name: z.string(), ageRange: z.string(), description: z.string(), size: z.string() })),
  psychographics: z.array(z.object({ trait: z.string(), description: z.string() })),
  painPoints: z.array(z.object({ point: z.string(), severity: z.string() })),
  interests: z.array(z.string()),
  platforms: z.array(z.object({ platform: z.string(), usage: z.string(), adReceptivity: z.string() })),
  buyingBehavior: z.string(),
  incomeLevel: z.string(),
  geoMarkets: z.array(z.string()),
});

const patternSchema = z.object({
  patterns: z.array(z.object({
    type: z.string(), name: z.string(), description: z.string(),
    frequency: z.coerce.number(), avgPerformance: z.coerce.number(), bestPractices: z.array(z.string()),
  })),
  sellingPoints: z.array(z.object({
    point: z.string(), category: z.string(), strength: z.coerce.number(),
    frequency: z.coerce.number(), uniqueness: z.coerce.number(),
  })),
  topSignals: z.array(z.string()),
});

const strOpt = z.string().optional().default("");
const numOpt = z.coerce.number().optional().default(0);
const arrStr = z.array(z.string()).optional().default([]);

const deepSchema = z.object({
  videoStructure: z.object({
    openingPatterns: z.array(z.object({ pattern: strOpt, frequency: numOpt, effectiveness: strOpt, example: strOpt })).optional().default([]),
    hookDurationRange: strOpt,
    productRevealTiming: strOpt,
    averageLength: strOpt,
    structuralInsights: arrStr,
  }).optional(),
  vibeAnalysis: z.object({
    dominantTones: z.array(z.object({ tone: strOpt, frequency: numOpt, avgScore: numOpt, example: strOpt })).optional().default([]),
    emotionalTriggers: z.array(z.object({ trigger: strOpt, usage: strOpt, examples: arrStr })).optional().default([]),
    visualStyleNotes: strOpt,
    pacingProfile: strOpt,
    vibeInsights: arrStr,
  }).optional(),
  ctaAnalysis: z.object({
    commonCTAs: z.array(z.object({ cta: strOpt, frequency: numOpt, type: strOpt, effectiveness: strOpt })).optional().default([]),
    placement: strOpt,
    urgencyLevel: strOpt,
    conversionDrivers: arrStr,
    ctaInsights: arrStr,
  }).optional(),
  sellingPointDeep: z.object({
    topPerformers: z.array(z.object({ point: strOpt, whyItWorks: strOpt, bestPlatforms: arrStr, exampleContent: strOpt })).optional().default([]),
    underutilized: z.array(z.object({ point: strOpt, opportunity: strOpt })).optional().default([]),
    messagingInsights: arrStr,
  }).optional(),
  competitiveGaps: z.array(z.object({ gap: strOpt, recommendation: strOpt, priority: strOpt })).optional().default([]),
  recommendations: z.array(z.object({ title: strOpt, description: strOpt, impact: strOpt, effort: strOpt, category: strOpt })).optional().default([]),
  environmentAnalysis: z.array(z.object({
    environment: strOpt, frequency: numOpt, description: strOpt,
    lightingNotes: strOpt, bestFor: strOpt, examples: arrStr,
  })).optional().default([]),
  cameraAngles: z.array(z.object({
    shot: strOpt, movement: strOpt, frequency: numOpt, whenToUse: strOpt,
    adEffect: strOpt, apertureSuggestion: strOpt, examples: arrStr,
  })).optional().default([]),
  hookFormulas: z.array(z.object({
    type: strOpt, formula: strOpt, openingLine: strOpt, visualDescription: strOpt,
    why: strOpt, platformFit: arrStr, scoreImpact: z.string().optional().default("medium"), examples: arrStr,
  })).optional().default([]),
  platformInsights: z.array(z.object({
    platform: strOpt, contentStyle: strOpt, topFormats: arrStr,
    avgEngagement: strOpt, bestPractices: arrStr, avoidPatterns: arrStr,
  })).optional().default([]),
  sellingPointVisuals: z.array(z.object({
    point: strOpt, visualTreatment: strOpt, screenTime: strOpt,
    placement: strOpt, cameraRecommendation: strOpt, examples: arrStr,
  })).optional().default([]),
  videoTimeline: z.object({
    recommendedDurationSec: z.coerce.number().optional().default(30),
    platform: strOpt,
    segments: z.array(z.object({
      segment: strOpt, startSec: numOpt, endSec: numOpt, label: strOpt,
      description: strOpt, cameraNote: strOpt, voiceover: strOpt, purpose: strOpt,
    })).optional().default([]),
    rationale: strOpt,
  }).optional(),
});

// ─── Small helpers ────────────────────────────────────────────────────────────

function validNarrativeType(val: string): NarrativeType {
  const valid: NarrativeType[] = [
    "PROBLEM_SOLUTION", "TESTIMONIAL", "DEMONSTRATION", "LIFESTYLE",
    "EDUCATIONAL", "COMPARISON", "STORY_ARC", "UGC_STYLE", "TREND_RIDING", "BEFORE_AFTER",
  ];
  return valid.includes(val as NarrativeType) ? (val as NarrativeType) : "DEMONSTRATION";
}

function normalizeHookType(value: string): string {
  const slug = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (HOOK_TYPES as readonly string[]).includes(slug) ? slug : "curiosity_gap";
}

function normalizeGapCategory(value: string): GapCategory {
  const slug = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (GAP_CATEGORIES as readonly string[]).includes(slug) ? (slug as GapCategory) : "gap";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function storedSegments(rawData: unknown): TeardownTranscriptSegment[] | undefined {
  const segs = asRecord(rawData).transcriptSegments;
  if (!Array.isArray(segs)) return undefined;
  const parsed = segs
    .map((s) => {
      const r = asRecord(s);
      return {
        start: Number(r.start) || 0,
        end: Number(r.end) || 0,
        text: typeof r.text === "string" ? r.text : "",
      };
    })
    .filter((s) => s.text.length > 0);
  return parsed.length > 0 ? parsed : undefined;
}

function jsonArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

async function recordStage(jobId: string | undefined, result: StageResult): Promise<void> {
  if (!jobId) return;
  try {
    const job = await prisma.researchJob.findUnique({ where: { id: jobId } });
    if (!job) return;
    const steps = jsonArray<Record<string, unknown>>(job.steps);
    const name = `AI analysis · ${STAGE_LABELS[result.stage]}`;
    const entry = {
      name,
      status: result.ok ? "complete" : "error",
      progress: 100,
      message: result.error ?? `${result.count} item${result.count === 1 ? "" : "s"}`,
      stage: result.stage,
      ok: result.ok,
      count: result.count,
      error: result.error ?? null,
      completedAt: new Date().toISOString(),
    };
    const idx = steps.findIndex((s) => s.name === name);
    if (idx >= 0) steps[idx] = entry;
    else steps.push(entry);
    await prisma.researchJob.update({ where: { id: jobId }, data: { steps: steps as never } });
  } catch {
    // job bookkeeping must never break the pipeline
  }
}

async function resolveJobId(projectId: string, explicit?: string): Promise<string | undefined> {
  if (explicit) return explicit;
  const job = await prisma.researchJob
    .findFirst({ where: { projectId, status: { in: ["pending", "running"] } }, orderBy: { createdAt: "desc" } })
    .catch(() => null);
  return job?.id;
}

async function getBrandCrawl(projectId: string): Promise<CrawlResult | null> {
  const [project, brand] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, select: { brandUrl: true } }),
    prisma.brand.findUnique({ where: { projectId }, select: { rawCrawlData: true } }),
  ]);
  const stored = brand?.rawCrawlData as CrawlResult | null;
  if (stored?.bodyText) return stored;
  if (!project?.brandUrl) return null;
  try {
    return await crawlWebsite(project.brandUrl);
  } catch (err) {
    console.error("Brand crawl failed:", err);
    return null;
  }
}

// ─── Stage: brand analysis ────────────────────────────────────────────────────

export async function runBrandStage(projectId: string): Promise<number> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { brand: true },
  });
  if (!project) throw new Error("Project not found");
  if (!project.brand) throw new Error("Brand row missing for project");

  const crawl = await getBrandCrawl(projectId);
  if (!crawl) throw new Error("No brand website data available for analysis");

  const productContext = {
    productUrl: project.productUrl || undefined,
    productName: project.productName || undefined,
    productPageTitle: project.productPageTitle || undefined,
    productPageText: project.productPageText || undefined,
    productPageImages: (project.productPageImages as { url: string; alt: string }[] | null) || undefined,
  };
  const p = buildBrandAnalysisPrompt(project.brandName, crawl, productContext);
  const a = await analyzeWithClaude({ systemPrompt: p.system, userPrompt: p.user, responseSchema: brandAnalysisSchema });

  await prisma.brand.update({
    where: { id: project.brand.id },
    data: {
      brandPromise: a.brandPromise, valueProposition: a.valueProposition,
      toneOfVoice: a.toneOfVoice, targetAudience: a.targetAudience,
      pricingTheme: a.pricingTheme, productFeatures: a.productFeatures,
      ctaLanguage: a.ctaLanguage, socialProof: a.socialProof,
      productCategory: a.productCategory, productDescription: a.productDescription,
      useEnvironments: a.useEnvironments as never,
      actorSettings: a.actorSettings as never,
      displayGuidelines: a.displayGuidelines as never,
      dataSource: "AI_INFERRED", rawCrawlData: crawl satisfies object as object,
    },
  });

  try {
    const sys = `You are a creative strategist. Given a brand's analyzed positioning, produce 3-5 actionable strategic insights for ad creative. Each insight must be SPECIFIC to this brand (reference real features/audience/promise). No generic marketing platitudes.

Respond with ONLY JSON:
{"insights":[{"category":"positioning|audience|messaging|differentiation|opportunity","title":"...","description":"why this matters (2-3 sentences with specifics)","importance":1-100,"recommendation":"concrete next-step for ad creative (1 sentence)"}]}`;
    const usr = `Brand: ${project.brandName}
Promise: ${a.brandPromise}
Value prop: ${a.valueProposition}
Tone: ${a.toneOfVoice}
Target audience: ${a.targetAudience}
Pricing theme: ${a.pricingTheme}
Top features: ${(a.productFeatures || []).slice(0, 6).join(", ")}
CTAs on site: ${(a.ctaLanguage || []).slice(0, 6).join(", ")}
Social proof: ${(a.socialProof || []).slice(0, 4).join(" / ")}`;
    const ai = await analyzeWithClaude({ systemPrompt: sys, userPrompt: usr, responseSchema: strategicInsightSchema, maxTokens: 1500 });
    await prisma.insight.deleteMany({
      where: { projectId, competitorId: null, category: { notIn: [...GAP_CATEGORIES] } },
    });
    for (const ins of ai.insights) {
      await prisma.insight.create({
        data: {
          projectId, category: ins.category, title: ins.title,
          description: ins.description, importance: ins.importance,
          recommendation: ins.recommendation, dataSource: "AI_INFERRED",
        },
      }).catch(() => {});
    }
  } catch (err) {
    console.error("Strategic-insight generation failed:", err);
  }

  return 1;
}

// ─── Stage: competitor intel ──────────────────────────────────────────────────

export async function runCompetitorIntelStage(projectId: string, deadline?: number): Promise<number> {
  const competitors = await prisma.competitor.findMany({
    where: { projectId },
    include: { adTeardowns: { orderBy: { rank: "asc" }, take: 5, include: { contentAsset: { select: { title: true } } } } },
  });
  if (competitors.length === 0) return 0;

  const brandCrawl = await getBrandCrawl(projectId);
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { brandName: true } });
  if (!project) throw new Error("Project not found");

  let done = 0;
  for (const comp of competitors) {
    if (deadline && Date.now() > deadline) break;
    if (comp.valueProposition) continue;

    let crawl = comp.rawCrawlData as CrawlResult | null;
    if (!crawl?.bodyText && comp.url) {
      crawl = await crawlWebsite(comp.url).catch(() => null);
    }
    if (!crawl?.bodyText) continue;

    try {
      const adEvidence = comp.adTeardowns.map((t) => ({
        title: t.contentAsset?.title || "untitled",
        hookType: t.hookType,
        hookText: t.hookText,
        ctaText: t.ctaText,
        offer: t.offer,
      }));
      const p = buildCompetitorIntelPrompt(project.brandName, brandCrawl, comp.name, crawl, adEvidence);
      const a = await analyzeWithClaude({ systemPrompt: p.system, userPrompt: p.user, responseSchema: competitorSchema });
      await prisma.competitor.update({
        where: { id: comp.id },
        data: {
          brandPromise: a.brandPromise, valueProposition: a.valueProposition,
          toneOfVoice: a.toneOfVoice, pricingTheme: a.pricingTheme,
          productFeatures: a.productFeatures, ctaLanguage: a.ctaLanguage,
          strengths: a.strengths, weaknesses: a.weaknesses,
          rawCrawlData: crawl satisfies object as object, dataSource: "AI_INFERRED",
        },
      });
      done += 1;
    } catch (err) {
      console.error(`Competitor analysis failed for ${comp.name}:`, err);
    }
  }
  return done;
}

// ─── Stage: content scoring ───────────────────────────────────────────────────

export async function runContentScoringStage(
  projectId: string,
  deadline?: number
): Promise<{ count: number; remaining: number }> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { brandName: true } });
  if (!project) throw new Error("Project not found");

  const pending = await prisma.contentAsset.findMany({
    where: { projectId, overallScore: null },
    orderBy: [{ rankInOwner: "asc" }, { viewCount: "desc" }],
  });
  if (pending.length === 0) return { count: 0, remaining: 0 };

  let scored = 0;
  let index = 0;

  while (index < pending.length) {
    if (deadline && Date.now() > deadline) break;
    const batch = pending.slice(index, index + SCORING_BATCH_SIZE);
    index += SCORING_BATCH_SIZE;

    const items: ScoringItem[] = batch.map((a) => ({
      videoId: a.id,
      title: a.title,
      description: a.description,
      channelTitle: a.advertiserName,
      platform: a.platform,
      viewCount: a.viewCount,
      likeCount: a.likeCount,
      commentCount: a.commentCount,
      publishedAt: a.publishedAt,
    }));
    const evidence = new Map<string, VideoEvidence>(
      batch.map((a) => [
        a.id,
        { transcript: a.transcript || undefined, thumbnailUrl: a.thumbnailUrl || undefined },
      ])
    );

    try {
      const p = buildContentScoringPrompt(project.brandName, items, evidence);
      const r = await analyzeWithClaude({
        systemPrompt: p.system, userPrompt: p.user,
        responseSchema: contentScoreSchema, maxTokens: 8192,
      });

      for (const score of r.scores) {
        const asset = batch.find((a) => a.id === score.videoId);
        if (!asset) continue;
        const rawData = {
          ...asRecord(asset.rawData),
          evidenceLevel: score.evidenceLevel,
          confidence: score.confidence,
          scoringAnalysis: score.analysis,
        };
        await prisma.contentAsset.update({
          where: { id: asset.id },
          data: {
            overallScore: score.overallScore, hookStrength: score.hookStrength,
            productVisibility: score.productVisibility, storytellingArc: score.storytellingArc,
            ctaQuality: score.ctaQuality, emotionalAppeal: score.emotionalAppeal, pacing: score.pacing,
            hookText: score.hookText, narrativeType: validNarrativeType(score.narrativeType),
            keyMessages: score.keyMessages, contentCategory: score.contentCategory || null,
            engagementRate:
              asset.viewCount && asset.viewCount > 0
                ? (((asset.likeCount || 0) + (asset.commentCount || 0)) / asset.viewCount) * 100
                : asset.engagementRate,
            rawData: rawData as never,
          },
        });
        scored += 1;
      }
    } catch (err) {
      console.error("Content scoring batch failed:", err);
    }
  }

  const remaining = await prisma.contentAsset.count({ where: { projectId, overallScore: null } });
  return { count: scored, remaining };
}

// ─── Stage: per-ad teardown ───────────────────────────────────────────────────

type DeepAsset = Awaited<ReturnType<typeof prisma.contentAsset.findMany>>[number];

async function selectDeepAssets(projectId: string): Promise<DeepAsset[]> {
  const assets = await prisma.contentAsset.findMany({
    where: { projectId },
    orderBy: [{ rankInOwner: "asc" }, { overallScore: "desc" }],
  });
  const byOwner = new Map<string, DeepAsset[]>();
  for (const a of assets) {
    const key = a.competitorId || "__brand__";
    const list = byOwner.get(key) || [];
    list.push(a);
    byOwner.set(key, list);
  }
  const selected: DeepAsset[] = [];
  for (const list of byOwner.values()) {
    const ranked = [...list].sort((x, y) => {
      const rx = x.rankInOwner ?? Number.MAX_SAFE_INTEGER;
      const ry = y.rankInOwner ?? Number.MAX_SAFE_INTEGER;
      if (rx !== ry) return rx - ry;
      return (y.overallScore ?? 0) - (x.overallScore ?? 0);
    });
    selected.push(...ranked.slice(0, TOP_N_DEEP));
  }
  return selected;
}

async function resolveEvidence(asset: DeepAsset): Promise<{
  frameUrls: string[];
  timestamps?: number[];
  transcript?: string;
  segments?: TeardownTranscriptSegment[];
  evidenceLevel: EvidenceLevel;
}> {
  const frames = await extractKeyframes({
    id: asset.id,
    url: asset.url,
    videoUrl: asset.videoUrl,
    thumbnailUrl: asset.thumbnailUrl,
    durationSec: asset.durationSec,
    frameUrls: asset.frameUrls,
    platform: asset.platform,
  });

  let transcript = asset.transcript || undefined;
  let segments = storedSegments(asset.rawData);

  if (!segments) {
    const local = await extractTranscriptSegments({
      id: asset.id,
      url: asset.url,
      videoUrl: asset.videoUrl,
      thumbnailUrl: asset.thumbnailUrl,
      durationSec: asset.durationSec,
    });
    if (local?.segments.length) {
      segments = local.segments;
      transcript = transcript || local.text;
      await prisma.contentAsset.update({
        where: { id: asset.id },
        data: {
          transcript: asset.transcript || local.text,
          rawData: { ...asRecord(asset.rawData), transcriptSegments: local.segments } as never,
        },
      }).catch(() => {});
    }
  }

  if (!transcript) {
    const signal = await collectVideoSignal({
      platform: (asset.platform || "youtube").toLowerCase().replace(/\s+/g, "_"),
      url: asset.videoUrl || asset.url,
      videoId: asset.id,
      thumbnailUrl: asset.thumbnailUrl || undefined,
    }).catch(() => null);
    if (signal?.transcript) {
      transcript = signal.transcript;
      await prisma.contentAsset
        .update({ where: { id: asset.id }, data: { transcript: signal.transcript } })
        .catch(() => {});
    }
  }

  const hasVision = frames.frameUrls.length >= 2;
  const evidenceLevel: EvidenceLevel = hasVision && transcript
    ? "vision_transcript"
    : transcript
      ? "transcript"
      : frames.frameUrls.length > 0
        ? "thumbnail"
        : "metadata";

  return {
    frameUrls: frames.frameUrls,
    timestamps: asset.durationSec ? frameTimestamps(asset.durationSec).slice(0, frames.frameUrls.length) : undefined,
    transcript,
    segments,
    evidenceLevel,
  };
}

export async function runAdTeardownStage(
  projectId: string,
  deadline?: number
): Promise<{ count: number; remaining: number }> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { brandName: true, competitors: { select: { id: true, name: true } } },
  });
  if (!project) throw new Error("Project not found");
  const competitorNames = new Map(project.competitors.map((c) => [c.id, c.name]));

  const candidates = await selectDeepAssets(projectId);
  const existing = await prisma.adTeardown.findMany({
    where: { projectId, contentAssetId: { in: candidates.map((a) => a.id) } },
    select: { contentAssetId: true, promptVersion: true },
  });
  const current = new Set(
    existing.filter((t) => t.promptVersion === AD_TEARDOWN_PROMPT_VERSION).map((t) => t.contentAssetId)
  );
  const pending = candidates.filter((a) => !current.has(a.id));

  let count = 0;
  for (const asset of pending) {
    if (deadline && Date.now() > deadline) break;
    try {
      const evidence = await resolveEvidence(asset);
      const ownerName = asset.competitorId
        ? competitorNames.get(asset.competitorId) || "Competitor"
        : project.brandName;

      const payload = await cached<TeardownPayload>(
        {
          kind: "ad-teardown",
          params: { url: asset.url, promptVersion: AD_TEARDOWN_PROMPT_VERSION, evidence: evidence.evidenceLevel },
          ttlSec: TEARDOWN_CACHE_TTL_SEC,
        },
        async () => {
          const prompt = buildAdTeardownPrompt({
            brandName: project.brandName,
            ownerName,
            isBrandOwned: !asset.competitorId,
            title: asset.title,
            url: asset.url,
            platform: asset.platform,
            adSource: asset.adSource,
            isPaidMedia: asset.isPaidMedia,
            description: asset.description,
            durationSec: asset.durationSec,
            viewCount: asset.viewCount,
            publishedAt: asset.publishedAt,
            landingUrl: asset.landingUrl,
            rank: asset.rankInOwner,
            frameUrls: evidence.frameUrls,
            frameTimestamps: evidence.timestamps,
            transcript: evidence.transcript,
            transcriptSegments: evidence.segments,
            evidenceLevel: evidence.evidenceLevel,
          });
          return analyzeWithClaude({
            systemPrompt: prompt.system,
            userPrompt: prompt.user,
            responseSchema: teardownSchema,
            maxTokens: 4096,
            model: evidence.frameUrls.length > 0 ? getVisionModel() : undefined,
          });
        }
      );

      const data = {
        projectId,
        competitorId: asset.competitorId,
        rank: asset.rankInOwner,
        hookType: normalizeHookType(payload.hookType),
        hookText: payload.hookText,
        hookVisual: payload.hookVisual,
        beats: payload.beats as never,
        sellingPoints: payload.sellingPoints as never,
        proofDevices: payload.proofDevices as never,
        ctaText: payload.ctaText ?? null,
        ctaPlacement: payload.ctaPlacement ?? null,
        offer: payload.offer ?? null,
        landingUrl: payload.landingUrl ?? asset.landingUrl ?? null,
        whyItWorks: payload.whyItWorks,
        evidenceLevel: evidence.evidenceLevel,
        confidence: payload.confidence,
        promptVersion: AD_TEARDOWN_PROMPT_VERSION,
      };

      await prisma.adTeardown.upsert({
        where: { contentAssetId: asset.id },
        create: { contentAssetId: asset.id, ...data },
        update: data,
      });
      count += 1;
    } catch (err) {
      console.error(`Ad teardown failed for ${asset.url}:`, err);
    }
  }

  const doneIds = await prisma.adTeardown.findMany({
    where: {
      projectId,
      contentAssetId: { in: candidates.map((a) => a.id) },
      promptVersion: AD_TEARDOWN_PROMPT_VERSION,
    },
    select: { contentAssetId: true },
  });
  return { count, remaining: Math.max(candidates.length - doneIds.length, 0) };
}

// ─── Stage: competitor rollup ─────────────────────────────────────────────────

function toRollupTeardown(
  t: { rank: number | null; hookType: string; hookText: string; hookVisual: string; beats: unknown; sellingPoints: unknown; proofDevices: unknown; ctaText: string | null; ctaPlacement: string | null; offer: string | null; landingUrl: string | null; whyItWorks: string; evidenceLevel: string; contentAsset: { id: string; title: string; platform: string | null; format: string | null; durationSec: number | null; viewCount: number | null; publishedAt: Date | null } }
): RollupTeardown {
  return {
    assetId: t.contentAsset.id,
    title: t.contentAsset.title,
    rank: t.rank,
    platform: t.contentAsset.platform,
    format: t.contentAsset.format,
    durationSec: t.contentAsset.durationSec,
    viewCount: t.contentAsset.viewCount,
    publishedAt: t.contentAsset.publishedAt,
    hookType: t.hookType,
    hookText: t.hookText,
    hookVisual: t.hookVisual,
    beats: jsonArray(t.beats),
    sellingPoints: jsonArray(t.sellingPoints),
    proofDevices: jsonArray(t.proofDevices),
    ctaText: t.ctaText,
    ctaPlacement: t.ctaPlacement,
    offer: t.offer,
    landingUrl: t.landingUrl,
    whyItWorks: t.whyItWorks,
    evidenceLevel: t.evidenceLevel,
  };
}

export async function runCompetitorRollupStage(projectId: string, deadline?: number): Promise<number> {
  const competitors = await prisma.competitor.findMany({
    where: { projectId },
    include: {
      rollup: true,
      adTeardowns: {
        orderBy: [{ rank: "asc" }, { updatedAt: "desc" }],
        include: {
          contentAsset: {
            select: { id: true, title: true, platform: true, format: true, durationSec: true, viewCount: true, publishedAt: true },
          },
        },
      },
    },
  });

  const stale = competitors.filter((c) => {
    if (c.adTeardowns.length === 0) return false;
    if (!c.rollup) return true;
    const newest = c.adTeardowns.reduce((max, t) => (t.updatedAt > max ? t.updatedAt : max), new Date(0));
    return c.rollup.updatedAt < newest;
  });
  if (stale.length === 0) return 0;

  let count = 0;
  await pMap(
    stale,
    async (comp) => {
      if (deadline && Date.now() > deadline) return;
      try {
        const teardowns = comp.adTeardowns.map(toRollupTeardown);
        const prompt = buildCompetitorRollupPrompt({
          competitorName: comp.name,
          competitorUrl: comp.url,
          teardowns,
        });
        const r = await analyzeWithClaude({
          systemPrompt: prompt.system, userPrompt: prompt.user,
          responseSchema: rollupSchema, maxTokens: 3000,
        });
        const data = {
          projectId,
          topAssetIds: teardowns.map((t) => t.assetId) as never,
          dominantHooks: r.dominantHooks as never,
          dominantFormats: r.dominantFormats as never,
          offerLadder: r.offerLadder as never,
          ctaPatterns: r.ctaPatterns as never,
          cadence: r.cadence as never,
          summary: r.summary,
        };
        await prisma.competitorRollup.upsert({
          where: { competitorId: comp.id },
          create: { competitorId: comp.id, ...data },
          update: data,
        });
        count += 1;
      } catch (err) {
        console.error(`Competitor rollup failed for ${comp.name}:`, err);
      }
    },
    { concurrency: ROLLUP_CONCURRENCY }
  );
  return count;
}

// ─── Stage: competitive gap ───────────────────────────────────────────────────

export async function runCompetitiveGapStage(projectId: string): Promise<number> {
  const [project, brand, rollups, ownTeardowns] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, select: { brandName: true } }),
    prisma.brand.findUnique({ where: { projectId } }),
    prisma.competitorRollup.findMany({
      where: { projectId },
      include: { competitor: { select: { id: true, name: true, _count: { select: { adTeardowns: true } } } } },
    }),
    prisma.adTeardown.findMany({ where: { projectId, competitorId: null }, take: 8 }),
  ]);
  if (!project) throw new Error("Project not found");
  if (rollups.length === 0) return 0;

  const prompt = buildCompetitiveGapPrompt({
    brand: {
      brandName: project.brandName,
      brandPromise: brand?.brandPromise,
      valueProposition: brand?.valueProposition,
      toneOfVoice: brand?.toneOfVoice,
      targetAudience: brand?.targetAudience,
      pricingTheme: brand?.pricingTheme,
      productFeatures: jsonArray<string>(brand?.productFeatures),
      ctaLanguage: jsonArray<string>(brand?.ctaLanguage),
      ownHooks: ownTeardowns.map((t) => ({
        hookType: t.hookType, hookText: t.hookText, ctaText: t.ctaText, offer: t.offer,
      })),
    },
    rollups: rollups.map((r) => ({
      competitorId: r.competitorId,
      competitorName: r.competitor.name,
      dominantHooks: r.dominantHooks,
      dominantFormats: r.dominantFormats,
      offerLadder: r.offerLadder,
      ctaPatterns: r.ctaPatterns,
      cadence: r.cadence,
      summary: r.summary,
      adCount: r.competitor._count.adTeardowns,
    })),
  });

  const r = await analyzeWithClaude({
    systemPrompt: prompt.system, userPrompt: prompt.user,
    responseSchema: gapSchema, maxTokens: 4096,
  });
  if (r.insights.length === 0) return 0;

  const byName = new Map(rollups.map((x) => [x.competitor.name.toLowerCase(), x.competitorId]));

  await prisma.insight.deleteMany({
    where: { projectId, category: { in: [...GAP_CATEGORIES] } },
  });

  let count = 0;
  for (const ins of r.insights) {
    const competitorId = byName.get(ins.competitorName.trim().toLowerCase()) ?? null;
    await prisma.insight.create({
      data: {
        projectId,
        competitorId,
        category: normalizeGapCategory(ins.category),
        title: ins.title,
        description: ins.description,
        importance: ins.importance,
        recommendation: ins.recommendation || null,
        evidence: ins.evidence as never,
        dataSource: "AI_INFERRED",
      },
    }).catch(() => {});
    count += 1;
  }
  return count;
}

// ─── Stage: pattern mining, audience, deep analysis ───────────────────────────

interface TeardownContext {
  assetId: string;
  owner: string;
  pattern: PatternTeardown;
  deep: DeepAnalysisTeardown;
}

async function loadTeardownContext(projectId: string): Promise<Map<string, TeardownContext>> {
  const teardowns = await prisma.adTeardown.findMany({
    where: { projectId },
    include: { competitor: { select: { name: true } } },
  });
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { brandName: true } });
  const map = new Map<string, TeardownContext>();
  for (const t of teardowns) {
    const sellingPoints = jsonArray<{ point?: string }>(t.sellingPoints)
      .map((s) => s.point || "")
      .filter(Boolean);
    const proofDevices = jsonArray<{ type?: string; description?: string }>(t.proofDevices)
      .map((p) => [p.type, p.description].filter(Boolean).join(": "))
      .filter(Boolean);
    const beats = jsonArray<{ startSec?: number; endSec?: number; role?: string; visual?: string; vo?: string; onScreenText?: string }>(t.beats);
    map.set(t.contentAssetId, {
      assetId: t.contentAssetId,
      owner: t.competitor?.name || project?.brandName || "our brand",
      pattern: {
        hookType: t.hookType, hookVisual: t.hookVisual, beats,
        sellingPoints, proofDevices,
        ctaText: t.ctaText, ctaPlacement: t.ctaPlacement, offer: t.offer,
        whyItWorks: t.whyItWorks,
      },
      deep: {
        hookType: t.hookType, hookVisual: t.hookVisual, beats,
        sellingPoints, proofDevices,
        ctaText: t.ctaText, ctaPlacement: t.ctaPlacement, offer: t.offer,
        whyItWorks: t.whyItWorks, evidenceLevel: t.evidenceLevel,
      },
    });
  }
  return map;
}

export async function runPatternMiningStage(projectId: string): Promise<number> {
  const [project, assets, context] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, select: { brandName: true } }),
    prisma.contentAsset.findMany({
      where: { projectId, overallScore: { not: null } },
      orderBy: { overallScore: "desc" },
      take: 30,
    }),
    loadTeardownContext(projectId),
  ]);
  if (!project) throw new Error("Project not found");
  if (assets.length === 0) return 0;

  const p = buildPatternMiningPrompt(
    project.brandName,
    assets.map((a) => ({
      title: a.title,
      narrativeType: a.narrativeType || "DEMONSTRATION",
      overallScore: a.overallScore || 0,
      hookText: a.hookText || "",
      keyMessages: jsonArray<string>(a.keyMessages),
      evidenceLevel: context.get(a.id)?.deep.evidenceLevel || (asRecord(a.rawData).evidenceLevel as string | undefined),
      owner: context.get(a.id)?.owner,
      teardown: context.get(a.id)?.pattern,
    }))
  );
  const r = await analyzeWithClaude({
    systemPrompt: p.system, userPrompt: p.user,
    responseSchema: patternSchema, maxTokens: 4096,
  });

  for (const pat of r.patterns) {
    await prisma.narrativePattern.upsert({
      where: { projectId_type: { projectId, type: validNarrativeType(pat.type) } },
      create: {
        projectId, type: validNarrativeType(pat.type), name: pat.name, description: pat.description,
        frequency: pat.frequency, avgPerformance: pat.avgPerformance, bestPractices: pat.bestPractices,
      },
      update: {
        name: pat.name, description: pat.description, frequency: pat.frequency,
        avgPerformance: pat.avgPerformance, bestPractices: pat.bestPractices,
      },
    });
  }
  await prisma.sellingPoint.deleteMany({ where: { projectId } });
  for (const sp of r.sellingPoints) {
    await prisma.sellingPoint.create({
      data: { projectId, point: sp.point, category: sp.category, strength: sp.strength, frequency: sp.frequency, uniqueness: sp.uniqueness },
    });
  }

  const avgScore = assets.reduce((s, a) => s + (a.overallScore || 0), 0) / assets.length;
  await prisma.project.update({
    where: { id: projectId },
    data: {
      brandHealthScore: Math.round(avgScore),
      opportunityScore: Math.round(
        r.sellingPoints.reduce((s, x) => s + (x.uniqueness || 0), 0) / Math.max(r.sellingPoints.length, 1)
      ),
      topSignals: r.topSignals,
    },
  });

  return r.patterns.length;
}

export async function runAudienceResearchStage(projectId: string): Promise<number> {
  const [project, brand, topAssets] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId } }),
    prisma.brand.findUnique({ where: { projectId } }),
    prisma.contentAsset.findMany({
      where: { projectId, overallScore: { not: null } },
      orderBy: { overallScore: "desc" },
      take: 5,
    }),
  ]);
  if (!project) throw new Error("Project not found");

  const prompt = buildAudienceResearchPrompt({
    brandName: project.brandName,
    brandPromise: brand?.brandPromise || undefined,
    valueProposition: brand?.valueProposition || undefined,
    targetAudience: brand?.targetAudience || undefined,
    toneOfVoice: brand?.toneOfVoice || undefined,
    pricingTheme: brand?.pricingTheme || undefined,
    productFeatures: jsonArray<string>(brand?.productFeatures),
    category: project.category || undefined,
    topSignals: jsonArray<string>(project.topSignals),
    topContent: topAssets.map((a) => ({
      title: a.title,
      viewCount: a.viewCount || 0,
      narrativeType: a.narrativeType || "DEMONSTRATION",
    })),
  });

  const audience = await analyzeWithClaude({
    systemPrompt: prompt.system, userPrompt: prompt.user,
    responseSchema: audienceSchema, maxTokens: 2048,
  });

  await prisma.audienceProfile.upsert({
    where: { projectId },
    create: { projectId, ...audience, dataSource: "AI_INFERRED" },
    update: { ...audience },
  });
  return 1;
}

export async function runDeepAnalysisStage(projectId: string): Promise<number> {
  const [project, campaignSel, audienceData, assets, context, rollups] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId } }),
    prisma.campaignSelection.findUnique({ where: { projectId } }).catch(() => null),
    prisma.audienceProfile.findUnique({ where: { projectId } }).catch(() => null),
    prisma.contentAsset.findMany({
      where: { projectId, overallScore: { not: null } },
      orderBy: { overallScore: "desc" },
      take: 12,
    }),
    loadTeardownContext(projectId),
    prisma.competitorRollup.findMany({
      where: { projectId },
      include: { competitor: { select: { name: true } } },
    }),
  ]);
  if (!project) throw new Error("Project not found");
  if (assets.length === 0) return 0;

  const ordered = [...assets].sort((a, b) => {
    const ta = context.has(a.id) ? 1 : 0;
    const tb = context.has(b.id) ? 1 : 0;
    if (ta !== tb) return tb - ta;
    return (b.overallScore || 0) - (a.overallScore || 0);
  });

  const prompt = buildDeepAnalysisPrompt({
    brandName: project.brandName,
    category: project.category || undefined,
    productDescription: project.productPageText?.slice(0, 400) || undefined,
    productName: project.productPageTitle || project.productName || undefined,
    campaignGoal: project.campaignGoal || undefined,
    platform: (campaignSel?.platform as string | null) || undefined,
    targetDurationSec: (campaignSel?.totalDurationSec as number | null) || undefined,
    selectedEnvironment: (campaignSel?.selectedEnvironment as string | null) || undefined,
    selectedActorRole: (campaignSel?.selectedActorRole as string | null) || undefined,
    selectedSellingPoints:
      (campaignSel?.selectedSellingPoints as { point: string }[] | null)?.map((s) => s.point) || undefined,
    audienceSummary: audienceData
      ? `${(audienceData.segments as { name: string }[] | null)?.[0]?.name || ""}, pain points: ${
          (audienceData.painPoints as { point: string }[] | null)?.slice(0, 3).map((p) => p.point).join(", ") || ""
        }`
      : undefined,
    competitorSummaries: rollups.map((r) => ({ name: r.competitor.name, summary: r.summary })),
    topContent: ordered.slice(0, 8).map((a) => ({
      title: a.title,
      platform: a.platform || "YouTube",
      narrativeType: a.narrativeType || "DEMONSTRATION",
      overallScore: a.overallScore || 0,
      hookStrength: a.hookStrength || 0,
      ctaQuality: a.ctaQuality || 0,
      emotionalAppeal: a.emotionalAppeal || 0,
      pacing: a.pacing || 0,
      storytellingArc: a.storytellingArc || 0,
      hookText: a.hookText || "",
      keyMessages: jsonArray<string>(a.keyMessages),
      viewCount: a.viewCount || 0,
      contentCategory: a.contentCategory,
      url: a.url || undefined,
      thumbnailUrl: a.thumbnailUrl || undefined,
      owner: context.get(a.id)?.owner,
      teardown: context.get(a.id)?.deep,
    })),
  });

  const deep = await analyzeWithClaude({
    systemPrompt: prompt.system, userPrompt: prompt.user,
    responseSchema: deepSchema, maxTokens: 4096,
  });

  await prisma.deepAnalysis.upsert({
    where: { projectId },
    create: {
      projectId, ...deep, dataSource: "AI_INFERRED",
      environmentAnalysis: deep.environmentAnalysis as never,
      cameraAngles: deep.cameraAngles as never,
      hookFormulas: deep.hookFormulas as never,
      platformInsights: deep.platformInsights as never,
      sellingPointVisuals: deep.sellingPointVisuals as never,
      videoTimeline: deep.videoTimeline as never,
    },
    update: {
      ...deep,
      environmentAnalysis: deep.environmentAnalysis as never,
      cameraAngles: deep.cameraAngles as never,
      hookFormulas: deep.hookFormulas as never,
      platformInsights: deep.platformInsights as never,
      sellingPointVisuals: deep.sellingPointVisuals as never,
      videoTimeline: deep.videoTimeline as never,
    },
  });
  return 1;
}

// ─── Stage resolution ─────────────────────────────────────────────────────────

export async function resolveStartStage(projectId: string): Promise<AnalysisStage | null> {
  const brand = await prisma.brand.findUnique({ where: { projectId }, select: { brandPromise: true } });
  if (!brand?.brandPromise) return "brand";

  const pendingCompetitor = await prisma.competitor.count({
    where: { projectId, valueProposition: null },
  });
  if (pendingCompetitor > 0) return "competitor_intel";

  const unscored = await prisma.contentAsset.count({ where: { projectId, overallScore: null } });
  if (unscored > 0) return "scoring";

  const deepAssets = await selectDeepAssets(projectId);
  if (deepAssets.length > 0) {
    const done = await prisma.adTeardown.count({
      where: {
        projectId,
        promptVersion: AD_TEARDOWN_PROMPT_VERSION,
        contentAssetId: { in: deepAssets.map((a) => a.id) },
      },
    });
    if (done < deepAssets.length) return "teardown";
  }

  const competitors = await prisma.competitor.findMany({
    where: { projectId },
    select: {
      id: true,
      rollup: { select: { updatedAt: true } },
      adTeardowns: { select: { updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 1 },
    },
  });
  const rollupStale = competitors.some(
    (c) => c.adTeardowns.length > 0 && (!c.rollup || c.rollup.updatedAt < c.adTeardowns[0].updatedAt)
  );
  if (rollupStale) return "rollup";

  const rollupCount = await prisma.competitorRollup.count({ where: { projectId } });
  if (rollupCount > 0) {
    const [newestRollup, newestGap] = await Promise.all([
      prisma.competitorRollup.findFirst({ where: { projectId }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
      prisma.insight.findFirst({
        where: { projectId, category: { in: [...GAP_CATEGORIES] } },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
    ]);
    if (!newestGap || (newestRollup && newestGap.createdAt < newestRollup.updatedAt)) return "gap";
  }

  const [deepAnalysis, newestAsset] = await Promise.all([
    prisma.deepAnalysis.findUnique({ where: { projectId }, select: { updatedAt: true } }),
    prisma.contentAsset.findFirst({ where: { projectId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);
  if (!deepAnalysis || (newestAsset && deepAnalysis.updatedAt < newestAsset.createdAt)) return "patterns";

  return null;
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * Runs the analysis stages against whatever the research runner has already
 * persisted. Bounded by a wall-clock budget so it fits inside a 60 s serverless
 * invocation: it processes what it can and reports the stage to resume from.
 * Only a brand-analysis failure aborts the run; every other stage records a
 * partial-failure result and the pipeline continues.
 */
export async function runAnalysisPipeline(
  projectId: string,
  opts: AnalysisPipelineOptions = {}
): Promise<AnalysisPipelineResult> {
  const budgetMs = opts.budgetMs ?? STAGE_BUDGET_MS;
  const deadline = Date.now() + budgetMs;
  const jobId = await resolveJobId(projectId, opts.jobId);
  const stages: StageResult[] = [];

  const start = opts.startStage ?? (await resolveStartStage(projectId));
  if (!start) return { done: true, nextStage: null, stages };

  const report = (stage: AnalysisStage) => {
    const idx = ANALYSIS_STAGES.indexOf(stage);
    opts.onProgress?.(STAGE_LABELS[stage], Math.round((idx / ANALYSIS_STAGES.length) * 100));
  };

  const finish = async (stage: AnalysisStage, result: StageResult) => {
    stages.push(result);
    await recordStage(jobId, result);
  };

  for (let i = ANALYSIS_STAGES.indexOf(start); i < ANALYSIS_STAGES.length; i++) {
    const stage = ANALYSIS_STAGES[i];
    report(stage);
    let partial = false;

    try {
      switch (stage) {
        case "brand": {
          const count = await runBrandStage(projectId);
          await finish(stage, { stage, ok: true, count });
          break;
        }
        case "competitor_intel": {
          const count = await runCompetitorIntelStage(projectId, deadline);
          await finish(stage, { stage, ok: true, count });
          break;
        }
        case "scoring": {
          const { count, remaining } = await runContentScoringStage(projectId, deadline);
          partial = remaining > 0;
          await finish(stage, { stage, ok: true, count, error: partial ? `${remaining} assets still unscored` : undefined });
          break;
        }
        case "teardown": {
          const { count, remaining } = await runAdTeardownStage(projectId, deadline);
          partial = remaining > 0 && Date.now() > deadline;
          await finish(stage, { stage, ok: true, count, error: remaining > 0 ? `${remaining} teardowns outstanding` : undefined });
          break;
        }
        case "rollup": {
          const count = await runCompetitorRollupStage(projectId, deadline);
          await finish(stage, { stage, ok: true, count });
          break;
        }
        case "gap": {
          const count = await runCompetitiveGapStage(projectId);
          await finish(stage, { stage, ok: true, count });
          break;
        }
        case "patterns": {
          const results = await Promise.allSettled([
            runPatternMiningStage(projectId),
            runAudienceResearchStage(projectId),
          ]);
          const deepCount = await runDeepAnalysisStage(projectId).catch((err) => {
            console.error("Deep analysis failed:", err);
            return 0;
          });
          const failures = results.filter((r) => r.status === "rejected");
          const count =
            results.reduce((sum, r) => sum + (r.status === "fulfilled" ? r.value : 0), 0) + deepCount;
          await finish(stage, {
            stage, ok: failures.length === 0, count,
            error: failures.length > 0 ? `${failures.length} sub-step(s) failed` : undefined,
          });
          break;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "stage failed";
      await finish(stage, { stage, ok: false, count: 0, error: message });
      if (stage === "brand") throw err;
    }

    if (partial) {
      return { done: false, nextStage: stage, stages };
    }
    if (Date.now() > deadline && i < ANALYSIS_STAGES.length - 1) {
      return { done: false, nextStage: ANALYSIS_STAGES[i + 1], stages };
    }
  }

  return { done: true, nextStage: null, stages };
}
