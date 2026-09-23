import { randomUUID } from "node:crypto";
import { NextResponse, after } from "next/server";
import { createJob, failJob, runJobItems, runningJob } from "@/services/jobs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { LIVE } from "@/services/creative-library";
import { creativeDirectionLine, narrativeTypesFor } from "@/lib/style-categories";
import type { NarrativeType } from "@/generated/prisma/enums";
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
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const body = (await request.json().catch(() => ({}))) as { background?: boolean };

  const exists = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (body.background) {
    const running = await runningJob(projectId, "angles");
    if (running) return NextResponse.json({ jobId: running.id, reused: true }, { status: 202 });
    const item = { key: "angles", label: "Generate 10 ad angles" };
    const job = await createJob(projectId, "angles", [item]);
    after(() =>
      runJobItems(job.id, [item], (i) => i, async () => {
        const saved = await generateAngles(projectId);
        return { id: saved.batchId };
      }).catch((err) => failJob(job.id, err))
    );
    return NextResponse.json({ jobId: job.id }, { status: 202 });
  }

  try {
    return NextResponse.json(await generateAngles(projectId));
  } catch (err) {
    console.error("Angle generation failed:", err);
    return NextResponse.json({ error: "Failed to generate angles" }, { status: 500 });
  }
}

/** Generate one batch of angles and save it. Throws on failure. */
async function generateAngles(projectId: string) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { brand: true },
    });
    if (!project) throw new Error("Project not found");

    const campaignSel = await prisma.campaignSelection.findUnique({ where: { projectId } }).catch(() => null);
    // Chosen styles restrict which mined patterns feed the prompt.
    const styleTypes = narrativeTypesFor(campaignSel?.styleCategories);
    const typeFilter = styleTypes.length ? { type: { in: styleTypes as NarrativeType[] } } : {};

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
          where: { projectId, dismissed: false },
          orderBy: { strength: "desc" },
          take: 10,
        });

    const patterns = pickedPatterns.length
      ? pickedPatterns
      : await prisma.narrativePattern.findMany({
          where: { projectId, dismissed: false, ...typeFilter },
          orderBy: { avgPerformance: "desc" },
        });

    const insightBrief = pickedInsights.length
      ? `User-prioritised insights (build angles on these):\n${pickedInsights
          .map((i) => `- ${i.title}: ${i.recommendation || i.description}`)
          .join("\n")}`
      : "";
    const direction = creativeDirectionLine(project.goalType, campaignSel?.styleCategories);

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
        [direction, project.briefingText, project.briefingParsed, insightBrief].filter(Boolean).join("\n\n") ||
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

    return { angles: saved, batchId };
}
