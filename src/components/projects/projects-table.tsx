"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, ChevronRight, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { StatusBadge, type StatusLevel } from "@/components/dashboard/status-badge";
import { DeleteButton } from "@/components/projects/delete-button";
import { projectPath } from "@/lib/project-slug";
import { cn } from "@/lib/utils";

export interface ProjectRow {
  id: string;
  brandName: string;
  status: string;
  category: string | null;
  archived: boolean;
  competitors: string[];
  contentCount: number;
  insightCount: number;
}

const statusLevelMap: Record<string, StatusLevel> = {
  DRAFT: "neutral",
  RESEARCHING: "ai",
  ANALYZED: "healthy",
  GENERATING: "ai",
  COMPLETE: "healthy",
  ERROR: "urgent",
};

export function ProjectsTable({ projects }: { projects: ProjectRow[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const statuses = useMemo(
    () => ["all", ...Array.from(new Set(projects.map((p) => p.status)))],
    [projects]
  );

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return projects.filter((p) => {
      if (!showArchived && p.archived) return false;
      if (showArchived && !p.archived) return false;
      if (status !== "all" && p.status !== status) return false;
      if (!needle) return true;
      return (
        p.brandName.toLowerCase().includes(needle) ||
        (p.category || "").toLowerCase().includes(needle) ||
        p.competitors.some((c) => c.toLowerCase().includes(needle))
      );
    });
  }, [projects, q, status, showArchived]);

  async function toggleArchive(id: string, archived: boolean) {
    setBusy(id);
    try {
      await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: !archived }),
      });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const archivedCount = projects.filter((p) => p.archived).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search brand, category or competitor"
            className="h-9 rounded-md pl-8 text-sm"
          />
        </div>
        <div className="flex gap-1">
          {statuses.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                status === s
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {s === "all" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
        {archivedCount > 0 && (
          <button
            onClick={() => setShowArchived((v) => !v)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-medium",
              showArchived
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            Archived ({archivedCount})
          </button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {visible.length} of {projects.length} shown
      </p>

      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
          Nothing matches that filter.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Brand</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium">Category</th>
                <th className="px-3 py-2 text-left font-medium">Competitors</th>
                <th className="px-3 py-2 text-right font-medium">Ads</th>
                <th className="px-3 py-2 text-right font-medium">Insights</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => (
                <tr key={p.id} className="border-t border-border hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <Link
                      href={projectPath(p.id, p.brandName, "/overview")}
                      className="font-medium hover:underline"
                    >
                      {p.brandName}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge level={statusLevelMap[p.status] || "neutral"}>
                      {p.status.charAt(0) + p.status.slice(1).toLowerCase()}
                    </StatusBadge>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{p.category || "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground truncate max-w-[240px]">
                    {p.competitors.join(", ") || "—"}
                  </td>
                  <td className="px-3 py-2 text-right num">{p.contentCount}</td>
                  <td className="px-3 py-2 text-right num">{p.insightCount}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => toggleArchive(p.id, p.archived)}
                        disabled={busy === p.id}
                        title={p.archived ? "Restore" : "Archive"}
                        className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-40"
                      >
                        {p.archived ? (
                          <ArchiveRestore className="h-3.5 w-3.5" />
                        ) : (
                          <Archive className="h-3.5 w-3.5" />
                        )}
                      </button>
                      <DeleteButton projectId={p.id} />
                      <Link
                        href={projectPath(p.id, p.brandName, "/overview")}
                        className="rounded p-1 text-muted-foreground hover:text-foreground"
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
