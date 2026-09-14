import Link from "next/link";
import { prisma } from "@/lib/db";
import { ProjectForm } from "@/components/projects/project-form";
import { projectWorkspaceFilter } from "@/services/workspace";
import { getProjectStages } from "@/services/project-stages";
import { projectPath } from "@/lib/project-slug";
import { ArrowRight, Plus } from "lucide-react";

export const dynamic = "force-dynamic";

const STATE_DOT: Record<string, string> = {
  done: "bg-[var(--status-healthy-fg)]",
  partial: "bg-[var(--status-attention-fg)]",
  todo: "bg-muted-foreground/40",
};

export default async function HomePage() {
  const projects = await prisma.project.findMany({
    where: await projectWorkspaceFilter(),
    orderBy: { updatedAt: "desc" },
    select: { id: true, brandName: true, status: true, category: true, updatedAt: true },
  });

  // Nothing to show yet — keep the original "start here" form.
  if (projects.length === 0) {
    return (
      <div>
        <div className="border-b border-border">
          <div className="px-4 py-8 sm:px-6 lg:px-8 max-w-7xl mx-auto">
            <h1 className="text-2xl font-semibold tracking-tight">CreativeIntel OS</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Turn brand and competitor intelligence into production-ready creative.
            </p>
          </div>
        </div>
        <div className="px-4 py-8 sm:px-6 lg:px-8 max-w-2xl mx-auto">
          <div className="rounded-lg border border-border bg-card p-6">
            <h2 className="text-base font-semibold tracking-tight">Start a new analysis</h2>
            <p className="text-xs text-muted-foreground mt-1 mb-5">
              Enter a brand and its competitors. We&apos;ll crawl, analyze, and generate creative
              strategies.
            </p>
            <ProjectForm />
          </div>
        </div>
      </div>
    );
  }

  // The next action per project is the whole point of this page, so it is
  // computed for the ones you are most likely to touch rather than all 27.
  const recent = projects.slice(0, 8);
  const stages = await Promise.all(
    recent.map((p) => getProjectStages(p.id).catch(() => null))
  );
  const rows = recent.map((p, i) => ({ project: p, stages: stages[i] }));
  const needsAttention = rows.filter((r) => r.project.status === "ERROR");

  return (
    <div>
      <div className="border-b border-border">
        <div className="px-4 py-7 sm:px-6 lg:px-8 max-w-7xl mx-auto flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">CreativeIntel OS</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {projects.length} project{projects.length === 1 ? "" : "s"} · pick up where you left off
            </p>
          </div>
          <Link
            href="/projects/new"
            className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-2 text-xs font-semibold text-background hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" /> New project
          </Link>
        </div>
      </div>

      <div className="px-4 py-7 sm:px-6 lg:px-8 max-w-7xl mx-auto space-y-6">
        {needsAttention.length > 0 && (
          <section className="rounded-lg border border-[var(--status-urgent)] bg-[var(--status-urgent-bg)] p-4">
            <p className="text-xs font-semibold text-[var(--status-urgent-fg)]">
              {needsAttention.length} project{needsAttention.length === 1 ? "" : "s"} stopped with an
              error
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {needsAttention.map((r) => (
                <Link
                  key={r.project.id}
                  href={projectPath(r.project.id, r.project.brandName, "/research")}
                  className="rounded-md border border-[var(--status-urgent)] bg-background px-2.5 py-1 text-[11px] font-medium"
                >
                  {r.project.brandName} →
                </Link>
              ))}
            </div>
          </section>
        )}

        <section className="space-y-2">
          <h2 className="text-sm font-semibold tracking-tight">Continue</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map(({ project, stages: st }) => {
              const next = st?.next ?? null;
              return (
                <Link
                  key={project.id}
                  href={
                    next
                      ? projectPath(project.id, project.brandName, next.href.split(`/${project.id}`)[1] ?? "/overview")
                      : projectPath(project.id, project.brandName, "/deliver")
                  }
                  className="rounded-lg border border-border bg-card p-3.5 hover:border-foreground/40 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold truncate">{project.brandName}</p>
                    <div className="flex gap-1 shrink-0">
                      {(st?.stages ?? []).map((s) => (
                        <span
                          key={s.id}
                          title={`${s.label}: ${s.detail}`}
                          className={`h-1.5 w-1.5 rounded-full ${STATE_DOT[s.state]}`}
                        />
                      ))}
                    </div>
                  </div>
                  <p className="mt-1.5 text-[11px] text-muted-foreground truncate">
                    {project.category || "Uncategorised"}
                  </p>
                  <p className="mt-2 flex items-center gap-1 text-xs font-medium">
                    {next ? next.action : "All stages done"}
                    <ArrowRight className="h-3 w-3" />
                  </p>
                </Link>
              );
            })}
          </div>
          {projects.length > recent.length && (
            <Link href="/all" className="inline-block text-xs font-medium text-muted-foreground hover:text-foreground">
              See all {projects.length} projects →
            </Link>
          )}
        </section>
      </div>
    </div>
  );
}
