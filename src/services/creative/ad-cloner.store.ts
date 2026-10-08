/**
 * Project-level Ad Cloner: load the reference (a stored teardown of this project, or a saved
 * structure from the library) and the project's sp-1 brief, clone the structure for our product and
 * merge it into Project.campaignPlan under "Cloned from <ref>". Used by the operator action `clone-ad`.
 */
import { prisma } from "@/lib/db";
import { archiveAround, archiveProjectFields } from "@/services/artifacts/archive";
import type { CampaignPlan } from "./campaign-plan.types";
import { CampaignPlanError, strictByDefault } from "./campaign-plan.store";
import type { LlmFn, PromoInput } from "./campaign-planner";
import { cloneAd, mergeClonedPlan, type CloneAdResult } from "./ad-cloner";
import type { ProductBrief } from "./product-brief";

export interface CloneRequest {
  teardownId?: string | null;
  structureId?: string | null;
  platform?: string | null;
  goal?: string | null;
  promo?: PromoInput;
  runDate?: string;
  strictCompliance?: boolean;
  llm?: LlmFn;
}

export async function cloneAdIntoProject(projectId: string, req: CloneRequest): Promise<{ plan: CampaignPlan; clone: CloneAdResult }> {
  if (!req.teardownId === !req.structureId) throw new CampaignPlanError("Give exactly one of teardownId or structureId", 400);
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, productBrief: true, campaignPlan: true } });
  if (!project) throw new CampaignPlanError("Project not found", 404);
  const brief = project.productBrief as ProductBrief | null;
  if (!brief || !Array.isArray(brief.sellingPoints)) {
    throw new CampaignPlanError("No product brief on this project — run the product-brief action first (operator {\"action\":\"product-brief\",\"projectId\":…}).", 409);
  }
  let reference: unknown;
  if (req.teardownId) {
    reference = await prisma.adTeardown.findFirst({
      where: { id: req.teardownId, projectId },
      include: { competitor: { select: { name: true } }, contentAsset: { select: { title: true, url: true, viewCount: true, durationSec: true, platform: true, aspectRatio: true } } },
    });
    if (!reference) throw new CampaignPlanError("Teardown not found in this project", 404);
  } else {
    reference = await prisma.adStructure.findUnique({ where: { id: req.structureId! } });
    if (!reference) throw new CampaignPlanError("Structure not found", 404);
  }
  const existing = (project.campaignPlan as CampaignPlan | null) ?? null;
  const promo = req.promo ?? existing?.promo ?? (brief.product?.price ? { price: brief.product.price } : undefined);
  let clone: CloneAdResult;
  try {
    clone = await cloneAd({ reference, brief, platform: req.platform, goal: req.goal, promo, runDate: req.runDate, strictCompliance: req.strictCompliance ?? strictByDefault(), llm: req.llm });
  } catch (err) {
    throw new CampaignPlanError(err instanceof Error ? err.message : String(err), 422);
  }
  const plan = mergeClonedPlan(existing, clone.plan, { brief, goal: clone.goal, promo });
  await archiveAround("ad clone plan", (o) => archiveProjectFields(projectId, ["campaignPlan"], o), () => prisma.project.update({ where: { id: projectId }, data: { campaignPlan: plan as object, campaignPlanAt: new Date() } }));
  if (req.structureId) await prisma.adStructure.update({ where: { id: req.structureId }, data: { timesUsed: { increment: 1 } } }).catch(() => {});
  return { plan, clone };
}
