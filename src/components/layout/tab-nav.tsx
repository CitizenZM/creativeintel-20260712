"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { LayoutDashboard, Film, Lightbulb, Wand2, Palette, PackageCheck } from "lucide-react";

interface TabNavProps {
  projectId: string;
}

const tabs = [
  { segment: "overview", label: "Setup", icon: LayoutDashboard, alsoMatches: [] as string[] },
  { segment: "content", label: "Research", icon: Film, alsoMatches: ["research"] },
  { segment: "insights", label: "Insights", icon: Lightbulb, alsoMatches: ["competitors"] },
  { segment: "creative", label: "Creative", icon: Wand2, alsoMatches: [] },
  { segment: "studio", label: "Studio", icon: Palette, alsoMatches: [] },
  { segment: "deliver", label: "Deliver", icon: PackageCheck, alsoMatches: [] },
];

export function TabNav({ projectId }: TabNavProps) {
  const pathname = usePathname();

  return (
    <div className="border-b border-border bg-background sticky top-14 lg:top-0 z-30">
      <div className="overflow-x-auto scrollbar-none max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <nav className="flex gap-6 min-w-max -mb-px">
          {tabs.map((tab, i) => {
            const href = `/projects/${projectId}/${tab.segment}`;
            const isActive = [tab.segment, ...tab.alsoMatches].some((s) =>
              pathname.startsWith(`/projects/${projectId}/${s}`)
            );
            const Icon = tab.icon;
            return (
              <Link
                key={tab.segment}
                href={href}
                className={cn(
                  "flex items-center gap-1.5 border-b-2 py-3 text-sm font-medium transition-colors whitespace-nowrap",
                  isActive
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                <span className="text-[10px] font-semibold text-muted-foreground/70">{i + 1}</span>
                <Icon className="h-4 w-4" strokeWidth={isActive ? 2.25 : 1.75} />
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
