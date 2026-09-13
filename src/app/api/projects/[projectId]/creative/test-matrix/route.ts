import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { analyzeWithClaude } from "@/services/ai/claude-client";
import { buildTestMatrixPrompt } from "@/services/ai/prompts/test-matrix";
import {
  templatesForPlatform,
  getScriptTemplate,
  isVideoType,
  type ScriptTemplate,
} from "@/services/ai/prompts/script-templates";
import { withIdempotency } from "@/lib/idempotency";
import { NarrativeType } from "@/generated/prisma/enums";

export const maxDuration = 300;

const matrixSchema = z.object({
  variants: z.array(
    z.object({
      hookVariant: z.string(),
      narrativeType: z.string(),
      ctaVariant: z.string(),
      templateId: z.string().optional().default(""),
      videoType: z.string().optional().default(""),
      predictedScore: z.coerce.number(),
      rationale: z.string().optional().default(""),
      scriptOutline: z.string().optional().default(""),
    })
  ),
});

const validTypes: NarrativeType[] = [
  "PROBLEM_SOLUTION", "TESTIMONIAL", "DEMONSTRATION", "LIFESTYLE",
  "EDUCATIONAL", "COMPARISON", "STORY_ARC", "UGC_STYLE",
  "TREND_RIDING", "BEFORE_AFTER",
];

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const rows = await prisma.creativeVariant.findMany({
    where: { projectId },
    orderBy: { predictedScore: "desc" },
  });
  // `format` stores the template id; re-hydrate the registry metadata for the UI.
  const variants = rows.map((v) => {
    const template = getScriptTemplate(v.format);
    return {
      ...v,
      templateId: template?.id ?? v.format,
      templateName: template?.name ?? v.format,
      videoType: template?.videoType ?? "",
    };
  });
  return NextResponse.json({ variants });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const idem = await withIdempotency<unknown>(request, {
    route: "creative/test-matrix",
    projectId,
  });
  if (idem.replay && idem.response) return idem.response;

  try {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const [scripts, campaignSel, brandKit] = await Promise.all([
      prisma.script.findMany({ where: { projectId }, take: 5, orderBy: { createdAt: "desc" } }),
      prisma.campaignSelection.findUnique({ where: { projectId } }).catch(() => null),
      prisma.brandKit.findUnique({ where: { projectId } }).catch(() => null),
    ]);

    const platformId = (campaignSel?.platform as string | null) || undefined;
    const templates = templatesForPlatform(platformId);

    const hooks = scripts.flatMap((s) =>
      (Array.isArray(s.hookVariants) ? (s.hookVariants as string[]) : []).slice(0, 2)
    );
    const scriptCtas = scripts.flatMap((s) =>
      (Array.isArray(s.ctaVariants) ? (s.ctaVariants as string[]) : []).slice(0, 2)
    );
    const brandCtas = (Array.isArray(brandKit?.ctaOptions) ? brandKit.ctaOptions : [])
      .map((c) => (c as { text?: string })?.text)
      .filter((t): t is string => Boolean(t));
    const ctas = brandCtas.length ? brandCtas : scriptCtas;

    const narrativeTypes = [
      "PROBLEM_SOLUTION", "TESTIMONIAL", "DEMONSTRATION",
      "UGC_STYLE", "BEFORE_AFTER",
    ];

    const prompt = buildTestMatrixPrompt({
      brandName: project.brandName,
      hooks: hooks.length > 0 ? hooks : ["Bold claim hook", "Pain point hook", "Curiosity hook"],
      narrativeTypes,
      ctas: ctas.length > 0 ? ctas : ["Shop Now", "Learn More", "Try It Today"],
      templates,
      platformId,
      totalDurationSec: (campaignSel?.totalDurationSec as number | null) || 30,
    });

    const result = await analyzeWithClaude({
      systemPrompt: prompt.system,
      userPrompt: prompt.user,
      responseSchema: matrixSchema,
      maxTokens: 10000,
    });

    const fallbackTemplates = templates.length ? templates : [];
    const variants = result.variants.map((variant, i) => {
      const template: ScriptTemplate | null =
        getScriptTemplate(variant.templateId) ??
        fallbackTemplates[i % Math.max(1, fallbackTemplates.length)] ??
        null;
      const rawType = variant.videoType?.toUpperCase() ?? "";
      const videoType = template
        ? template.videoType
        : isVideoType(rawType)
          ? rawType
          : "PRODUCT_INTRO";
      return {
        hookVariant: variant.hookVariant,
        narrativeType: validTypes.includes(variant.narrativeType as NarrativeType)
          ? (variant.narrativeType as NarrativeType)
          : "DEMONSTRATION",
        ctaVariant: variant.ctaVariant,
        templateId: template?.id ?? "",
        templateName: template?.name ?? "",
        videoType,
        predictedScore: variant.predictedScore,
        rationale: variant.rationale,
        scriptOutline: variant.scriptOutline,
      };
    });

    await prisma.creativeVariant.createMany({
      data: variants.map((v) => ({
        projectId,
        hookVariant: v.hookVariant,
        narrativeType: v.narrativeType,
        ctaVariant: v.ctaVariant,
        format: v.templateId,
        predictedScore: v.predictedScore,
        rationale: v.rationale,
        scriptOutline: v.scriptOutline,
      })),
    });

    const payload = { variants };
    await idem.commit?.(payload, 200);
    return NextResponse.json(payload);
  } catch (err) {
    console.error("Test matrix generation failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate test matrix" },
      { status: 500 }
    );
  }
}
