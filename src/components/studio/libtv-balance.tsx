"use client";

import { useCallback, useEffect, useState } from "react";
import type { BalanceEstimate } from "@/services/video-gen/libtv-balance";

function when(iso: string) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * Estimated LibTV credits left. LibTV only shows the balance in its own UI,
 * so the user records it here once; every finished run is subtracted after.
 * `need` (the next run's estimate) turns the line red when it will not fit.
 */
export function LibtvBalance({ need, refreshKey }: { need?: number; refreshKey?: unknown }) {
  const [data, setData] = useState<BalanceEstimate | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/libtv/balance")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setData(d))
      .catch(() => {});
  }, []);
  useEffect(load, [load, refreshKey]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/libtv/balance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ balance: Number(draft) }),
    }).catch(() => null);
    const d = await res?.json().catch(() => null);
    if (!res?.ok) return setError(d?.error || "Couldn't save the balance");
    setData(d);
    setEditing(false);
    setDraft("");
  }

  const short = data?.estimate != null && need != null && need > data.estimate;

  return (
    <div className="space-y-1">
      {data?.estimate != null ? (
        <p className={short ? "font-medium text-red-700" : "text-muted-foreground"}>
          ≈ <span className={short ? "" : "font-semibold text-foreground"}>{data.estimate} credits</span> left on
          LibTV
          {short ? ` — the next run needs ${need}. Top up at liblib.tv before approving.` : ""}
          <span className="block text-[11px] text-muted-foreground">
            You entered {data.recorded} on {when(data.recordedAt!)}; {data.spentSince} spent since across{" "}
            {data.runsSince} run{data.runsSince === 1 ? "" : "s"}.{" "}
            <button type="button" onClick={() => setEditing(true)} className="underline hover:text-foreground">
              Update
            </button>
          </span>
        </p>
      ) : (
        <p className="text-muted-foreground">
          LibTV balance unknown —{" "}
          <button type="button" onClick={() => setEditing(true)} className="underline hover:text-foreground">
            enter it from liblib.tv
          </button>{" "}
          and runs are subtracted automatically.
        </p>
      )}
      {editing && (
        <form onSubmit={save} className="flex items-center gap-2">
          <label htmlFor="libtv-balance" className="text-[11px] text-muted-foreground">
            Credits shown in LibTV now
          </label>
          <input
            id="libtv-balance"
            type="number"
            min={0}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-28 rounded-md border border-border bg-background px-2 py-1 text-xs"
            autoFocus
          />
          <button type="submit" disabled={!draft} className="rounded-md bg-foreground px-2 py-1 text-[11px] font-medium text-background disabled:opacity-50">
            Save
          </button>
          <button type="button" onClick={() => setEditing(false)} className="text-[11px] text-muted-foreground">
            Cancel
          </button>
        </form>
      )}
      {error && <p className="text-[11px] text-red-700">{error}</p>}
    </div>
  );
}
