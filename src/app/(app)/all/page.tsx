import Link from "next/link";
import { prisma } from "@/lib/db";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { projectWorkspaceFilter } from "@/services/workspace";
import { ProjectsTable, type ProjectRow } from "@/components/projects/projects-table";

export const dynamic = "force-dynamic";

export default async function AllProjectsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const query = await searchParams;
  const requested = Number(query.page);
  const page = Number.isSafeInteger(requested) && requested > 0 ? requested : 1;
  const pageSize = 25;
  const where = await projectWorkspaceFilter();
  const total = await prisma.project.count({ where });
  const currentPage = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
  const projects = await prisma.project.findMany({
    where,
    skip: (currentPage - 1) * pageSize,
    take: pageSize,
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    select: {
      id: true, brandName: true, status: true, category: true, archivedAt: true,
      competitors: { select: { name: true } },
      _count: { select: { contentAssets: true, insights: true } },
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
        description={`${total} projects · ${active} active on this page`}
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
        <nav aria-label="Project pages" className="mt-4 flex items-center justify-between text-sm">
          {currentPage > 1 ? <Link href={`/all?page=${currentPage - 1}`}>Previous</Link> : <span />}
          <span>Page {currentPage} of {Math.max(1, Math.ceil(total / pageSize))}</span>
          {currentPage * pageSize < total ? <Link href={`/all?page=${currentPage + 1}`}>Next</Link> : <span />}
        </nav>
      </div>
    </div>
  );
}
