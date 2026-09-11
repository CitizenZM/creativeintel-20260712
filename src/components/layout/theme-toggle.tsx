"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun, Monitor } from "lucide-react";
import { cn } from "@/lib/utils";

type Mode = "light" | "dark" | "system";

const KEY = "ci-theme";
const listeners = new Set<() => void>();

function read(): Mode {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

function apply(mode: Mode) {
  const dark = mode === "dark" || (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

function write(mode: Mode) {
  try {
    localStorage.setItem(KEY, mode);
  } catch {}
  apply(mode);
  listeners.forEach((l) => l());
}

const OPTIONS: Array<{ id: Mode; icon: typeof Sun; label: string }> = [
  { id: "light", icon: Sun, label: "Light" },
  { id: "dark", icon: Moon, label: "Dark" },
  { id: "system", icon: Monitor, label: "System" },
];

export function ThemeToggle() {
  const mode = useSyncExternalStore(subscribe, read, () => "system" as Mode);

  return (
    <div className="flex items-center gap-1 rounded-md bg-muted/50 p-1">
      {OPTIONS.map((o) => {
        const Icon = o.icon;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => write(o.id)}
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
