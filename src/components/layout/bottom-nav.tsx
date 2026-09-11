"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { LayoutGrid, FolderKanban, Film, Lightbulb, Wand2, Palette, Library } from "lucide-react";

interface Tab {
  href: string;
  label: string;
  icon: typeof LayoutGrid;
  match: (p: string) => boolean;
}

const globalTabs: Tab[] = [
  { href: "/", label: "Home", icon: LayoutGrid, match: (p) => p === "/" },
  { href: "/all", label: "Projects", icon: FolderKanban, match: (p) => p.startsWith("/all") },
  { href: "/projects/new", label: "New", icon: Wand2, match: (p) => p.startsWith("/projects/new") },
  { href: "/library/brands", label: "Library", icon: Library, match: (p) => p.startsWith("/library") },
];

function projectTabs(projectId: string): Tab[] {
  const b = `/projects/${projectId}`;
  return [
    { href: `${b}/overview`, label: "Setup", icon: LayoutGrid, match: (p) => p.includes("/overview") },
    { href: `${b}/content`, label: "Research", icon: Film, match: (p) => p.includes("/content") || p.includes("/research") },
    { href: `${b}/insights`, label: "Insights", icon: Lightbulb, match: (p) => p.includes("/insights") || p.includes("/competitors") },
    { href: `${b}/creative`, label: "Create", icon: Wand2, match: (p) => p.includes("/creative") },
    { href: `${b}/studio`, label: "Studio", icon: Palette, match: (p) => p.includes("/studio") || p.includes("/deliver") },
  ];
}

export function BottomNav() {
  const pathname = usePathname();
  const projectMatch = pathname.match(/^\/projects\/([^/]+)/);
  const projectId = projectMatch?.[1];
  const tabs = projectId && projectId !== "new" ? projectTabs(projectId) : globalTabs;

  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border bg-background/95 backdrop-blur">
      <div className="flex items-stretch justify-around">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = tab.match(pathname);
          return (
            <Link
              key={tab.label}
              href={tab.href}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-0.5 py-2.5 transition-colors",
                isActive ? "text-foreground" : "text-muted-foreground"
              )}
            >
              <Icon className="h-5 w-5" strokeWidth={isActive ? 2.25 : 1.75} />
              <span className="text-[10px] font-medium">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
