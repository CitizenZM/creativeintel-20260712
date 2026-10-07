import { chosenStructure } from "@/services/structures";
import { loadLearning } from "@/services/performance/store";
import { renderLearningBlock } from "@/services/performance/learn";
import { timingEvidence, type ReferenceAd, type TeardownTiming, type TimingEvidence } from "@/lib/attention-blueprint";
import { prisma } from "@/lib/db";
import { getBrandTruthForPrompts, type BrandCtaOption } from "@/services/brand-kit";
import type {
  ScriptInput,
  DeepAnalysisBlocks,
  TeardownHighlight,
} from "@/services/ai/prompts/script-writing";
import type { ScriptTemplate, VideoType } from "@/services/ai/prompts/script-templates";
import {
  renderScriptBody,
  resolveVideoType,
  validateAndRepairDurations,
  type ScriptClaimsAuditInput,
  type ScriptClaimsViolation,
  type ScriptV2,
} from "@/lib/script-schema";
import { NarrativeType } from "@/generated/prisma/enums";
import { creativeDirectionLine, sanitizeStyleCategories } from "@/lib/style-categories";
import type { CampaignPlan, PlatformPlan } from "@/services/creative/campaign-plan.types";
import { campaignToPlatform, creativeBlock as creativeBlockFn, type CreativeBlockInput } from "@/services/creative/prompt-blocks";
import type { ProductBrief } from "@/services/creative/product-brief";

const VALID_NARRATIVE_TYPES: NarrativeType[] = [
  "PROBLEM_SOLUTION",
  "TESTIMONIAL",
  "DEMONSTRATION",
  "LIFESTYLE",
  "EDUCATIONAL",
  "COMPARISON",
  "STORY_ARC",
  "UGC_STYLE",
  "TREND_RIDING",
  "BEFORE_AFTER",
];

export function coerceNarrativeType(raw: unknown): NarrativeType {
  const up = typeof raw === "string" ? raw.toUpperCase() : "";
  return VALID_NARRATIVE_TYPES.includes(up as NarrativeType)
    ? (up as NarrativeType)
    : "DEMONSTRATION";
}

export interface ScriptAngle {
  title: string;
  description: string;
  targetEmotion: string;
  narrativeType: string;
  predictedScore?: number;
}

export interface ScriptContext {
  project: {
    id: string;
    brandName: string;
    productName: string | null;
    productPageTitle: string | null;
    productPageText: string | null;
    campaignGoal: string | null;
    briefingText: string | null;
  };
  goalType: string | null;
  styleCategories: string[];
  sellingPoints: string[];
  platformId?: string;
  /** Research block for the script prompt (platform rules + sp-1 brief + playbook + chosen hooks/end card or plan). */
  creativeBlock?: string;
  /** Inputs of creativeBlock, so each script of a batch can follow its own plan hook variant. */
  creativeInput?: CreativeBlockInput;
  /** The stored campaign plan for this run's platform (Project.campaignPlan), when there is one. */
  campaignPlan?: PlatformPlan | null;
  /** Next plan hook variant to hand out (rotates across the scripts of a batch). */
  planHookCursor?: number;
  /** Real facts from the brief + plan; numbers in them count as sourced in the claims audit. */
  briefFacts?: string;
  /** Legal layer on (CREATIVE_STRICT_COMPLIANCE=true or a plan made in strict mode). Default off. */
  strictCompliance?: boolean;
  totalDurationSec: number;
  selectedEnvironment?: string;
  environmentNotes?: string;
  selectedActorRole?: string;
  selectedActorDesc?: string;
  videoTimeline?: ScriptInput["videoTimeline"];
  hookFormulas?: ScriptInput["hookFormulas"];
  cameraAngles?: ScriptInput["cameraAngles"];
  audienceSummary?: string;
  nicheResearch?: string;
  brandTruth?: string;
  ctaPool?: string[];
  offer?: string;
  landingUrl?: string;
  claimsAllowed?: string[];
  claimsForbidden?: string[];
  deepAnalysis: DeepAnalysisBlocks;
  teardowns: TeardownHighlight[];
  timingEvidence: TimingEvidence | null;
  referenceAd: ReferenceAd | null;
  performanceBlock: string | null;
}

/**
 * Load every input the script writer can use, once, so the single-script and
 * batch routes feed the prompt from an identical set.
 */
