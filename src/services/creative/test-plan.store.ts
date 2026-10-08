/**
 * Build the testing plan from the stored campaign plan and keep it on Project.testPlan /
 * testPlanAt. Used by the operator action `test-plan`.
 */
import { prisma } from "@/lib/db";
import { archiveAround, archiveProjectFields } from "@/services/artifacts/archive";
import type { CampaignPlan } from "./campaign-plan.types";
import { buildTestPlan, writeTestPlanNarrative, type Baseline, type NarrativeLlm, type TestPlan } from "./test-plan";

export class TestPlanError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export interface TestPlanRequest {
  totalBudget: number;
  days: number;
  goal?: string;
  platforms?: string[];
  baseline?: Partial<Record<string, Partial<Baseline>>>;
  targetCpa?: number;
  targetLift?: number;
  maxVariants?: number;
  /** Default true: one short text-model call; false keeps the deterministic summary. */
  narrative?: boolean;
  llm?: NarrativeLlm;
}

export async function createTestPlan(projectId: string, req: TestPlanRequest): Promise<TestPlan> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, campaignPlan: true } });
  if (!project) throw new TestPlanError("Project not found", 404);
  const plan = project.campaignPlan as CampaignPlan | null;
  if (!plan || !Array.isArray(plan.platforms) || !plan.platforms.length) {
    throw new TestPlanError("No campaign plan on this project — run the plan-campaign action first.", 409);
  }
  const tp = buildTestPlan({ plan, ...req });
  const n = req.narrative === false ? { narrative: undefined, source: undefined } : await writeTestPlanNarrative(tp, req.llm);
  const out: TestPlan = { ...tp, narrative: n.narrative, narrativeSource: n.source };
  await archiveAround("test plan", (o) => archiveProjectFields(projectId, ["testPlan"], o), () => prisma.project.update({ where: { id: projectId }, data: { testPlan: out as object, testPlanAt: new Date() } }));
  return out;
}
