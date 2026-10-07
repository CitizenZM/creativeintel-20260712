/**
 * Project-level campaign planning: read the stored sp-1 brief, plan every requested platform and
 * store the result on Project.campaignPlan / campaignPlanAt. Shared by the operator action
 * `plan-campaign` and the Studio route /api/projects/[projectId]/campaign-plan.
 */
import { prisma } from "@/lib/db";
import type { CampaignPlan } from "./campaign-plan.types";
import { DEFAULT_PLAN_PLATFORMS, normalizeOverrides, planCampaign, type LlmFn, type PromoInput } from "./campaign-planner";
import type { ProductBrief } from "./product-brief";
import { goalFromText } from "./prompt-blocks";

export class CampaignPlanError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export interface PlanRequest {
  platforms?: string[];
  goal?: string;
  promo?: PromoInput;
  runDate?: string;
  durationSec?: number;
  strictCompliance?: boolean;
  /** Studio overrides: { [platform]: { hookIds?, endCardId? } } (or { pinnedHooks, endCards }). */
  overrides?: unknown;
  llm?: LlmFn;
}

/** Strict legal gating is opt-in: per request, or globally with CREATIVE_STRICT_COMPLIANCE=true. */
export const strictByDefault = () => process.env.CREATIVE_STRICT_COMPLIANCE === "true";

export async function createCampaignPlan(projectId: string, req: PlanRequest = {}): Promise<CampaignPlan> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, productBrief: true, campaignGoal: true, goalType: true },
  });
  if (!project) throw new CampaignPlanError("Project not found", 404);
  const brief = project.productBrief as ProductBrief | null;
  if (!brief || !Array.isArray(brief.sellingPoints)) {
    throw new CampaignPlanError("No product brief on this project — run the product-brief action first (operator {\"action\":\"product-brief\",\"projectId\":…}).", 409);
  }
  const [selection, kit] = await Promise.all([
    prisma.campaignSelection.findUnique({ where: { projectId }, select: { platform: true } }).catch(() => null),
    prisma.brandKit.findUnique({ where: { projectId }, select: { offerText: true } }).catch(() => null),
  ]);
  const platforms = req.platforms?.length ? req.platforms : selection?.platform ? [selection.platform] : DEFAULT_PLAN_PLATFORMS;
  const goal = req.goal || goalFromText([project.campaignGoal, project.goalType, kit?.offerText].filter(Boolean).join(" "));
  const promo = req.promo ?? (brief.product?.price ? { price: brief.product.price } : undefined);
  const plan = await planCampaign({
    projectId,
    brief,
    platforms,
    goal,
    promo,
    runDate: req.runDate,
    durationSec: req.durationSec,
    strictCompliance: req.strictCompliance ?? strictByDefault(),
    overrides: normalizeOverrides(req.overrides),
    llm: req.llm,
  });
  await prisma.project.update({ where: { id: projectId }, data: { campaignPlan: plan as object, campaignPlanAt: new Date() } });
  return plan;
}

export async function getCampaignPlan(projectId: string): Promise<{ plan: CampaignPlan | null; planAt: Date | null } | null> {
  const p = await prisma.project.findUnique({ where: { id: projectId }, select: { campaignPlan: true, campaignPlanAt: true } });
  if (!p) return null;
  return { plan: (p.campaignPlan as CampaignPlan | null) ?? null, planAt: p.campaignPlanAt };
}
