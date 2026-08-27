"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, Plus, Loader2 } from "lucide-react";

interface Workspace {
  id: string;
  name: string;
  _count?: { projects: number };
}

export function WorkspaceSwitcher() {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  async function load() {
    try {
      const res = await fetch("/api/workspaces");
      const data = await res.json().catch(() => null);
      if (data?.workspaces) {
        setWorkspaces(data.workspaces);
        setActiveId(data.activeId);
      }
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, []);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function switchTo(id: string) {
    if (id === activeId) {
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      await fetch("/api/workspaces/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      setActiveId(id);
      setOpen(false);
      router.refresh();
      load(); // refresh project-count badges for the new active workspace
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => null);
      if (data?.workspace) {
        setNewName("");
        setCreating(false);
        setOpen(false);
        await load();
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  const active = workspaces.find((w) => w.id === activeId);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-left text-xs hover:bg-sidebar-accent/50 transition-colors"
      >
        <span className="flex h-5 w-5 items-center justify-center rounded bg-foreground/10 text-[10px] font-semibold uppercase">
          {(active?.name || "W").slice(0, 1)}
        </span>
        <span className="flex-1 truncate font-medium">
          {active?.name || "Workspace"}
        </span>
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        ) : (
          <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-md border border-border bg-background shadow-md p-1">
          <div className="max-h-60 overflow-y-auto">
            {workspaces.map((w) => (
              <button
                key={w.id}
                onClick={() => switchTo(w.id)}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-sidebar-accent/60 transition-colors"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded bg-foreground/10 text-[10px] font-semibold uppercase">
                  {w.name.slice(0, 1)}
                </span>
                <span className="flex-1 truncate">{w.name}</span>
                {w._count && (
                  <span className="text-[10px] text-muted-foreground">
                    {w._count.projects}
                  </span>
                )}
                {w.id === activeId && <Check className="h-3.5 w-3.5" />}
              </button>
            ))}
          </div>

          <div className="my-1 h-px bg-border" />

          {creating ? (
            <div className="flex items-center gap-1 p-1">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") create();
                  if (e.key === "Escape") setCreating(false);
                }}
                placeholder="Workspace name"
                className="flex-1 rounded-sm border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-foreground/40"
              />
              <button
                onClick={create}
                disabled={busy || !newName.trim()}
                className="rounded-sm bg-foreground px-2 py-1 text-xs text-background disabled:opacity-50"
              >
                Add
              </button>
            </div>
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              New workspace
            </button>
          )}
        </div>
      )}
    </div>
  );
}
