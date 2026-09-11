import { prisma } from "@/lib/db";

export type StageState = "done" | "partial" | "todo";

export interface ProjectStage {
  id: "setup" | "research" | "insights" | "creative" | "studio" | "deliver";
  label: string;
  href: string;
  state: StageState;
  detail: string;
}

export interface ProjectStages {
  projectId: string;
  brandKitScore: number;
  stages: ProjectStage[];
  next: ProjectStage | null;
}

export async function getProjectStages(projectId: string): Promise<ProjectStages> {
  const [kit, assets, paidAssets, teardowns, insights, scripts, storyboards, runs] = await Promise.all([
    prisma.brandKit.findUnique({ where: { projectId }, select: { completenessScore: true } }),
    prisma.contentAsset.count({ where: { projectId } }),
    prisma.contentAsset.count({ where: { projectId, isPaidMedia: true } }),
    prisma.adTeardown.count({ where: { projectId } }),
    prisma.insight.count({ where: { projectId } }),
    prisma.script.count({ where: { projectId } }),
    prisma.storyboard.count({ where: { projectId } }),
    prisma.libtvRun.findMany({
      where: { projectId },
      select: { status: true, masterMp4Url: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  const brandKitScore = kit?.completenessScore ?? 0;
  const base = `/projects/${projectId}`;
  const completedRuns = runs.filter((r) => r.status === "completed").length;
  const delivered = runs.filter((r) => !!r.masterMp4Url).length;

  const stages: ProjectStage[] = [
    {
      id: "setup",
      label: "Setup",
      href: `${base}/overview`,
      state: brandKitScore >= 60 ? "done" : brandKitScore > 0 ? "partial" : "todo",
      detail: `Brand kit ${brandKitScore}%`,
    },
    {
      id: "research",
      label: "Research",
      href: `${base}/content`,
      state: assets > 0 ? (paidAssets > 0 ? "done" : "partial") : "todo",
      detail: assets ? `${assets} ads · ${paidAssets} paid` : "Not run",
    },
    {
      id: "insights",
      label: "Insights",
      href: `${base}/insights`,
      state: teardowns > 0 ? "done" : insights > 0 ? "partial" : "todo",
      detail: teardowns ? `${teardowns} teardowns` : insights ? `${insights} insights` : "Not analyzed",
    },
    {
      id: "creative",
      label: "Creative",
      href: `${base}/creative`,
      state: storyboards > 0 ? "done" : scripts > 0 ? "partial" : "todo",
      detail: `${scripts} scripts · ${storyboards} storyboards`,
    },
    {
      id: "studio",
      label: "Studio",
      href: `${base}/studio`,
      state: completedRuns > 0 ? "done" : runs.length > 0 ? "partial" : "todo",
      detail: runs.length ? `${completedRuns}/${runs.length} runs done` : "No LibTV runs",
    },
    {
      id: "deliver",
      label: "Deliver",
      href: `${base}/deliver`,
      state: delivered > 0 ? "done" : "todo",
      detail: delivered ? `${delivered} masters` : "Nothing rendered yet",
    },
  ];

  const next = stages.find((s) => s.state !== "done") ?? null;
  return { projectId, brandKitScore, stages, next };
}
