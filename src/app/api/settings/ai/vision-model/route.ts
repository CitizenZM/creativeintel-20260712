/**
 * GET — what the vision model picker shows before an analysis: the options
 * (with measured speed and cost per ad), the recommended one and the model
 * the next teardown will actually call. Saving goes through PUT /api/settings/ai
 * ({ vision, visionModel }). No secrets: env keys are reported as present/absent.
 */
import { NextResponse } from "next/server";
import { getVisionModel } from "@/services/ai/claude-client";
import { envAvailability, recommendedVisionModel, resolveStrictFree, visionModelOptions } from "@/services/settings/ai-settings-core";
import { loadAiSettings } from "@/services/settings/ai-settings";

export const dynamic = "force-dynamic";

export async function GET() {
  const snap = await loadAiSettings();
  const strictFree = resolveStrictFree(snap.settings.strictFree, process.env.AI_COST_MODE).effective;
  const env = envAvailability(process.env);
  return NextResponse.json({
    current: getVisionModel(),
    recommended: recommendedVisionModel({ env, strictFree }),
    options: visionModelOptions({ env, strictFree }),
    strictFree,
  });
}
