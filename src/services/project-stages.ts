import { prisma } from "@/lib/db";

export type StageState = "done" | "partial" | "todo";

/** One check a stage must pass before it counts as done. */
export interface StageCriterion {
  label: string;
  met: boolean;
}

export interface ProjectStage {
  id: "setup" | "research" | "insights" | "creative" | "studio" | "deliver";
  label: string;
  href: string;
  state: StageState;
  detail: string;
  /**
   * The concrete thing to do here, phrased as an instruction. The header shows
   * this rather than the stage name — "Next: Setup" tells you where to go but
   * not what to do once you arrive.
   */
  action: string;
  /**
   * What "done" means for this stage. A stage is done only when every
   * criterion is met — data merely existing is not enough; the user has to
   * have confirmed the parts that need a human decision.
   */
  criteria: StageCriterion[];
}

export interface ProjectStages {
  projectId: string;
  brandKitScore: number;
  stages: ProjectStage[];
  next: ProjectStage | null;
}

const MIN_COMPETITORS = 3;
const MIN_ADS = 10;

function stateOf(criteria: StageCriterion[]): StageState {
  const met = criteria.filter((c) => c.met).length;
  return met === criteria.length ? "done" : met > 0 ? "partial" : "todo";
}

/** The action for a stage: its fixed instruction once started, else the first gap. */
function firstGap(criteria: StageCriterion[], fallback: string): string {
  return criteria.find((c) => !c.met)?.label ?? fallback;
}

export async function getProjectStages(projectId: string): Promise<ProjectStages> {
  const [
    project,
    kit,
    competitors,
    assets,
    paidAssets,
    teardowns,
    pickedPoints,
    pickedPatterns,
    pickedInsights,
    scripts,
    selectedScripts,
    runs,
  ] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { productName: true, productUrl: true, campaignGoal: true },
    }),
    prisma.brandKit.findUnique({ where: { projectId }, select: { completenessScore: true } }),
    prisma.competitor.count({ where: { projectId } }),
    prisma.contentAsset.count({ where: { projectId } }),
    prisma.contentAsset.count({ where: { projectId, isPaidMedia: true } }),
    prisma.adTeardown.count({ where: { projectId } }),
    prisma.sellingPoint.count({ where: { projectId, selected: true } }),
    prisma.narrativePattern.count({ where: { projectId, selected: true } }),
    prisma.insight.count({ where: { projectId, selected: true } }),
    prisma.script.count({ where: { projectId, deletedAt: null } }),
    prisma.script.findMany({
      where: { projectId, deletedAt: null, status: "selected" },
      select: { id: true },
    }),
    prisma.libtvRun.findMany({
      where: { projectId },
      select: { status: true, masterMp4Url: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  // A selected script is production-ready once its active storyboard has
  // every frame approved.
  const boards = selectedScripts.length
    ? await prisma.storyboard.findMany({
        where: { projectId, deletedAt: null, isActive: true, scriptId: { in: selectedScripts.map((s) => s.id) } },
        select: { frames: true },
      })
    : [];
  const approvedBoards = boards.filter((b) => {
    const frames = Array.isArray(b.frames) ? (b.frames as { approved?: boolean | null }[]) : [];
    return frames.length > 0 && frames.every((f) => f.approved === true);
  }).length;

  const brandKitScore = kit?.completenessScore ?? 0;
  const base = `/projects/${projectId}`;
  const completedRuns = runs.filter((r) => r.status === "completed").length;
  const delivered = runs.filter((r) => !!r.masterMp4Url).length;
  const picked = pickedPoints + pickedPatterns + pickedInsights;

  const setupCriteria: StageCriterion[] = [
    { label: "Define the product (name or product URL)", met: !!(project?.productName || project?.productUrl) },
    { label: "Set the campaign goal", met: !!project?.campaignGoal },
    { label: `Complete the Brand Kit to 60% (now ${brandKitScore}%)`, met: brandKitScore >= 60 },
  ];
  const researchCriteria: StageCriterion[] = [
    { label: "Run competitor research", met: assets > 0 },
    { label: `Find at least ${MIN_COMPETITORS} competitors (now ${competitors})`, met: competitors >= MIN_COMPETITORS },
    { label: `Collect at least ${MIN_ADS} ads (now ${assets})`, met: assets >= MIN_ADS },
    { label: "Collect at least one verified paid ad", met: paidAssets > 0 },
  ];
  const insightsCriteria: StageCriterion[] = [
    { label: "Analyse what competitors run (ad teardowns)", met: teardowns > 0 },
    { label: "Send at least one insight, selling point or pattern to scripts", met: picked > 0 },
  ];
  const creativeCriteria: StageCriterion[] = [
    { label: "Write scripts", met: scripts > 0 },
    { label: "Select the scripts to produce", met: selectedScripts.length > 0 },
    { label: "Approve every frame of a selected script's storyboard", met: approvedBoards > 0 },
  ];
  const studioCriteria: StageCriterion[] = [
    { label: "Compile a production run", met: runs.length > 0 },
    { label: "Finish rendering a run", met: completedRuns > 0 },
  ];
  const deliverCriteria: StageCriterion[] = [{ label: "Render a master video", met: delivered > 0 }];

  const stages: ProjectStage[] = [
    {
      id: "setup",
      label: "Setup",
      href: `${base}/overview`,
      state: stateOf(setupCriteria),
      detail: `Brand kit ${brandKitScore}%`,
      action: firstGap(setupCriteria, "Review the project setup"),
      criteria: setupCriteria,
    },
    {
      id: "research",
      label: "Research",
      href: `${base}/content`,
      state: stateOf(researchCriteria),
      detail: assets ? `${assets} ads · ${paidAssets} paid` : "Not run",
      action: assets === 0 ? "Run competitor research" : firstGap(researchCriteria, "Review the ads we found"),
      criteria: researchCriteria,
    },
    {
      id: "insights",
      label: "Insights",
      href: `${base}/insights`,
      state: stateOf(insightsCriteria),
      detail: teardowns ? `${teardowns} teardowns · ${picked} picked` : "Not analyzed",
      action: firstGap(insightsCriteria, "Read the competitor teardowns"),
      criteria: insightsCriteria,
    },
    {
      id: "creative",
      label: "Creative",
      href: `${base}/creative`,
      state: stateOf(creativeCriteria),
      detail: `${scripts} scripts · ${selectedScripts.length} selected · ${approvedBoards} approved`,
      action: firstGap(creativeCriteria, "Send a storyboard to Studio"),
      criteria: creativeCriteria,
    },
    {
      id: "studio",
      label: "Studio",
      href: `${base}/studio`,
      state: stateOf(studioCriteria),
      detail: runs.length ? `${completedRuns}/${runs.length} runs done` : "No LibTV runs",
      action: runs.length === 0 ? "Compile a production run" : firstGap(studioCriteria, "Review the finished run"),
      criteria: studioCriteria,
    },
    {
      id: "deliver",
      label: "Deliver",
      href: `${base}/deliver`,
      state: stateOf(deliverCriteria),
      detail: delivered ? `${delivered} masters` : "Nothing rendered yet",
      action: delivered === 0 ? "Render a master video" : "Download your finished ads",
      criteria: deliverCriteria,
    },
  ];

  const next = stages.find((s) => s.state !== "done") ?? null;
  return { projectId, brandKitScore, stages, next };
}
