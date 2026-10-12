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
import { withAccess } from "@/lib/auth/route-guard";
import { patchProject } from "@/services/row-patch";

export const maxDuration = 30;

async function unguardedPOST(
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

  const filled: string[] = [];

  const PROJECT_RETURN = {
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
  } as const;

  let updatedProject = project;
  if (suggestion) {
    // The model call above takes seconds: "is the field still empty?" is decided NOW, against the
    // current rows, so a value the user typed meanwhile is never overwritten by the guess.
    let platformFilled = false;
    if (emptyFields.platform && suggestion.platform) {
      const selection = await prisma.campaignSelection.findUnique({ where: { projectId }, select: { platform: true } });
      if (!selection) {
        await prisma.campaignSelection.create({ data: { projectId, platform: suggestion.platform } }).then(
          () => (platformFilled = true),
          () => undefined // lost a create race: someone else made the row — fall through to the conditional fill
        );
      }
      if (!platformFilled) {
        // Conditional write: only a row whose platform is still empty takes the suggestion.
        const { count } = await prisma.campaignSelection.updateMany({
          where: { projectId, OR: [{ platform: null }, { platform: "" }] },
          data: { platform: suggestion.platform },
        });
        platformFilled = count > 0;
      }
    }

    // Project fields + review marks: decided and merged against the CURRENT row (retried on conflict).
    await patchProject<{ campaignGoal: string | null; goalType: string | null; fieldStatus: unknown }>(
      projectId,
      (row) => {
        const { projectData, statusPatch } = applySuggestions({ campaignGoal: row.campaignGoal, goalType: row.goalType }, suggestion);
        // Platform lives on CampaignSelection but its review state is tracked in
        // Project.fieldStatus (keys prefixed "campaign.") per the shared convention.
        const platformPatch = platformFilled ? { [campaignFieldKey("platform")]: "suggested" } : {};
        filled.length = 0;
        filled.push(...Object.keys(statusPatch), ...(platformFilled ? ["campaign.platform"] : []));
        const nextStatus = {
          ...readStatusMap(row.fieldStatus),
          ...statusPatch,
          [SUGGESTED_AT_KEY]: new Date().toISOString(),
          ...platformPatch,
        };
        return { ...projectData, fieldStatus: nextStatus as never };
      },
      { campaignGoal: true, goalType: true, fieldStatus: true }
    );
    const fresh = await prisma.project.findUnique({ where: { id: projectId }, select: PROJECT_RETURN });
    if (fresh) updatedProject = fresh;
  } else {
    // AI unavailable — still mark that we tried, so auto-run doesn't retry every load.
    await patchProject(projectId, (row) => ({
      fieldStatus: { ...readStatusMap(row.fieldStatus), [SUGGESTED_AT_KEY]: new Date().toISOString() } as never,
    }));
  }

  const finalCampaignSelection = await prisma.campaignSelection.findUnique({ where: { projectId } });

  return NextResponse.json({ filled, project: updatedProject, campaignSelection: finalCampaignSelection });
}

export const POST = withAccess(unguardedPOST);
