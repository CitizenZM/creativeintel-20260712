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
  sellingPoints: string[];
  platformId?: string;
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
      prisma.sellingPoint.findMany({
        where: { projectId },
        orderBy: { strength: "desc" },
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

  const teardowns = await loadTeardownHighlights(projectId);

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
    sellingPoints: sellingPoints.map((sp) => sp.point),
    platformId,
    totalDurationSec: (campaignSel?.totalDurationSec as number | null) || 30,
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
  };
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
  }
): ScriptInput {
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
  };
}

/** Brand-kit fields `auditScriptClaims` needs, pulled from the loaded context. */
export function auditContext(ctx: ScriptContext): ScriptClaimsAuditInput {
  return {
    claimsAllowed: ctx.claimsAllowed,
    claimsForbidden: ctx.claimsForbidden,
    ctaOptions: ctx.ctaPool,
    offerText: ctx.offer,
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
  opts: { template: ScriptTemplate; videoType: VideoType; totalDurationSec: number; angleTitle?: string }
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
    },
  });
}
