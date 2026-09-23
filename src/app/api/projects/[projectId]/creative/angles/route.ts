import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { LIVE } from "@/services/creative-library";
import { analyzeWithClaude } from "@/services/ai/claude-client";
import { buildAngleGenerationPrompt } from "@/services/ai/prompts/angle-generation";
import {
  getScriptTemplate,
  isVideoType,
  defaultTemplateBatch,
} from "@/services/ai/prompts/script-templates";

export const maxDuration = 120;

const anglesSchema = z.object({
  angles: z.array(
    z.object({
      id: z.number(),
      title: z.string(),
      description: z.string(),
      targetEmotion: z.string(),
      narrativeType: z.string(),
      videoType: z.string().optional().default(""),
      templateIds: z.array(z.string()).optional().default([]),
      predictedScore: z.number(),
      rationale: z.string(),
      targetAudience: z.string(),
      platform: z.string(),
    })
  ),
});

/** Every saved angle, newest generation first. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const angles = await prisma.angle.findMany({
    where: { projectId, ...LIVE },
    orderBy: [{ createdAt: "desc" }, { predictedScore: "desc" }],
  });
  return NextResponse.json({ angles });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { brand: true },
    });
    if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // What the user sent to script context on the Insights page outranks the
    // score-ordered defaults; fall back to top-N only when nothing is picked.
    const [pickedPoints, pickedPatterns, pickedInsights] = await Promise.all([
      prisma.sellingPoint.findMany({ where: { projectId, selected: true }, orderBy: { strength: "desc" } }),
      prisma.narrativePattern.findMany({ where: { projectId, selected: true }, orderBy: { avgPerformance: "desc" } }),
      prisma.insight.findMany({ where: { projectId, selected: true }, orderBy: { importance: "desc" }, take: 8 }),
    ]);

    const sellingPoints = pickedPoints.length
      ? pickedPoints
      : await prisma.sellingPoint.findMany({
          where: { projectId },
          orderBy: { strength: "desc" },
          take: 10,
        });

    const patterns = pickedPatterns.length
      ? pickedPatterns
      : await prisma.narrativePattern.findMany({
          where: { projectId },
          orderBy: { avgPerformance: "desc" },
        });

    const insightBrief = pickedInsights.length
      ? `User-prioritised insights (build angles on these):\n${pickedInsights
          .map((i) => `- ${i.title}: ${i.recommendation || i.description}`)
          .join("\n")}`
      : "";

    const campaignSel = await prisma.campaignSelection.findUnique({ where: { projectId } }).catch(() => null);

    // Get audience data
    const audience = await prisma.audienceProfile.findUnique({ where: { projectId } });
    const segments = (audience?.segments as { name: string; ageRange: string; description: string }[]) || [];
    const painPoints = (audience?.painPoints as { point: string }[]) || [];
    const platforms = (audience?.platforms as { platform: string; adReceptivity: string }[]) || [];

    const prompt = buildAngleGenerationPrompt({
      brandName: project.brandName,
      category: project.category || undefined,
      campaignGoal: project.campaignGoal || undefined,
      brandPromise: project.brand?.brandPromise || undefined,
      valueProposition: project.brand?.valueProposition || undefined,
      topSellingPoints: sellingPoints.map((sp) => `${sp.point} (${sp.category})`),
      topPatterns: patterns.map((p) => `${p.name}: ${p.description.slice(0, 100)}`),
      topSignals: (project.topSignals as string[]) || [],
      audienceSegments: segments.map((s) => `${s.name} (${s.ageRange}): ${s.description}`),
      painPoints: painPoints.map((p) => p.point),
      platformPreferences: platforms.filter((p) => p.adReceptivity === "high").map((p) => p.platform),
      briefing:
        [project.briefingText, project.briefingParsed, insightBrief].filter(Boolean).join("\n\n") ||
        undefined,
      platformId: (campaignSel?.platform as string | null) || undefined,
    });

    const result = await analyzeWithClaude({
      systemPrompt: prompt.system,
      userPrompt: prompt.user,
      responseSchema: anglesSchema,
      maxTokens: 5000,
    });

    const platformId = (campaignSel?.platform as string | null) || undefined;
    const angles = result.angles.map((angle) => {
      const templates = angle.templateIds
        .map((id) => getScriptTemplate(id))
        .filter((t): t is NonNullable<typeof t> => t !== null)
        .slice(0, 2);
      const raw = angle.videoType?.toUpperCase() ?? "";
      const videoType = isVideoType(raw)
        ? raw
        : templates[0]?.videoType ?? "PRODUCT_INTRO";
      const resolved = templates.length
        ? templates
        : defaultTemplateBatch(platformId, 2).filter((t) => t.videoType === videoType).slice(0, 2);
      return {
        ...angle,
        videoType,
        templateIds: (resolved.length ? resolved : defaultTemplateBatch(platformId, 2)).map((t) => t.id),
      };
    });

    // Saved as a new batch — earlier generations stay available.
    const batchId = randomUUID();
    const saved = await prisma.$transaction(
      angles.map((a) =>
        prisma.angle.create({
          data: {
            projectId,
            batchId,
            title: a.title,
            description: a.description,
            targetEmotion: a.targetEmotion || null,
            narrativeType: a.narrativeType || null,
            videoType: a.videoType,
            templateIds: a.templateIds,
            predictedScore: a.predictedScore,
            rationale: a.rationale || null,
            targetAudience: a.targetAudience || null,
            platform: a.platform || null,
          },
        })
      )
    );

    return NextResponse.json({ angles: saved, batchId });
  } catch (err) {
    console.error("Angle generation failed:", err);
    return NextResponse.json(
      { error: "Failed to generate angles" },
      { status: 500 }
    );
  }
}