export async function loadScriptContext(projectId: string): Promise<ScriptContext | null> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) return null;

  const [sellingPoints, campaignSel, deepAnal, audienceData, brandKit, brandTruth] =
    await Promise.all([
      // Points the user sent to script context lead; the strongest others fill
      // the remaining slots.
      prisma.sellingPoint.findMany({
        where: { projectId, dismissed: false },
        orderBy: [{ selected: "desc" }, { strength: "desc" }],
        take: 5,
      }),
      prisma.campaignSelection.findUnique({ where: { projectId } }).catch(() => null),
      prisma.deepAnalysis.findUnique({ where: { projectId } }).catch(() => null),
      prisma.audienceProfile.findUnique({ where: { projectId } }).catch(() => null),
      prisma.brandKit.findUnique({ where: { projectId } }).catch(() => null),
      getBrandTruthForPrompts(projectId).catch(() => ""),
    ]);

  const platformId = (campaignSel?.platform as string | null) || undefined;

  let nicheResearch: string | undefined;
  if (deepAnal?.platformInsights) {
    const insights = deepAnal.platformInsights as Array<{
      platform: string;
      contentStyle?: string;
      bestPractices?: string[];
      avoidPatterns?: string[];
    }>;
    const relevant = platformId
      ? insights.filter((i) => i.platform?.toLowerCase() === platformId.toLowerCase())
      : insights;
    const chosen = (relevant.length ? relevant : insights).slice(0, 2);
    const lines: string[] = [];
    for (const i of chosen) {
      if (i.contentStyle) lines.push(`[${i.platform}] ${i.contentStyle}`);
      if (i.bestPractices?.length) lines.push(`Best practices: ${i.bestPractices.slice(0, 3).join("; ")}`);
      if (i.avoidPatterns?.length) lines.push(`Avoid: ${i.avoidPatterns.slice(0, 2).join("; ")}`);
    }
    if (lines.length) nicheResearch = lines.join("\n").slice(0, 1500);
  }

  const pickedInsights = await prisma.insight.findMany({
    where: { projectId, selected: true },
    orderBy: { importance: "desc" },
    take: 6,
    select: { title: true, description: true, recommendation: true },
  });
  if (pickedInsights.length) {
    const picked = `User-prioritised insights:\n${pickedInsights
      .map((i) => `- ${i.title}: ${i.recommendation || i.description}`)
      .join("\n")}`;
    nicheResearch = [picked, nicheResearch].filter(Boolean).join("\n\n").slice(0, 2200);
  }

  // Goal and chosen styles lead: they are the brief every script must follow.
  const direction = creativeDirectionLine(project.goalType, campaignSel?.styleCategories);
  if (direction) nicheResearch = [direction, nicheResearch].filter(Boolean).join("\n\n").slice(0, 2800);

  const [teardowns, timing, referenceAd, learning] = await Promise.all([
    loadTeardownHighlights(projectId),
    loadTimingEvidence(projectId),
    chosenStructure(projectId).then((picked) => picked ?? loadReferenceAd(projectId)),
    loadLearning(projectId),
  ]);

  const ctaOptions = (
    Array.isArray(brandKit?.ctaOptions) ? brandKit.ctaOptions : []
  ) as unknown as BrandCtaOption[];
  const ctaPool = ctaOptions
    .slice()
    .sort((a, b) => (a?.priority ?? 99) - (b?.priority ?? 99))
    .map((c) => c?.text)
    .filter((t): t is string => Boolean(t));

  const claimsAllowed = (
    Array.isArray(brandKit?.claimsAllowed) ? (brandKit.claimsAllowed as unknown[]) : []
  ).filter((c): c is string => typeof c === "string" && c.trim().length > 0);
  const claimsForbidden = (
    Array.isArray(brandKit?.claimsForbidden) ? (brandKit.claimsForbidden as unknown[]) : []
  ).filter((c): c is string => typeof c === "string" && c.trim().length > 0);

  // Research-backed creative block: platform profile + stored sp-1 brief + playbook + hooks/end card
  // for this goal — or, when a campaign plan is stored for this platform, the plan's beat map.
  const brief = (project as { productBrief?: unknown }).productBrief as ProductBrief | null | undefined;
  const storedPlan = (project as { campaignPlan?: unknown }).campaignPlan as CampaignPlan | null | undefined;
  const platformPlan = pickPlatformPlan(storedPlan, platformId, campaignToPlatform);
  const strictCompliance = process.env.CREATIVE_STRICT_COMPLIANCE === "true" || storedPlan?.strictCompliance === true;
  const totalDurationSec = (campaignSel?.totalDurationSec as number | null) || platformPlan?.durationSec || 30;
  const creativeInput: CreativeBlockInput = {
    brief: brief?.sellingPoints ? brief : null,
    platform: platformId,
    goalText: [project.campaignGoal, (project as { goalType?: string | null }).goalType, brandKit?.offerText].filter(Boolean).join(" "),
    ...(platformPlan && storedPlan ? { plan: platformPlan, goal: storedPlan.goal, promo: storedPlan.promo, runDate: storedPlan.runDate } : {}),
    strictCompliance,
    targetSec: totalDurationSec,
  };
  const creative = creativeBlockFn(creativeInput);

  return {
    project: {
      id: project.id,
      brandName: project.brandName,
      productName: project.productName,
      productPageTitle: project.productPageTitle,
      productPageText: project.productPageText,
      campaignGoal: project.campaignGoal,
      briefingText: project.briefingText,
    },
    goalType: project.goalType,
    styleCategories: sanitizeStyleCategories(campaignSel?.styleCategories),
    // The ranked, filmable brief wins over legacy mined points when it exists.
    sellingPoints: brief?.sellingPoints?.length ? brief.sellingPoints.slice(0, 6).map((sp) => `${sp.claim} → ${sp.benefit}`) : sellingPoints.map((sp) => sp.point),
    platformId,
    creativeBlock: creative.text,
    creativeInput,
    campaignPlan: platformPlan,
    planHookCursor: 0,
    briefFacts: briefFacts(brief, platformPlan) || undefined,
    strictCompliance,
    totalDurationSec,
    selectedEnvironment: (campaignSel?.selectedEnvironment as string | null) || undefined,
    environmentNotes: (campaignSel?.selectedEnvNotes as string | null) || undefined,
    selectedActorRole: (campaignSel?.selectedActorRole as string | null) || undefined,
    selectedActorDesc: (campaignSel?.selectedActorDesc as string | null) || undefined,
    videoTimeline:
      (campaignSel?.videoTimeline as ScriptInput["videoTimeline"] | null) || undefined,
    hookFormulas:
      (deepAnal?.hookFormulas as ScriptInput["hookFormulas"] | null)?.slice(0, 3) || undefined,
    cameraAngles:
      (deepAnal?.cameraAngles as ScriptInput["cameraAngles"] | null)?.slice(0, 5) || undefined,
    audienceSummary: audienceData
      ? `Audience: ${(audienceData.segments as { name: string }[] | null)?.[0]?.name || "general"}, pain: ${
          ((audienceData.painPoints as Array<string | { point?: string }> | null) ?? [])
            .slice(0, 2)
            .map((p) => (typeof p === "string" ? p : p?.point))
            .filter(Boolean)
            .join(", ") || ""
        }`
      : undefined,
    nicheResearch,
    brandTruth: brandTruth || undefined,
    ctaPool: ctaPool.length ? ctaPool : undefined,
    offer: brandKit?.offerText || undefined,
    landingUrl: brandKit?.landingUrl || undefined,
    claimsAllowed: claimsAllowed.length ? claimsAllowed : undefined,
    claimsForbidden: claimsForbidden.length ? claimsForbidden : undefined,
    deepAnalysis: {
      sellingPointVisuals: deepAnal?.sellingPointVisuals ?? undefined,
      ctaAnalysis: deepAnal?.ctaAnalysis ?? undefined,
      competitiveGaps: deepAnal?.competitiveGaps ?? undefined,
      videoStructure: deepAnal?.videoStructure ?? undefined,
      vibeAnalysis: deepAnal?.vibeAnalysis ?? undefined,
      environmentAnalysis: deepAnal?.environmentAnalysis ?? undefined,
    },
    teardowns,
    timingEvidence: timing,
    referenceAd,
    performanceBlock: renderLearningBlock(learning) || null,
  };
}

