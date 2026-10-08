"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Menu,
  X,
  LayoutGrid,
  FolderKanban,
  Plus,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Home", icon: LayoutGrid },
  { href: "/all", label: "Projects", icon: FolderKanban },
  { href: "/projects/new", label: "New project", icon: Plus },
];

export function Topbar({ account }: { account?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <>
      <header className="lg:hidden fixed top-0 inset-x-0 z-40 flex h-14 items-center gap-3 border-b border-border bg-background/90 backdrop-blur px-4">
        <button
          onClick={() => setOpen(true)}
          className="rounded-md p-1.5 hover:bg-muted transition-colors"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-foreground text-background">
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          <span className="text-sm font-semibold tracking-tight">
            CreativeIntel
          </span>
        </Link>
        {account && <div className="ml-auto flex items-center">{account}</div>}
      </header>

      {open && (
        <div
          className="lg:hidden fixed inset-0 z-50 bg-foreground/40"
          onClick={() => setOpen(false)}
        />
      )}

      <aside
        className={cn(
          "lg:hidden fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-border bg-sidebar transition-transform duration-200",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-14 items-center justify-between border-b border-border px-5">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground text-background">
              <Sparkles className="h-4 w-4" />
            </div>
            <span className="text-sm font-semibold tracking-tight">
              CreativeIntel
            </span>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="rounded-md p-1 hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <nav className="flex-1 space-y-0.5 p-3">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.href === "/"
                ? pathname === "/"
                : pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
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
        </nav>
      </aside>
    </>
  );
}
