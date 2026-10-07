/**
 * POST { teardownId } | { structureId }, platform?, goal? — Ad Cloner: the reference ad's structure for
 * this product, merged into Project.campaignPlan as "Cloned from <ref>" (one copy pass). Same service as
 * the operator's clone-ad action; the Planning tab shows the result.
 */
import { NextResponse } from "next/server";
import { parseOperatorAction } from "@/services/operator";
import { cloneAdIntoProject } from "@/services/creative/ad-cloner.store";
import { CampaignPlanError } from "@/services/creative/campaign-plan.store";
import { summarizePlan } from "@/services/creative/campaign-planner";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const parsed = parseOperatorAction("clone-ad", { ...body, projectId });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const input = parsed.data;
  try {
    const { plan, clone } = await cloneAdIntoProject(projectId, { teardownId: input.teardownId, structureId: input.structureId, platform: input.platform, goal: input.goal });
    return NextResponse.json({ ok: true, label: clone.plan.label, hook: clone.hook, endCard: clone.endCard, summary: summarizePlan(plan) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: err instanceof CampaignPlanError ? err.status : 500 });
  }
}