/** The plan for the run's platform; with no campaign platform chosen, the plan's first platform. */
export function pickPlatformPlan(
  plan: CampaignPlan | null | undefined,
  platformId: string | undefined,
  toPlatform: (id?: string | null) => string
): PlatformPlan | null {
  if (!plan || !Array.isArray(plan.platforms) || !plan.platforms.length) return null;
  if (!platformId) return plan.platforms[0];
  const want = toPlatform(platformId);
  return plan.platforms.find((p) => p.platform === want || p.platform === platformId) ?? null;
}

/** The brief's and plan's own facts (claims, evidence, offer copy) — sourced text for the claims audit. */
export function briefFacts(brief: ProductBrief | null | undefined, plan: PlatformPlan | null | undefined): string {
  const parts: string[] = [];
  for (const p of brief?.sellingPoints ?? []) {
    parts.push(p.claim, p.benefit, p.proofVisual?.overlayText ?? "", ...(p.sourceEvidence ?? []).map((e) => e.quote));
  }
  if (brief?.product?.price) parts.push(String(brief.product.price));
  if (plan) {
    parts.push(plan.endCard.headline ?? "", plan.endCard.button, ...Object.values(plan.endCard.data ?? {}).map(String));
    for (const b of plan.beats) parts.push(b.onScreenText ?? "", b.vo ?? "");
    for (const h of plan.hookVariants) parts.push(h.openingText, h.openingVO);
  }
  return parts.filter((s) => s && s.trim()).join("\n").slice(0, 6000);
}

