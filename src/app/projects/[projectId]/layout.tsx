import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { TabNav } from "@/components/layout/tab-nav";
import { getProjectStages } from "@/services/project-stages";
import { ProjectUrlSync } from "@/components/projects/project-url-sync";
import { currentViewer } from "@/services/workspace";
import { tenantOfProject } from "@/services/tenancy";
import { normalizeShareAccess } from "@/lib/auth/access";
import { ACCESS_LEVELS } from "@/components/settings/access-level";

/** "Shared with you · <level>" for a coworker on someone else's project (the proxy enforces the level). */
async function sharedLevel(projectId: string): Promise<string | null> {
  try {
    const viewer = await currentViewer();
    if (viewer.kind !== "member" || (await tenantOfProject(projectId)) === viewer.user.id) return null;
    const share = await prisma.projectShare.findFirst({
      where: { projectId, userId: viewer.user.id },
      select: { access: true },
    });
    const access = normalizeShareAccess(share?.access);
    const level = ACCESS_LEVELS.find((l) => l.value === access);
    return level ? `${level.label} — ${level.hint.toLowerCase()}` : null;
  } catch {
    return null;
  }
}

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) notFound();

  const [stages, shared] = await Promise.all([getProjectStages(projectId).catch(() => null), sharedLevel(projectId)]);

  return (
    <div>
      <ProjectUrlSync projectId={projectId} brandName={project.brandName} />
      <Header
        title={project.brandName}
        status={project.status}
        description={[project.category, project.campaignGoal].filter(Boolean).join(" · ") || undefined}
        brandKit={stages ? { score: stages.brandKitScore, href: `/projects/${projectId}/overview#brand-kit` } : undefined}
        projectId={projectId}
        stages={stages}
      />
      {shared && (
        <div className="border-b border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground sm:px-6 lg:px-8">
          <span className="font-medium text-foreground">Shared with you</span> · {shared}
        </div>
      )}
      <TabNav projectId={projectId} />
      <div className="px-4 py-6 sm:px-6 lg:px-8 max-w-7xl mx-auto">{children}</div>
    </div>
  );
}
