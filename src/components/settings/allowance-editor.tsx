"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const usd = (n: number) => `$${n.toFixed(2)}`;

/**
 * A member's monthly paid-AI allowance on /settings/users: used / allowance this month, and an inline
 * editor (POST /api/settings/users/[id] { monthlyAllowanceUsd }). Empty = back to the default.
 */
export function AllowanceEditor({
  id,
  spentUsd,
  allowanceUsd,
  custom,
}: {
  id: string;
  spentUsd: number;
  allowanceUsd: number;
  custom: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(custom ? String(allowanceUsd) : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const value = draft.trim() === "" ? null : Number(draft);
    if (value !== null && (!Number.isFinite(value) || value < 0)) return setError("Enter a dollar amount");
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/settings/users/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ monthlyAllowanceUsd: value }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setError("Couldn't save");
    setEditing(false);
    router.refresh();
  }

  const over = spentUsd >= allowanceUsd;
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="tabular-nums underline-offset-4 hover:underline"
        title="Paid AI used this month / monthly allowance — click to change"
      >
        <span className={over ? "text-destructive" : undefined}>{usd(spentUsd)}</span>
        <span className="text-muted-foreground"> / {usd(allowanceUsd)}</span>
        {!custom && <span className="text-muted-foreground"> (default)</span>}
      </button>
    );
  }
  return (
    <form onSubmit={save} className="flex items-center gap-1.5">
      <Input
        autoFocus
        inputMode="decimal"
        placeholder="default"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="h-7 w-20"
        aria-label="Monthly allowance in USD"
      />
      <Button size="sm" type="submit" disabled={busy}>
        {busy ? "…" : "Save"}
      </Button>
      <Button size="sm" type="button" variant="ghost" onClick={() => setEditing(false)}>
        Cancel
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </form>
  );
}
