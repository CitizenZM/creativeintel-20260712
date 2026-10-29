import { safePublicError } from "@/lib/public-error";
/**
 * GET  — the stored test plan (Project.testPlan), or null.
 * POST { totalBudget, days, goal?, platforms?, targetCpa?, targetLift?, maxVariants?, narrative? } —
 *      build the testing plan from the campaign plan (same service as the operator's test-plan action).
 *      narrative defaults to false here: the AI summary is one text-model call, opted into in the UI.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseOperatorAction } from "@/services/operator";
import { createTestPlan, TestPlanError } from "@/services/creative/test-plan.store";
import { withAccess } from "@/lib/auth/route-guard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function unguardedGET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { testPlan: true, testPlanAt: true, campaignPlan: true } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  return NextResponse.json({ testPlan: project.testPlan ?? null, testPlanAt: project.testPlanAt, hasCampaignPlan: !!project.campaignPlan });
}

async function unguardedPOST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const parsed = parseOperatorAction("test-plan", { narrative: false, ...body, projectId });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const req: Partial<typeof parsed.data> = { ...parsed.data };
  delete req.action;
  delete req.projectId;
  try {
    return NextResponse.json({ ok: true, testPlan: await createTestPlan(projectId, req as Parameters<typeof createTestPlan>[1]) });
  } catch (err) {
    return NextResponse.json({ error: safePublicError(err) }, { status: err instanceof TestPlanError ? err.status : 500 });
  }
}

export const GET = withAccess(unguardedGET);
export const POST = withAccess(unguardedPOST);
