"use client";

import { useState } from "react";
import { BookmarkPlus, Check, Loader2 } from "lucide-react";

/** Save this ad's structure (hook, beat timeline, proof) to the cross-brand structure library. */
export function SaveStructureButton({ projectId, teardownId }: { projectId: string; teardownId: string }) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setState("saving");
    setError(null);
    try {
      const res = await fetch("/api/structures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, teardownId }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Could not save (${res.status})`);
      setState("saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
      setState("error");
    }
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={save}
        disabled={state === "saving" || state === "saved"}
        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium hover:border-foreground/40 disabled:opacity-70"
        title="Save this ad's hook, beat timeline and proof devices as a reusable structure"
      >
        {state === "saving" ? <Loader2 className="h-3 w-3 animate-spin" /> : state === "saved" ? <Check className="h-3 w-3" /> : <BookmarkPlus className="h-3 w-3" />}
        {state === "saved" ? "Saved to structures" : "Save structure"}
      </button>
      {error && <span className="text-[11px] text-[var(--status-urgent-fg)]">{error}</span>}
    </span>
  );
}
