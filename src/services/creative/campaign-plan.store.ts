/**
 * Project-level campaign planning: read the stored sp-1 brief, plan every requested platform and
 * store the result on Project.campaignPlan / campaignPlanAt. Shared by the operator action
 * `plan-campaign` and the Studio route /api/projects/[projectId]/campaign-plan.
 */
import { prisma } from "@/lib/db";
import { archiveAround, archiveProjectFields } from "@/services/artifacts/archive";
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
  /** Performance Agent bias; default: loaded from this project's imported results (null = off). */
  bias?: Partial<Record<string, number>> | null;
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
    bias: req.bias === undefined ? await loadPlanBias(projectId, brief.category, platforms) : (req.bias ?? undefined),
  });
  await archiveAround("campaign plan", (o) => archiveProjectFields(projectId, ["campaignPlan"], o), () => prisma.project.update({ where: { id: projectId }, data: { campaignPlan: plan as object, campaignPlanAt: new Date() } }));
  return plan;
}

/**
 * Default selectCreative bias: our own results (Performance Agent) merged with competitor hook
 * trends (research/hook-trends, rules only — no model call); our results win for any id both score.
 */
async function loadPlanBias(projectId: string, category: string | undefined, platforms: string[]): Promise<Partial<Record<string, number>> | undefined> {
  const [perf, trends] = await Promise.all([
    import("@/services/performance/agent").then((m) => m.performanceBias(projectId)).catch(() => undefined),
    import("@/services/research/hook-trends").then((m) => m.trendBias(category, platforms.length === 1 ? platforms[0] : null, { projectId }).then((t) => ({ t, merge: m.mergeBias }))).catch(() => undefined),
  ]);
  return trends ? trends.merge(perf, trends.t) : perf && Object.keys(perf).length ? perf : undefined;
}

export async function getCampaignPlan(projectId: string): Promise<{ plan: CampaignPlan | null; planAt: Date | null } | null> {
  const p = await prisma.project.findUnique({ where: { id: projectId }, select: { campaignPlan: true, campaignPlanAt: true } });
  if (!p) return null;
  return { plan: (p.campaignPlan as CampaignPlan | null) ?? null, planAt: p.campaignPlanAt };
}
