"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, LayoutGrid, FolderKanban, Plus, Sparkles, Library } from "lucide-react";
import { cn } from "@/lib/utils";
import { WorkspaceSwitcher } from "@/components/layout/workspace-switcher";
import { StageRail } from "@/components/layout/stage-rail";
import { ThemeToggle } from "@/components/layout/theme-toggle";

const navItems = [
  { href: "/", label: "Home", icon: LayoutGrid },
  { href: "/all", label: "Projects", icon: FolderKanban },
  { href: "/projects/new", label: "New project", icon: Plus },
  { href: "/library/brands", label: "Brand library", icon: Library },
  { href: "/status", label: "System status", icon: Activity },
];

export function Sidebar() {
  const pathname = usePathname();
  const projectMatch = pathname.match(/^\/projects\/([^/]+)/);
  const projectId = projectMatch?.[1] && projectMatch[1] !== "new" ? projectMatch[1] : null;

  return (
    <aside className="hidden lg:flex fixed inset-y-0 left-0 z-40 w-60 flex-col border-r border-border bg-sidebar">
      <div className="flex h-14 items-center gap-2 border-b border-border px-5">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground text-background">
          <Sparkles className="h-4 w-4" />
        </div>
        <span className="text-sm font-semibold tracking-tight">CreativeIntel</span>
      </div>

      <div className="px-3 pt-3">
        <WorkspaceSwitcher />
      </div>

      <nav className="flex-1 overflow-y-auto">
        <div className="space-y-0.5 p-3 pb-0">
          <p className="px-2 pb-1.5 pt-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Navigation
          </p>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </div>
        {projectId && <StageRail projectId={projectId} />}
      </nav>

      <div className="border-t border-border p-3">
        <ThemeToggle />
      </div>
    </aside>
  );
}