/** The most-viewed competitor ad with a beat-level teardown — the structure to emulate. */
export async function loadReferenceAd(projectId: string): Promise<ReferenceAd | null> {
  try {
    const rows = await prisma.adTeardown.findMany({
      where: { projectId, competitorId: { not: null } },
      select: {
        hookType: true,
        hookText: true,
        whyItWorks: true,
        beats: true,
        competitor: { select: { name: true } },
        contentAsset: { select: { title: true, viewCount: true, overallScore: true } },
      },
      take: 60,
    });
    const usable = rows
      .map((r) => ({ r, beats: Array.isArray(r.beats) ? (r.beats as ReferenceAd["beats"]) : [] }))
      .filter((x) => x.beats.length >= 3);
    if (!usable.length) return null;
    usable.sort(
      (a, b) =>
        (b.r.contentAsset?.viewCount ?? 0) - (a.r.contentAsset?.viewCount ?? 0) ||
        (b.r.contentAsset?.overallScore ?? 0) - (a.r.contentAsset?.overallScore ?? 0)
    );
    const { r, beats } = usable[0];
    return {
      title: r.contentAsset?.title ?? "Competitor ad",
      owner: r.competitor?.name ?? null,
      viewCount: r.contentAsset?.viewCount ?? null,
      hookType: r.hookType,
      hookText: r.hookText,
      whyItWorks: r.whyItWorks,
      beats,
    };
  } catch {
    return null;
  }
}

/** Pace of this project's torn-down competitor ads (hook length, beat length, CTA timing, top hooks). */
export async function loadTimingEvidence(projectId: string): Promise<TimingEvidence | null> {
  try {
    const rows = await prisma.adTeardown.findMany({
      where: { projectId },
      select: { hookType: true, beats: true, contentAsset: { select: { durationSec: true } } },
      take: 60,
    });
    if (!rows.length) return null;
    return timingEvidence(
      rows.map((r) => ({
        hookType: r.hookType,
        beats: Array.isArray(r.beats) ? (r.beats as TeardownTiming["beats"]) : [],
        durationSec: r.contentAsset?.durationSec ?? null,
      }))
    );
  } catch {
    return null;
  }
}

/** Top competitor ad teardowns, newest/highest-ranked first. Empty when none exist. */
export async function loadTeardownHighlights(projectId: string): Promise<TeardownHighlight[]> {
  try {
    const rows = await prisma.adTeardown.findMany({
      where: { projectId },
      orderBy: [{ rank: "asc" }, { createdAt: "desc" }],
      take: 5,
      include: { competitor: { select: { name: true } } },
    });
    return rows.map((t) => ({
      competitor: t.competitor?.name ?? undefined,
      hookType: t.hookType || undefined,
      hookText: t.hookText || undefined,
      ctaText: t.ctaText || undefined,
      offer: t.offer || undefined,
    }));
  } catch {
    return [];
  }
}

