"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { markStagesStale } from "@/lib/stage-events";
import { GOAL_TYPES, GOAL_TYPE_INFO, type GoalType } from "@/lib/style-categories";

/** Storytelling / conversion / hybrid as three explicit choices. */
export function GoalTypePicker({
  value,
  onChange,
  disabled,
}: {
  value: GoalType | null;
  onChange: (value: GoalType) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label="Creative goal" className="grid grid-cols-1 sm:grid-cols-3 gap-2">
      {GOAL_TYPES.map((g) => (
        <button
          key={g}
          type="button"
          role="radio"
          aria-checked={value === g}
          disabled={disabled}
          onClick={() => onChange(g)}
          className={cn(
            "rounded-lg border p-3 text-left transition-colors disabled:opacity-60",
            value === g ? "border-foreground bg-foreground/5" : "border-border hover:border-foreground/40"
          )}
        >
          <span className="block text-sm font-medium">{GOAL_TYPE_INFO[g].label}</span>
          <span className="block text-[11px] text-muted-foreground mt-0.5 leading-snug">
            {GOAL_TYPE_INFO[g].description}
          </span>
        </button>
      ))}
    </div>
  );
}

/** The picker bound to a saved project: changes are saved immediately. */
export function GoalTypeSetting({ projectId, initial }: { projectId: string; initial: GoalType | null }) {
  const router = useRouter();
  const [value, setValue] = useState<GoalType | null>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(next: GoalType) {
    const prev = value;
    setValue(next);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goalType: next }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      router.refresh();
      markStagesStale();
    } catch {
      setValue(prev);
      setError("Couldn't save the goal — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold tracking-tight">Creative goal</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Decides which competitor ads rank as “best”, which ad styles are recommended, and which script
          templates lead.
        </p>
      </div>
      <GoalTypePicker value={value} onChange={choose} disabled={saving} />
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
