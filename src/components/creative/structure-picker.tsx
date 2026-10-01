"use client";

import { useEffect, useState } from "react";
import { Layers, Loader2 } from "lucide-react";

interface Structure {
  id: string;
  name: string;
  category: string | null;
  sourceTitle: string;
  sourceOwner: string | null;
  sourceViews: number | null;
  hookType: string | null;
  durationSec: number | null;
  beats: { startSec?: number; endSec?: number; role?: string }[];
  timesUsed: number;
}

const views = (n: number | null) => (!n ? "" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M views` : n >= 1e3 ? `${Math.round(n / 1e3)}K views` : `${n} views`);

/**
 * Which proven ad structure the scripts follow: automatic (the most-viewed ad
 * torn down in this project) or one saved in the structure library — from any
 * brand, same category first.
 */
export function StructurePicker({ projectId }: { projectId: string }) {
  const [list, setList] = useState<Structure[] | null>(null);
  const [current, setCurrent] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const sel = (await fetch(`/api/projects/${projectId}/structure`, { cache: "no-store" }).then((r) => r.json())) as { structureId: string | null; category: string | null };
      const lib = (await fetch(`/api/structures${sel.category ? `?category=${encodeURIComponent(sel.category)}` : ""}`, { cache: "no-store" }).then((r) => r.json())) as { structures: Structure[] };
      if (!alive) return;
      setCurrent(sel.structureId ?? "");
      setList(lib.structures ?? []);
    })().catch(() => alive && setList([]));
    return () => {
      alive = false;
    };
  }, [projectId]);

  async function choose(id: string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/structure`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ structureId: id || null }),
      });
      if (res.ok) setCurrent(id);
    } finally {
      setSaving(false);
    }
  }

  if (!list) return null;
  const picked = list.find((s) => s.id === current);
  return (
    <div className="rounded-md border border-border bg-background/80 px-3 py-2 text-xs" data-testid="structure-picker">
      <div className="flex flex-wrap items-center gap-2">
        <Layers className="h-3.5 w-3.5 text-muted-foreground" />
        <label htmlFor="structure" className="font-medium">
          Structure to follow
        </label>
        <select
          id="structure"
          value={current}
          disabled={saving}
          onChange={(e) => void choose(e.target.value)}
          className="h-8 min-w-0 max-w-full flex-1 rounded-md border border-border bg-background px-2 text-xs sm:max-w-md"
        >
          <option value="">Automatic — the most-viewed ad torn down in this project</option>
          {list.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.sourceViews ? ` · ${views(s.sourceViews)}` : ""}
              {s.category ? ` · ${s.category}` : ""}
            </option>
          ))}
        </select>
        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {picked
          ? `Scripts mirror "${picked.sourceTitle.slice(0, 70)}" — ${picked.beats.map((b) => b.role ?? "beat").join(" → ")} — in structure and pace, never its words or footage.`
          : list.length
            ? "Save more structures with “Save structure” on any teardown (Competitors → an ad)."
            : "No saved structures yet — use “Save structure” on a competitor ad's teardown."}
      </p>
    </div>
  );
}
