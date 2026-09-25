/**
 * POST — fills empty Setup-page fields (Product Definition + Campaign Context)
 * with a best-guess suggestion and marks them "suggested" in Project.fieldStatus.
 * Never overwrites a field that already has a value (suggested or confirmed).
 *
 * Auto-called once per project (guarded by fieldStatus.__suggestedAt, see
 * src/lib/setup-suggest.ts) when the Setup sections mount with empty fields,
 * and re-runnable any time via the "Suggest answers" button.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { analyzeWithClaude } from "@/services/ai/claude-client";
import { readStatusMap } from "@/lib/field-status";
import {
  AISuggestionSchema,
  applySuggestions,
  buildSetupSuggestPrompt,
  campaignFieldKey,
  isEmptyField,
  SUGGESTED_AT_KEY,
  type SetupSuggestInput,
} from "@/lib/setup-suggest";

export const maxDuration = 30;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  const [project, campaignSelection] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: {
        brandName: true,
        category: true,
        productName: true,
        productPageTitle: true,
        productPageText: true,
        brandUrl: true,
        briefingText: true,
        campaignGoal: true,
        goalType: true,
        fieldStatus: true,
        brand: { select: { productCategory: true, productDescription: true, targetAudience: true } },
      },
    }),
    prisma.campaignSelection.findUnique({
      where: { projectId },
      select: { platform: true, selectedEnvironment: true, selectedActorRole: true },
    }),
  ]);

  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const input: SetupSuggestInput = {
    project: {
      brandName: project.brandName,
      category: project.category,
      productName: project.productName,
      productPageTitle: project.productPageTitle,
      productPageText: project.productPageText,
      brandUrl: project.brandUrl,
      briefingText: project.briefingText,
      campaignGoal: project.campaignGoal,
      goalType: project.goalType,
    },
    brand: project.brand,
    campaignSelection,
  };

  const emptyFields = {
    campaignGoal: isEmptyField(project.campaignGoal),
    goalType: isEmptyField(project.goalType),
    platform: isEmptyField(campaignSelection?.platform),
  };

  // Nothing to do — every field already has a value.
  if (!emptyFields.campaignGoal && !emptyFields.goalType && !emptyFields.platform) {
    return NextResponse.json({ filled: [], project, campaignSelection });
  }

  const { systemPrompt, userPrompt } = buildSetupSuggestPrompt(input);
  const suggestion = await analyzeWithClaude({
    systemPrompt,
    userPrompt,
    responseSchema: AISuggestionSchema,
    tier: "fast",
    maxTokens: 512,
  }).catch(() => null);

  const currentStatus = readStatusMap(project.fieldStatus);
  const filled: string[] = [];

  let updatedProject = project;
  if (suggestion) {
    const { projectData, statusPatch } = applySuggestions(
      { campaignGoal: project.campaignGoal, goalType: project.goalType },
      suggestion
    );

    const nextStatus = { ...currentStatus, ...statusPatch, [SUGGESTED_AT_KEY]: new Date().toISOString() };
    filled.push(...Object.keys(statusPatch));

    if (Object.keys(projectData).length > 0 || true) {
      updatedProject = await prisma.project.update({
        where: { id: projectId },
        data: { ...projectData, fieldStatus: nextStatus as never },
        select: {
          brandName: true,
          category: true,
          productName: true,
          productPageTitle: true,
          productPageText: true,
          brandUrl: true,
          briefingText: true,
          campaignGoal: true,
          goalType: true,
          fieldStatus: true,
          brand: { select: { productCategory: true, productDescription: true, targetAudience: true } },
        },
      });
    }

    // Platform lives on CampaignSelection but its review state is tracked in
    // Project.fieldStatus (keys prefixed "campaign.") per the shared convention.
    if (emptyFields.platform && suggestion.platform) {
      await prisma.campaignSelection.upsert({
        where: { projectId },
        create: { projectId, platform: suggestion.platform },
        update: { platform: suggestion.platform },
      });
      filled.push("campaign.platform");
      await prisma.project.update({
        where: { id: projectId },
        data: { fieldStatus: { ...nextStatus, [campaignFieldKey("platform")]: "suggested" } as never },
      });
    }
  } else {
    // AI unavailable — still mark that we tried, so auto-run doesn't retry every load.
    await prisma.project.update({
      where: { id: projectId },
      data: { fieldStatus: { ...currentStatus, [SUGGESTED_AT_KEY]: new Date().toISOString() } as never },
    });
  }

  const finalCampaignSelection = await prisma.campaignSelection.findUnique({ where: { projectId } });

  return NextResponse.json({ filled, project: updatedProject, campaignSelection: finalCampaignSelection });
}
