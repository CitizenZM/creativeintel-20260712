import Link from "next/link";
import { prisma } from "@/lib/db";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { projectWorkspaceFilter } from "@/services/workspace";
import { ProjectsTable, type ProjectRow } from "@/components/projects/projects-table";

export const dynamic = "force-dynamic";

export default async function AllProjectsPage() {
  const projects = await prisma.project.findMany({
    where: await projectWorkspaceFilter(),
    orderBy: { updatedAt: "desc" },
    include: {
      competitors: { select: { name: true } },
      _count: { select: { contentAssets: true, insights: true, scripts: true } },
    },
  });

  const rows: ProjectRow[] = projects.map((p) => ({
    id: p.id,
    brandName: p.brandName,
    status: p.status,
    category: p.category,
    archived: !!p.archivedAt,
    competitors: p.competitors.map((c) => c.name),
    contentCount: p._count.contentAssets,
    insightCount: p._count.insights,
  }));

  const active = rows.filter((r) => !r.archived).length;

  return (
    <div>
      <Header
        title="Projects"
        description={`${active} active${rows.length !== active ? ` · ${rows.length - active} archived` : ""}`}
        actions={
          <Link href="/projects/new">
            <Button className="h-9 rounded-md bg-foreground text-background hover:bg-foreground/90 font-medium">
              <Plus className="mr-1.5 h-4 w-4" />
              New project
            </Button>
          </Link>
        }
      />
      <div className="px-4 py-6 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        <ProjectsTable projects={rows} />
      </div>
    </div>
  );
}
