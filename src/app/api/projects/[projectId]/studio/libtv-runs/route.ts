/**
 * POST — compile a storyboard into a LibtvRun (status `awaiting_approval`).
 * GET  — list this project's runs with their node jobs and the model catalogue
 *        the Studio pickers render.
 */
import { NextResponse } from "next/server";
import { isStrictFree } from "@/lib/cost-mode";
import { loadAiSettings } from "@/services/settings/ai-settings";
import { videoDefaults } from "@/services/settings/ai-settings-core";
import { isComfyConfigured } from "@/services/ai/comfyui";
import {
  compileRunFromStoryboard,
  LibtvCompileError,
  maxRunCredits,
} from "@/services/video-gen/libtv-compile";
import { getRunWithJobs, listRuns } from "@/services/video-gen/libtv-queue";
import { getBrandKitCompleteness } from "@/services/brand-kit";
import { DEFAULT_BUDGET_MODE, modelOptions, type BudgetMode } from "@/services/video-gen/libtv-pricing";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const snap = await loadAiSettings();
  const [runs, completeness] = await Promise.all([
    listRuns(projectId),
    getBrandKitCompleteness(projectId),
  ]);
  return NextResponse.json({
    runs,
    // The render engine picked in Settings → AI engines comes back as `preferred`.
    models: modelOptions(
      isStrictFree(),
      undefined,
      videoDefaults(snap.settings.video, isStrictFree(), snap.providers, { comfyAvailable: isComfyConfigured() })
    ),
    brandKit: completeness,
    limits: { maxRunCredits: maxRunCredits(), defaultBudgetMode: DEFAULT_BUDGET_MODE },
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    storyboardId?: string;
    scriptId?: string;
    imageModel?: string;
    videoModel?: string;
    clipDurationSec?: number;
    aspectRatio?: string;
    canvasName?: string;
    budgetMode?: BudgetMode;
    allowOverBudget?: boolean;
  };

  if (!body.storyboardId) {
    return NextResponse.json({ error: "storyboardId required" }, { status: 400 });
  }

  try {
    const result = await compileRunFromStoryboard({
      projectId,
      storyboardId: body.storyboardId,
      scriptId: body.scriptId ?? null,
      imageModel: body.imageModel,
      videoModel: body.videoModel,
      clipDurationSec: body.clipDurationSec,
      aspectRatio: body.aspectRatio,
      canvasName: body.canvasName,
      budgetMode: body.budgetMode,
      allowOverBudget: body.allowOverBudget === true,
    });

    const run = await getRunWithJobs(result.runId);
    return NextResponse.json(
      {
        run,
        creditsEstimated: result.creditsEstimated,
        jobCount: result.jobCount,
        budgetMode: result.budgetMode,
        clipGroups: result.clipGroups,
        maxRunCredits: result.maxRunCredits,
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof LibtvCompileError) {
      return NextResponse.json({ error: err.message, missing: err.missing }, { status: err.status });
    }
    console.error("libtv-runs compile failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to compile LibTV run" },
      { status: 500 }
    );
  }
}
