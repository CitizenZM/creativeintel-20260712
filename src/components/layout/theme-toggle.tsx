"use client";

import { useEffect, useState } from "react";
import { Moon, Sun, Monitor } from "lucide-react";
import { cn } from "@/lib/utils";

type Mode = "light" | "dark" | "system";

function apply(mode: Mode) {
  const dark = mode === "dark" || (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>("system");

  useEffect(() => {
    try {
      const saved = (localStorage.getItem("ci-theme") as Mode | null) ?? "system";
      setMode(saved);
      apply(saved);
    } catch {}
  }, []);

  function choose(next: Mode) {
    setMode(next);
    try {
      localStorage.setItem("ci-theme", next);
    } catch {}
    apply(next);
  }

  const opts: Array<{ id: Mode; icon: typeof Sun; label: string }> = [
    { id: "light", icon: Sun, label: "Light" },
    { id: "dark", icon: Moon, label: "Dark" },
    { id: "system", icon: Monitor, label: "System" },
  ];

  return (
    <div className="flex items-center gap-1 rounded-md bg-muted/50 p-1">
      {opts.map((o) => {
        const Icon = o.icon;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => choose(o.id)}
            title={o.label}
            aria-label={o.label}
            className={cn(
              "flex flex-1 items-center justify-center rounded px-2 py-1 transition-colors",
              mode === o.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}
