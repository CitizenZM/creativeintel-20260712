"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { LayoutDashboard, Film, Lightbulb, Wand2, Palette, PackageCheck, Library, Check } from "lucide-react";
import { useProjectStages } from "./use-project-stages";
import type { ProjectStage } from "@/services/project-stages";

interface TabNavProps {
  projectId: string;
}

const tabs: { segment: string; label: string; icon: typeof Film; alsoMatches: string[]; stage: ProjectStage["id"] }[] = [
  { segment: "overview", label: "Setup", icon: LayoutDashboard, alsoMatches: [], stage: "setup" },
  { segment: "content", label: "Research", icon: Film, alsoMatches: ["research"], stage: "research" },
  { segment: "insights", label: "Insights", icon: Lightbulb, alsoMatches: ["competitors"], stage: "insights" },
  { segment: "creative", label: "Creative", icon: Wand2, alsoMatches: [], stage: "creative" },
  { segment: "studio", label: "Studio", icon: Palette, alsoMatches: [], stage: "studio" },
  { segment: "deliver", label: "Deliver", icon: PackageCheck, alsoMatches: [], stage: "deliver" },
];

export function TabNav({ projectId }: TabNavProps) {
  const pathname = usePathname();
  const { data } = useProjectStages(projectId);
  const stateOf = (id: ProjectStage["id"]) => data?.stages.find((s) => s.id === id)?.state;

  return (
    <div className="border-b border-border bg-background sticky top-14 lg:top-0 z-30">
      <div className="overflow-x-auto scrollbar-none max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <nav className="flex gap-2 sm:gap-3 min-w-max -mb-px">
          {tabs.map((tab, i) => {
            const href = `/projects/${projectId}/${tab.segment}`;
            const isActive = [tab.segment, ...tab.alsoMatches].some((s) =>
              pathname.startsWith(`/projects/${projectId}/${s}`)
            );
            const Icon = tab.icon;
            const state = stateOf(tab.stage);
            // Unfinished steps are red so the next thing to do is obvious;
            // finished ones are green.
            const tone =
              state === "done"
                ? "text-[var(--status-healthy-fg)]"
                : state
                  ? "text-[var(--status-urgent-fg)]"
                  : "";
            return (
              <Link
                key={tab.segment}
                href={href}
                title={state === "done" ? `${tab.label}: complete` : state ? `${tab.label}: not finished` : undefined}
                className={cn(
                  "my-1.5 flex items-center gap-1.5 rounded-md border-b-2 px-2 py-1.5 text-sm font-medium transition-colors whitespace-nowrap",
                  state && state !== "done" && "bg-[color-mix(in_oklab,var(--status-urgent-bg)_55%,transparent)]",
                  state === "done" && "bg-[color-mix(in_oklab,var(--status-healthy-bg)_45%,transparent)]",
                  isActive
                    ? "border-foreground text-foreground"
                    : cn("border-transparent hover:text-foreground", tone || "text-muted-foreground")
                )}
              >
                <span className="text-[10px] font-semibold opacity-70">{i + 1}</span>
                {state === "done" ? (
                  <Check className="h-4 w-4" strokeWidth={2.25} />
                ) : (
                  <Icon className="h-4 w-4" strokeWidth={isActive ? 2.25 : 1.75} />
                )}
                {tab.label}
              </Link>
            );
          })}
          {/* Not a stage — the archive of everything generated, so no step number. */}
          <Link
            href={`/projects/${projectId}/library`}
            className={cn(
              "ml-auto flex items-center gap-1.5 border-b-2 py-3 text-sm font-medium transition-colors whitespace-nowrap",
              pathname.startsWith(`/projects/${projectId}/library`)
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <Library className="h-4 w-4" />
            Library
          </Link>
        </nav>
      </div>
    </div>
  );
}
