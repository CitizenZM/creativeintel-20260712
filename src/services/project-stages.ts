import { sqlTable } from "@/lib/sql-table";
import { prisma } from "@/lib/db";
import { calculateBrandKitCompleteness } from "@/services/brand-kit";

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

type StageSnapshot = {
  id: string;
  project: { productName: string | null; productUrl: string | null; productPageTitle: string | null; productConfirmedAt: string | null; campaignGoal: string | null; goalType: string | null; category: string | null; campaignSelection: { styleCategories: unknown } | null };
  kit: Parameters<typeof calculateBrandKitCompleteness>[0];
  competitors: number; assets: number; paidAssets: number; teardowns: number;
  pickedPoints: number; pickedPatterns: number; pickedInsights: number; scripts: number;
  selectedScripts: number; approvedBoards: number;
  unresearched: { name: string }[]; runs: { status: string; masterMp4Url: string | null }[];
};

/** One SQL round trip for any number of projects; only small summary values cross the wire. */
export async function getProjectsStages(projectIds: string[]): Promise<ProjectStages[]> {
  if (!projectIds.length) return [];
  const rows = await prisma.$queryRaw<StageSnapshot[]>`
    SELECT p.id, jsonb_build_object('productName', p."productName", 'productUrl', p."productUrl", 'productPageTitle', p."productPageTitle", 'productConfirmedAt', p."productConfirmedAt", 'campaignGoal', p."campaignGoal", 'goalType', p."goalType", 'category', p.category, 'campaignSelection',
      (SELECT jsonb_build_object('styleCategories', cs."styleCategories") FROM ${sqlTable("CampaignSelection")}  cs WHERE cs."projectId" = p.id)) AS project,
      (SELECT jsonb_build_object('colorsHex', k."colorsHex", 'ctaOptions', k."ctaOptions", 'skuDimensionsCm', k."skuDimensionsCm",
        'landingUrl', k."landingUrl", 'productSummary', k."productSummary", 'claimsAllowed', k."claimsAllowed", 'assets',
        COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', ba.kind)) FROM ${sqlTable("BrandAsset")}  ba WHERE ba."brandKitId" = k.id), '[]'::jsonb))
        FROM ${sqlTable("BrandKit")}  k WHERE k."projectId" = p.id) AS kit,
      (SELECT count(*)::int FROM ${sqlTable("Competitor")}  c WHERE c."projectId" = p.id AND NOT c.excluded) AS competitors,
      (SELECT count(*)::int FROM ${sqlTable("ContentAsset")}  a WHERE a."projectId" = p.id AND NOT a.excluded) AS assets,
      (SELECT count(*)::int FROM ${sqlTable("ContentAsset")}  a WHERE a."projectId" = p.id AND NOT a.excluded AND a."isPaidMedia") AS "paidAssets",
      (SELECT count(*)::int FROM ${sqlTable("AdTeardown")}  a WHERE a."projectId" = p.id) AS teardowns,
      (SELECT count(*)::int FROM ${sqlTable("SellingPoint")}  a WHERE a."projectId" = p.id AND a.selected) AS "pickedPoints",
      (SELECT count(*)::int FROM ${sqlTable("NarrativePattern")}  a WHERE a."projectId" = p.id AND a.selected) AS "pickedPatterns",
      (SELECT count(*)::int FROM ${sqlTable("Insight")}  a WHERE a."projectId" = p.id AND a.selected) AS "pickedInsights",
      (SELECT count(*)::int FROM ${sqlTable("Script")}  a WHERE a."projectId" = p.id AND a."deletedAt" IS NULL) AS scripts,
      (SELECT count(*)::int FROM ${sqlTable("Script")}  a WHERE a."projectId" = p.id AND a."deletedAt" IS NULL AND a.status = 'selected') AS "selectedScripts",
      (SELECT count(*)::int FROM ${sqlTable("Storyboard")}  b JOIN ${sqlTable("Script")}  sc ON sc.id = b."scriptId"
        WHERE b."projectId" = p.id AND b."deletedAt" IS NULL AND b."isActive" AND sc."deletedAt" IS NULL AND sc.status = 'selected'
        AND jsonb_typeof(b.frames) = 'array' AND b.frames <> '[]'::jsonb
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(b.frames) = 'array' THEN b.frames ELSE '[]'::jsonb END) f WHERE f->'approved' IS DISTINCT FROM 'true'::jsonb)) AS "approvedBoards",
      COALESCE((SELECT jsonb_agg(jsonb_build_object('name', c.name)) FROM ${sqlTable("Competitor")}  c
        WHERE c."projectId" = p.id AND NOT c.excluded AND NOT EXISTS (SELECT 1 FROM ${sqlTable("ContentAsset")}  a WHERE a."competitorId" = c.id)
        AND c."createdAt" > COALESCE((SELECT max(r."createdAt") FROM ${sqlTable("ResearchJob")}  r WHERE r."projectId" = p.id AND r.status = 'complete'), '-infinity'::timestamp)), '[]'::jsonb) AS unresearched,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('status', r.status, 'masterMp4Url', r."masterMp4Url")) FROM
        (SELECT status, "masterMp4Url" FROM ${sqlTable("LibtvRun")}  WHERE "projectId" = p.id ORDER BY "createdAt" DESC LIMIT 20) r), '[]'::jsonb) AS runs
    FROM ${sqlTable("Project")}  p WHERE p.id = ANY(${projectIds}::text[])
  `;
  const byId = new Map(rows.map((row) => [row.id, buildStages(row)]));
  return projectIds.flatMap((id) => byId.has(id) ? [byId.get(id)!] : []);
}

export async function getProjectStages(projectId: string): Promise<ProjectStages> {
  const [stages] = await getProjectsStages([projectId]);
  if (!stages) throw new Error('Project not found');
  return stages;
}

function buildStages(row: StageSnapshot): ProjectStages {
  const { id: projectId, project, kit, competitors, assets, paidAssets, teardowns, pickedPoints, pickedPatterns, pickedInsights, scripts, approvedBoards, unresearched, runs } = row;
  const selectedScripts = { length: row.selectedScripts };
  const kitCheck = calculateBrandKitCompleteness(kit, project.category);
  const kitReady = !!kitCheck?.ready.creative;
  const kitMissing = (kitCheck?.missing ?? []).filter((m) => !/SKU dimensions/i.test(m));
  const brandKitScore = kitCheck.score;
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
    {
      id: "research.coverage",
      label: unresearched.length
        ? `Research the new competitor${unresearched.length > 1 ? "s" : ""} (${unresearched.map((c) => c.name).join(", ")})`
        : "Research every competitor",
      met: unresearched.length === 0,
      href: `${base}/content`,
    },
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
