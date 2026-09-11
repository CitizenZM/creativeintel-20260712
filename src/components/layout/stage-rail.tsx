"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, Circle, CircleDot } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProjectStages } from "@/services/project-stages";

const STAGE_SEGMENTS: Record<string, string[]> = {
  setup: ["overview"],
  research: ["content", "research"],
  insights: ["insights", "competitors"],
  creative: ["creative"],
  studio: ["studio"],
  deliver: ["deliver"],
};

export function StageRail({ projectId, compact = false }: { projectId: string; compact?: boolean }) {
  const pathname = usePathname();
  const [data, setData] = useState<ProjectStages | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch(`/api/projects/${projectId}/stages`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!cancelled && d) setData(d);
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [projectId, pathname]);

  const stages = data?.stages ?? [];

  return (
    <div className={cn("space-y-0.5", compact ? "" : "p-3")}>
      {!compact && (
        <p className="px-2 pb-1.5 pt-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Pipeline
        </p>
      )}
      {(stages.length
        ? stages
        : (["setup", "research", "insights", "creative", "studio", "deliver"] as const).map((id) => ({
            id,
            label: id[0].toUpperCase() + id.slice(1),
            href: `/projects/${projectId}/${id === "setup" ? "overview" : id === "research" ? "content" : id}`,
            state: "todo" as const,
            detail: "",
          }))
      ).map((s, i) => {
        const active = STAGE_SEGMENTS[s.id]?.some((seg) => pathname.includes(`/projects/${projectId}/${seg}`));
        const Icon = s.state === "done" ? Check : s.state === "partial" ? CircleDot : Circle;
        return (
          <Link
            key={s.id}
            href={s.href}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
            )}
          >
            <span
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px]",
                s.state === "done" && "border-emerald-500 bg-emerald-500 text-white",
                s.state === "partial" && "border-amber-500 text-amber-600",
                s.state === "todo" && "border-border text-muted-foreground"
              )}
            >
              {s.state === "done" ? <Icon className="h-3 w-3" /> : i + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block leading-tight">{s.label}</span>
              {!compact && s.detail && (
                <span className="block truncate text-[10px] text-muted-foreground">{s.detail}</span>
              )}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
