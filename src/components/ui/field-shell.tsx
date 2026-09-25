"use client";

import type { ReactNode } from "react";
import { Check, CircleAlert, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { FIELD_LABEL, FIELD_TEXT, FIELD_TONE, type FieldStatus } from "@/lib/field-status";

const ICON: Record<FieldStatus, typeof Check> = {
  confirmed: Check,
  suggested: Sparkles,
  missing: CircleAlert,
};

/**
 * Wraps one input (or a group of inputs) in the green / yellow / red frame.
 * A suggested field shows a Confirm button so accepting a good suggestion is
 * one click.
 */
export function FieldShell({
  status,
  label,
  hint,
  onConfirm,
  confirming,
  optional,
  className,
  children,
}: {
  status: FieldStatus;
  /** Nice to have, not required to continue: an empty optional field is neutral, not red. */
  optional?: boolean;
  label?: ReactNode;
  hint?: ReactNode;
  onConfirm?: () => void;
  confirming?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const emptyOptional = optional && status === "missing";
  const Icon = ICON[status];
  return (
    <div
      data-field-status={emptyOptional ? "optional" : status}
      className={cn(
        "rounded-lg border p-3 space-y-2 transition-colors",
        emptyOptional ? "border-dashed border-border bg-muted/30" : FIELD_TONE[status],
        className
      )}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        {label && <div className="text-xs font-medium">{label}</div>}
        <div className="flex items-center gap-2 ml-auto">
          {emptyOptional ? (
            <span className="text-[11px] font-medium text-muted-foreground">Optional</span>
          ) : (
            <span className={cn("inline-flex items-center gap-1 text-[11px] font-medium", FIELD_TEXT[status])}>
              <Icon className="h-3 w-3" />
              {FIELD_LABEL[status]}
            </span>
          )}
          {status === "suggested" && onConfirm && (
            <button
              type="button"
              onClick={onConfirm}
              disabled={confirming}
              className="rounded border border-[var(--status-healthy)] bg-background px-1.5 py-0.5 text-[11px] font-medium text-[var(--status-healthy-fg)] hover:bg-[var(--status-healthy-bg)] disabled:opacity-50"
            >
              {confirming ? "Saving…" : "Confirm"}
            </button>
          )}
        </div>
      </div>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** The key, shown once at the top of a form. */
export function FieldLegend({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground", className)}>
      {(["confirmed", "suggested", "missing"] as FieldStatus[]).map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5">
          <span className={cn("h-3 w-3 rounded-sm border", FIELD_TONE[s])} />
          {s === "confirmed" ? "Confirmed by you" : s === "suggested" ? "Suggested by AI — check it" : "Needs your input"}
        </span>
      ))}
    </div>
  );
}