export function buildScriptInput(
  ctx: ScriptContext,
  opts: {
    template: ScriptTemplate;
    videoType: VideoType;
    angle?: ScriptAngle;
    totalDurationSec?: number;
    customBrief?: string;
    /** Which plan hook variant this script opens with; default: rotate through the variants. */
    planHookIndex?: number;
  }
): ScriptInput {
  // With a stored plan, each script follows the plan's beat map with its own hook variant.
  let creativeBlock = ctx.creativeBlock;
  if (ctx.campaignPlan && ctx.creativeInput) {
    const hookIndex = opts.planHookIndex ?? ctx.planHookCursor ?? 0;
    if (opts.planHookIndex === undefined) ctx.planHookCursor = hookIndex + 1;
    creativeBlock = creativeBlockFn({ ...ctx.creativeInput, hookIndex, targetSec: opts.totalDurationSec || ctx.totalDurationSec }).text;
  }
  return {
    brandName: ctx.project.brandName,
    productName: ctx.project.productPageTitle || ctx.project.productName || undefined,
    productDescription: ctx.project.productPageText?.slice(0, 500) || undefined,
    template: opts.template,
    videoType: opts.videoType,
    angle: opts.angle,
    sellingPoints: ctx.sellingPoints,
    campaignGoal: ctx.project.campaignGoal || undefined,
    platform: ctx.platformId,
    platformId: ctx.platformId,
    totalDurationSec: opts.totalDurationSec || ctx.totalDurationSec,
    selectedEnvironment: ctx.selectedEnvironment,
    environmentNotes: ctx.environmentNotes,
    selectedActorRole: ctx.selectedActorRole,
    selectedActorDesc: ctx.selectedActorDesc,
    videoTimeline: ctx.videoTimeline,
    hookFormulas: ctx.hookFormulas,
    cameraAngles: ctx.cameraAngles,
    briefing: ctx.project.briefingText || undefined,
    customBrief: opts.customBrief,
    creativeBlock,
    strictCompliance: ctx.strictCompliance,
    audienceSummary: ctx.audienceSummary,
    nicheResearch: ctx.nicheResearch,
    brandTruth: ctx.brandTruth,
    ctaPool: ctx.ctaPool,
    offer: ctx.offer,
    landingUrl: ctx.landingUrl,
    claimsAllowed: ctx.claimsAllowed,
    claimsForbidden: ctx.claimsForbidden,
    deepAnalysis: ctx.deepAnalysis,
    teardowns: ctx.teardowns,
    timingEvidence: ctx.timingEvidence,
    referenceAd: ctx.referenceAd,
    performanceBlock: ctx.performanceBlock,
  };
}

/** Brand-kit fields `auditScriptClaims` needs, pulled from the loaded context. */
export function auditContext(ctx: ScriptContext): ScriptClaimsAuditInput {
  // The only place a number/percentage/count/ratio/star-rating/review-count
  // claim in a script is allowed to come from — brand truth, the project
  // briefing, the approved claims list, and the approved offer text.
  const sourceText = [
    ctx.brandTruth,
    ctx.project.briefingText,
    ctx.claimsAllowed?.join("\n"),
    ctx.offer,
    ctx.briefFacts,
  ]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join("\n\n");

  return {
    claimsAllowed: ctx.claimsAllowed,
    claimsForbidden: ctx.claimsForbidden,
    ctaOptions: ctx.ctaPool,
    offerText: ctx.offer,
    sourceText,
    strictCompliance: ctx.strictCompliance,
  };
}

/** Render a violation list as the "fix these lines" addendum for a regeneration pass. */
export function formatComplianceViolations(violations: ScriptClaimsViolation[]): string {
  return violations.map((v) => `- [${v.path}] "${v.text}" — ${v.reason}`).join("\n");
}

/**
 * Repair durations in code, render the labelled body, and persist every v2
 * column. Shared by the single and batch script routes so the two paths can
 * never drift.
 */
export async function persistScript(
  projectId: string,
  raw: ScriptV2,
  opts: {
    template: ScriptTemplate;
    videoType: VideoType;
    totalDurationSec: number;
    angleTitle?: string;
    /** Violations the rewrite didn't fix, shown on the script card. */
    complianceNotes?: string[];
  }
) {
  const script = validateAndRepairDurations(raw, opts.totalDurationSec);
  const videoType = resolveVideoType(script.videoType, opts.videoType);

  return prisma.script.create({
    data: {
      projectId,
      title: script.title,
      angle: script.angle || opts.angleTitle || opts.template.name,
      format: script.format || opts.template.id,
      duration: script.duration || `${script.totalDurationSec}s`,
      platform: script.platform || undefined,
      totalDurationSec: script.totalDurationSec,
      videoType,
      template: opts.template.id,
      hook: script.hook as never,
      bodyBeats: script.body as never,
      cta: script.cta as never,
      hookVariants: script.hookVariants,
      body: renderScriptBody(script),
      ctaVariants: script.ctaVariants,
      narrativeType: coerceNarrativeType(script.narrativeType),
      targetEmotion: script.targetEmotion,
      predictedScore: script.predictedScore,
      scenes: script.scenes as never,
      platformTechniques: script.platformTechniques as never,
      complianceNotes: opts.complianceNotes?.length ? (opts.complianceNotes as never) : undefined,
    },
  });
}
