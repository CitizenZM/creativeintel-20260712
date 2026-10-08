/**
 * Build the media plan from the project's brief + campaign plan and keep it on Project.mediaPlan /
 * mediaPlanAt. Used by the operator action `media-plan`. Never spends: the narrative is one optional
 * text-model call (narrative: false skips it).
 */
import { prisma } from "@/lib/db";
import { archiveAround, archiveProjectFields } from "@/services/artifacts/archive";
import type { Baseline } from "@/services/creative/test-plan";
import { buildMediaPlan, flightDays, writeMediaPlanNarrative, type BriefLike, type MediaPlan, type MediaPlanInput, type MediaPlanLlm } from "./media-plan";

export class MediaPlanError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export interface MediaPlanRequest {
  goal: string;
  totalBudget: number;
  flightStart: string;
  flightEnd: string;
  targetCpa?: number;
  targetRoas?: number;
  aov?: number;
  markets?: string[];
  channels?: string[];
  baseline?: Partial<Record<string, Partial<Baseline>>>;
  allowProxyEvent?: boolean;
  maxChannels?: number;
  /** Default true: one short text-model call; false keeps the deterministic summary. */
  narrative?: boolean;
  llm?: MediaPlanLlm;
  now?: Date;
}

/** "$48", "48.00 USD", 48 → 48. */
export function priceOf(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  if (typeof v === "string") {
    const m = v.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
    if (m && Number(m[0]) > 0) return Number(m[0]);
  }
  return null;
}

export async function createMediaPlan(projectId: string, req: MediaPlanRequest): Promise<MediaPlan> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, brandName: true, productName: true, productBrief: true, campaignPlan: true },
  });
  if (!project) throw new MediaPlanError("Project not found", 404);
  const days = flightDays({ start: req.flightStart, end: req.flightEnd });
  if (!Number.isFinite(days)) throw new MediaPlanError("Invalid flight: flightStart and flightEnd must be ISO dates with end ≥ start", 400);
  if (days > 366) throw new MediaPlanError("Flight longer than a year — plan it in quarters", 400);
  const brief = (project.productBrief ?? null) as BriefLike | null;
  const input: MediaPlanInput = {
    productTitle: [project.brandName, project.productName].filter(Boolean).join(" ") || project.name,
    brand: project.brandName,
    brief,
    goal: req.goal,
    totalBudget: req.totalBudget,
    flight: { start: req.flightStart, end: req.flightEnd },
    targetCpa: req.targetCpa,
    targetRoas: req.targetRoas,
    aov: req.aov ?? priceOf(brief?.product?.price) ?? undefined,
    markets: req.markets,
    channels: req.channels,
    baseline: req.baseline,
    allowProxyEvent: req.allowProxyEvent,
    maxChannels: req.maxChannels,
    campaignPlan: (project.campaignPlan ?? null) as MediaPlanInput["campaignPlan"],
    now: req.now,
  };
  const plan = buildMediaPlan(input);
  const n = req.narrative === false ? null : await writeMediaPlanNarrative(plan, req.llm);
  const out: MediaPlan = n ? { ...plan, narrative: n.narrative, narrativeSource: n.source } : plan;
  await archiveAround("media plan", (o) => archiveProjectFields(projectId, ["mediaPlan"], o), () => prisma.project.update({ where: { id: projectId }, data: { mediaPlan: out as object, mediaPlanAt: new Date() } }));
  return out;
}
