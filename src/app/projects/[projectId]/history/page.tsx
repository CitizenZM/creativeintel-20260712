import { prisma } from "@/lib/db";
import { HistoryTimeline } from "@/components/history/history-timeline";
import { LIST_SELECT, toListItem } from "@/services/artifacts/serve";

export const dynamic = "force-dynamic";

/**
 * The project's content history (ProjectArtifact, services/artifacts): a timeline of everything it
 * produced, grouped by kind and then version, with previews and a download per version.
 */
export default async function HistoryPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const rows = await prisma.projectArtifact.findMany({
    where: { projectId },
    orderBy: [{ kind: "asc" }, { sourceKey: "asc" }, { version: "desc" }],
    take: 3000,
    select: LIST_SELECT,
  });
  return <HistoryTimeline projectId={projectId} items={rows.map((r) => toListItem(projectId, r))} />;
}
