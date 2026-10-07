"use client";

import { useState } from "react";
import Link from "next/link";
import { Copy, Loader2 } from "lucide-react";

interface CloneReply {
  label: string;
  hook: { hookId: string; name: string };
  endCard: { id: string };
  error?: string;
}

/**
 * Ad Cloner: this ad's structure (hook, beat timeline, close) rebuilt for our product and merged into the
 * campaign plan as "Cloned from <ref>" — one copy-writing model call. Links to the Planning tab after.
 */
export function CloneAdButton({ projectId, teardownId, structureId }: { projectId: string; teardownId?: string; structureId?: string }) {
  const [state, setState] = useState<"idle" | "cloning" | "done" | "error">("idle");
  const [result, setResult] = useState<CloneReply | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function clone() {
    setState("cloning");
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/clone-ad`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(teardownId ? { teardownId } : { structureId }),
      });
      const data = (await res.json().catch(() => ({}))) as CloneReply;
      if (!res.ok) throw new Error(data.error ?? `Could not clone (${res.status})`);
      setResult(data);
      setState("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not clone");
      setState("error");
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={clone}
        disabled={state === "cloning"}
        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium hover:border-foreground/40 disabled:opacity-70"
        title="Rebuild this ad's structure for our product and add it to the campaign plan (one copy-writing model call)"
      >
        {state === "cloning" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Copy className="h-3 w-3" />}
        {state === "done" ? "Clone again" : "Clone this ad"}
      </button>
      {state === "done" && result && (
        <Link href={`/projects/${projectId}/planning`} className="text-[11px] font-medium underline underline-offset-2">
          {result.label} · {result.hook.hookId} + {result.endCard.id} → open Planning
        </Link>
      )}
      {error && <span className="text-[11px] text-[var(--status-urgent-fg)]">{error}</span>}
    </span>
  );
}
