"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Same card shell as the Deliver performance panel. */
export function Panel({ icon, title, description, actions, children, testId, className }: { icon?: ReactNode; title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode; testId?: string; className?: string }) {
  return (
    <section className={cn("rounded-xl border border-border bg-card p-4", className)} data-testid={testId}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            {icon} {title}
          </h3>
          {description && <p className="mt-1 max-w-prose text-xs text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

export const btn =
  "inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted disabled:pointer-events-none disabled:opacity-60";
export const btnPrimary =
  "inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-semibold text-background hover:opacity-90 disabled:pointer-events-none disabled:opacity-60";
export const linkChip = "inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[11px] font-medium hover:bg-muted";
export const inputCls = "h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

export function Label({ children }: { children: ReactNode }) {
  return <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{children}</span>;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-xs text-[var(--status-urgent-fg)]">
      {children}
    </p>
  );
}

/** A toggle chip for multi-selects (checkbox semantics). */
export function Chip({ checked, onChange, children, title, disabled }: { checked: boolean; onChange: (next: boolean) => void; children: ReactNode; title?: string; disabled?: boolean }) {
  return (
    <label
      title={title}
      className={cn(
        "inline-flex cursor-pointer items-center rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
        checked ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
        disabled && "pointer-events-none opacity-50"
      )}
    >
      <input type="checkbox" className="sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

export function toggle<T>(list: T[], value: T, on: boolean): T[] {
  return on ? (list.includes(value) ? list : [...list, value]) : list.filter((v) => v !== value);
}

const TONE: Record<string, string> = {
  ok: "bg-[var(--status-healthy-bg)] text-[var(--status-healthy-fg)]",
  warn: "bg-[var(--status-attention-bg)] text-[var(--status-attention-fg)]",
  bad: "bg-[var(--status-urgent-bg)] text-[var(--status-urgent-fg)]",
  muted: "bg-muted text-muted-foreground",
};

export function Pill({ tone = "muted", children }: { tone?: "ok" | "warn" | "bad" | "muted"; children: ReactNode }) {
  return <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold", TONE[tone])}>{children}</span>;
}
