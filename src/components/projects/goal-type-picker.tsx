"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { markStagesStale } from "@/lib/stage-events";
import { GOAL_TYPES, GOAL_TYPE_INFO, type GoalType } from "@/lib/style-categories";
import { FieldShell, FieldLegend } from "@/components/ui/field-shell";
import { fieldStatus, readStatusMap } from "@/lib/field-status";
import { Input } from "@/components/ui/input";
import { Check, Loader2 } from "lucide-react";

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

/**
 * The picker bound to a saved project, plus the campaign goal text field.
 * Both are part of the Setup page's Campaign Context Selection section and
 * carry the green/yellow/red review state (see src/lib/field-status.ts).
 */
export function GoalTypeSetting({
  projectId,
  initial,
  initialCampaignGoal,
  initialFieldStatus,
}: {
  projectId: string;
  initial: GoalType | null;
  initialCampaignGoal?: string | null;
  initialFieldStatus?: unknown;
}) {
  const router = useRouter();
  const [value, setValue] = useState<GoalType | null>(initial);
  const [goalDraft, setGoalDraft] = useState(initialCampaignGoal || "");
  const [editingGoal, setEditingGoal] = useState(false);
  const [marks, setMarks] = useState(readStatusMap(initialFieldStatus));
  const [saving, setSaving] = useState(false);
  const [confirmingField, setConfirmingField] = useState<string | null>(null);
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
      const updated = await res.json();
      setMarks(readStatusMap(updated.fieldStatus));
      router.refresh();
      markStagesStale();
    } catch {
      setValue(prev);
      setError("Couldn't save the goal — try again.");
    } finally {
      setSaving(false);
    }
  }

  async function saveCampaignGoal() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignGoal: goalDraft }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      const updated = await res.json();
      setMarks(readStatusMap(updated.fieldStatus));
      setEditingGoal(false);
      router.refresh();
      markStagesStale();
    } catch {
      setError("Couldn't save the campaign goal — try again.");
    } finally {
      setSaving(false);
    }
  }

  async function confirmField(field: string) {
    setConfirmingField(field);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirmField", field }),
      });
      if (res.ok) {
        const updated = await res.json();
        setMarks(readStatusMap(updated.fieldStatus));
        router.refresh();
        markStagesStale();
      }
    } finally {
      setConfirmingField(null);
    }
  }

  const goalStatus = fieldStatus(goalDraft, marks.campaignGoal);
  const goalTypeStatus = fieldStatus(value, marks.goalType);

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      <FieldLegend />

      <FieldShell
        status={goalStatus}
        label={<span className="text-sm font-semibold tracking-tight">Campaign goal</span>}
        hint="What this campaign should achieve — one sentence."
        onConfirm={goalStatus === "suggested" ? () => confirmField("campaignGoal") : undefined}
        confirming={confirmingField === "campaignGoal"}
      >
        {editingGoal ? (
          <div className="flex gap-2">
            <Input
              value={goalDraft}
              onChange={e => setGoalDraft(e.target.value)}
              className="h-8 text-sm flex-1"
              autoFocus
              onKeyDown={e => { if (e.key === "Enter") saveCampaignGoal(); if (e.key === "Escape") setEditingGoal(false); }}
            />
            <button onClick={saveCampaignGoal} className="p-2 rounded hover:bg-muted" disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5 text-emerald-600" />}
            </button>
          </div>
        ) : (
          <button onClick={() => setEditingGoal(true)} className="text-sm text-left w-full hover:bg-muted/50 rounded px-2 py-1 transition-colors">
            {goalDraft || <span className="text-muted-foreground italic">Click to set the campaign goal…</span>}
          </button>
        )}
      </FieldShell>

      <FieldShell
        status={goalTypeStatus}
        label={<span className="text-sm font-semibold tracking-tight">Creative goal type</span>}
        hint="Decides which competitor ads rank as “best”, which ad styles are recommended, and which script templates lead."
        onConfirm={goalTypeStatus === "suggested" ? () => confirmField("goalType") : undefined}
        confirming={confirmingField === "goalType"}
      >
        <GoalTypePicker value={value} onChange={choose} disabled={saving} />
      </FieldShell>

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
