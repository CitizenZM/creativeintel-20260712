/**
 * Campaign plan for a project (Studio planning panel). Auth is the app-wide Cloudflare Access gate
 * in src/proxy.ts, as for every /api/projects route.
 *
 * GET  → { plan, planAt, summary } — the stored plan (plan null when none yet)
 * POST { platforms?: string[], goal?: string, promo?: {pct,price,comparePrice,priceCheckedAt,code,deadline},
 *        runDate?, durationSec?, strictCompliance?, overrides?: { [platform]: { hookIds?, endCardId? } } }
 *      → plans every platform from the stored product brief (one text-model call per platform),
 *        stores it on Project.campaignPlan and returns { plan, summary }. 409 when no brief exists.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { CampaignPlanError, createCampaignPlan, getCampaignPlan } from "@/services/creative/campaign-plan.store";
import { summarizePlan } from "@/services/creative/campaign-planner";

export const maxDuration = 300;

const numOrNull = z.number().nullable().optional();
const bodySchema = z.object({
  platforms: z.array(z.string().min(1).max(60)).max(12).optional(),
  goal: z.string().max(80).optional(),
  promo: z
    .object({ pct: numOrNull, price: numOrNull, comparePrice: numOrNull, priceCheckedAt: z.string().nullable().optional(), code: z.string().max(40).nullable().optional(), deadline: z.string().nullable().optional() })
    .optional(),
  runDate: z.string().max(40).optional(),
  durationSec: z.number().int().min(5).max(90).optional(),
  strictCompliance: z.boolean().optional(),
  /** Studio choices: { [platform]: { hookIds?: string[] (≤ 3), endCardId?: "E01"…"E12" } }. */
  overrides: z.record(z.string(), z.unknown()).optional(),
});

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const stored = await getCampaignPlan(projectId);
  if (!stored) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ plan: stored.plan, planAt: stored.planAt, summary: stored.plan ? summarizePlan(stored.plan) : null });
}

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues.slice(0, 5) }, { status: 400 });
  try {
    const plan = await createCampaignPlan(projectId, parsed.data);
    return NextResponse.json({ plan, summary: summarizePlan(plan) }, { status: 201 });
  } catch (err) {
    if (err instanceof CampaignPlanError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
