"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pin, EyeOff, Eye, X, Plus, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Pin (always analysed, shown first) or exclude (hidden, never analysed) one
 * collected ad. Sits inside the card's link, so clicks must not navigate.
 */
export function AdCurationButtons({
  projectId,
  assetId,
  pinned,
  excluded,
}: {
  projectId: string;
  assetId: string;
  pinned: boolean;
  excluded: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState({ pinned, excluded });
  const [busy, setBusy] = useState(false);

  async function update(e: React.MouseEvent, patch: Partial<typeof state>) {
    e.preventDefault();
    e.stopPropagation();
    const prev = state;
    setState({ ...state, ...patch, ...(patch.excluded ? { pinned: false } : {}) });
    setBusy(true);
    const res = await fetch(`/api/projects/${projectId}/content/${assetId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) setState(prev);
    else router.refresh();
  }

  const btn = "inline-flex items-center gap-1 rounded bg-background/90 backdrop-blur-sm px-1.5 py-0.5 text-[10px] font-medium disabled:opacity-60";
  return (
    <div className="flex items-center gap-1">
      {!state.excluded && (
        <button
          type="button"
          disabled={busy}
          onClick={(e) => update(e, { pinned: !state.pinned })}
          aria-pressed={state.pinned}
          title={state.pinned ? "Unpin" : "Pin — always analysed and shown first"}
          className={cn(btn, state.pinned ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
        >
          <Pin className={cn("h-3 w-3", state.pinned && "fill-foreground")} />
          {state.pinned ? "Pinned" : "Pin"}
        </button>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={(e) => update(e, { excluded: !state.excluded })}
        title={state.excluded ? "Use this ad again" : "Exclude — hide it and keep it out of analysis"}
        className={cn(btn, "text-muted-foreground hover:text-foreground")}
      >
        {state.excluded ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
        {state.excluded ? "Include" : "Exclude"}
      </button>
    </div>
  );
}

interface CompetitorRow {
  id: string;
  name: string;
  url: string | null;
  excluded: boolean;
  adCount: number;
}

/** Confirm, remove or add the competitors research covers. */
export function CompetitorManager({ projectId, competitors }: { projectId: string; competitors: CompetitorRow[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const active = competitors.filter((c) => !c.excluded);
  const removed = competitors.filter((c) => c.excluded);

  async function setExcluded(c: CompetitorRow, excluded: boolean) {
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/projects/${projectId}/competitors/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ excluded }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setMessage("Couldn't save that change — try again.");
    setMessage(excluded ? `${c.name} removed — its ads are hidden and no longer analysed.` : `${c.name} restored.`);
    router.refresh();
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/projects/${projectId}/competitors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, url: url || undefined }),
    }).catch(() => null);
    const data = await res?.json().catch(() => ({}));
    setBusy(false);
    if (!res?.ok) return setMessage(data?.error || "Couldn't add that competitor.");
    setMessage(`${name.trim()} added — re-run research to collect their ads.`);
    setName("");
    setUrl("");
    router.refresh();
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold tracking-tight">Competitors researched</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Remove any that are not real competitors, or add ones research missed.
        </p>
      </div>
      <ul className="flex flex-wrap gap-2">
        {active.map((c) => (
          <li key={c.id} className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs">
            <span className="font-medium">{c.name}</span>
            <span className="text-muted-foreground num">{c.adCount} ads</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => setExcluded(c, true)}
              aria-label={`Remove ${c.name}`}
              className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </li>
        ))}
        {removed.map((c) => (
          <li key={c.id} className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-muted-foreground">
            <span className="line-through">{c.name}</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => setExcluded(c, false)}
              aria-label={`Restore ${c.name}`}
              className="inline-flex items-center gap-0.5 hover:text-foreground"
            >
              <RotateCcw className="h-3 w-3" /> Restore
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="flex flex-wrap gap-2">
        <label htmlFor="competitor-name" className="sr-only">Competitor name</label>
        <input
          id="competitor-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Competitor name"
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
        />
        <label htmlFor="competitor-url" className="sr-only">Competitor website</label>
        <input
          id="competitor-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Website (optional)"
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="inline-flex items-center gap-1 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-50"
        >
          <Plus className="h-3 w-3" /> Add competitor
        </button>
      </form>
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}
