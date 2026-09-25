import { prisma } from "@/lib/db";
import { getBrandKitCompleteness } from "@/services/brand-kit";

export type StageState = "done" | "partial" | "todo";

/** One check a stage must pass before it counts as done. */
export interface StageCriterion {
  label: string;
  met: boolean;
  /** Where to fix it: a page, optionally with the #section that holds the input. */
  href?: string;
  /** Stable key — the client maps it to the AI action that completes it. */
  id?: string;
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
      select: {
        productName: true,
        productUrl: true,
        productPageTitle: true,
        productConfirmedAt: true,
        campaignGoal: true,
        goalType: true,
        campaignSelection: { select: { styleCategories: true } },
      },
    }),
    prisma.brandKit.findUnique({ where: { projectId }, select: { completenessScore: true } }),
    prisma.competitor.count({ where: { projectId, excluded: false } }),
    prisma.contentAsset.count({ where: { projectId, excluded: false } }),
    prisma.contentAsset.count({ where: { projectId, excluded: false, isPaidMedia: true } }),
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

  // Setup needs every Brand Kit item scripts are held to; SKU dimensions only
  // matter for Studio, so they don't block Setup.
  const kitCheck = await getBrandKitCompleteness(projectId).catch(() => null);
  const kitReady = !!kitCheck?.ready.creative;
  const kitMissing = (kitCheck?.missing ?? []).filter((m) => !/SKU dimensions/i.test(m));
  const brandKitScore = kitCheck?.score ?? kit?.completenessScore ?? 0;
  const base = `/projects/${projectId}`;
  const completedRuns = runs.filter((r) => r.status === "completed").length;
  const delivered = runs.filter((r) => !!r.masterMp4Url).length;
  const picked = pickedPoints + pickedPatterns + pickedInsights;

  const setupCriteria: StageCriterion[] = [
    { id: "setup.product", label: "Define the product (name or product URL)", met: !!(project?.productName || project?.productUrl), href: `${base}/overview#product-definition` },
    {
      id: "setup.confirmProduct", label: "Confirm the product details we read from your page",
      // Only scraped details need a check; typed-in ones are the user's own.
      met: !project?.productPageTitle || !!project?.productConfirmedAt,
      href: `${base}/overview#product-definition`,
    },
    { id: "setup.goal", label: "Set the campaign goal", met: !!project?.campaignGoal, href: `${base}/overview#goal-type` },
    { id: "setup.goalType", label: "Choose storytelling, conversion or hybrid ads", met: !!project?.goalType, href: `${base}/overview#goal-type` },
    {
      id: "setup.brandKit",
      label: kitReady
        ? "Complete the Brand Kit"
        : `Brand Kit: add ${kitMissing.slice(0, 3).join(", ").toLowerCase()}${kitMissing.length > 3 ? ` +${kitMissing.length - 3} more` : ""}`,
      met: kitReady,
      href: `${base}/overview#brand-kit`,
    },
  ];
  const researchCriteria: StageCriterion[] = [
    { id: "research.run", label: "Run competitor research", met: assets > 0, href: `${base}/content` },
    { id: "research.competitors", label: `Find at least ${MIN_COMPETITORS} competitors (now ${competitors})`, met: competitors >= MIN_COMPETITORS, href: `${base}/content#competitors` },
    { id: "research.ads", label: `Collect at least ${MIN_ADS} ads (now ${assets})`, met: assets >= MIN_ADS, href: `${base}/content` },
    { id: "research.paid", label: "Collect at least one verified paid ad", met: paidAssets > 0, href: `${base}/content` },
  ];
  const insightsCriteria: StageCriterion[] = [
    { id: "insights.analyze", label: "Analyse what competitors run (ad teardowns)", met: teardowns > 0, href: `${base}/insights` },
    {
      id: "insights.style",
      label: "Pick at least one ad style",
      met:
        Array.isArray(project?.campaignSelection?.styleCategories) &&
        (project.campaignSelection.styleCategories as unknown[]).length > 0,
      href: `${base}/insights`,
    },
    { id: "insights.picks", label: "Send at least one insight, selling point or pattern to scripts", met: picked > 0, href: `${base}/insights` },
  ];
  const creativeCriteria: StageCriterion[] = [
    { id: "creative.scripts", label: "Write scripts", met: scripts > 0, href: `${base}/creative` },
    { id: "creative.select", label: "Select the scripts to produce", met: selectedScripts.length > 0, href: `${base}/creative` },
    { id: "creative.approve", label: "Approve every frame of a selected script's storyboard", met: approvedBoards > 0, href: `${base}/creative` },
  ];
  const studioCriteria: StageCriterion[] = [
    { id: "studio.compile", label: "Compile a production run", met: runs.length > 0, href: `${base}/studio` },
    { id: "studio.render", label: "Finish rendering a run", met: completedRuns > 0, href: `${base}/studio` },
  ];
  const deliverCriteria: StageCriterion[] = [{ id: "deliver.master", label: "Render a master video", met: delivered > 0, href: `${base}/deliver` }];

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
