"use client";

import { useState } from "react";
import { CheckCircle2, Circle, Loader2, XCircle, MinusCircle, RotateCcw, X } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { JobView } from "@/services/jobs";

import { formatDuration } from "@/lib/format-duration";

export { formatDuration };

const STATUS_LABEL: Record<string, string> = {
  queued: "Starting",
  running: "Running",
  completed: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

const STEP_ICON = {
  queued: <Circle className="h-3.5 w-3.5 text-muted-foreground/40" />,
  running: <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--status-ai-fg)]" />,
  done: <CheckCircle2 className="h-3.5 w-3.5 text-[var(--status-healthy-fg)]" />,
  failed: <XCircle className="h-3.5 w-3.5 text-[var(--status-urgent-fg)]" />,
  cancelled: <MinusCircle className="h-3.5 w-3.5 text-muted-foreground" />,
} as const;

/**
 * The one progress surface for background AI work: what is running, how far
 * along, roughly how long is left, each item's outcome, and cancel / retry.
 */
export function JobProgress({
  job,
  title,
  unit = "item",
  onCancel,
  onRetry,
  retryLabel,
  onDismiss,
  className,
}: {
  job: JobView;
  title: string;
  /** What one step is, for the "3 of 8 scripts" count. Ignored for percent jobs. */
  unit?: string;
  onCancel?: () => void;
  onRetry?: () => void;
  retryLabel?: string;
  onDismiss?: () => void;
  className?: string;
}) {
  const [showSteps, setShowSteps] = useState(false);
  const running = job.status === "queued" || job.status === "running";
  const percentJob = job.kind === "analysis";
  const failures = job.result?.failures ?? job.steps.filter((s) => s.status === "failed");
  const partial = !!job.result?.partial;
  const canRetry = !!onRetry && !running && (failures.length > 0 || partial || job.status === "failed");
  const percent = job.status === "completed" && !partial ? 100 : job.percent;
  const steps = job.steps;
  const visibleSteps = showSteps || steps.length <= 5 ? steps : steps.filter((s) => s.status !== "queued").slice(-4);

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "rounded-lg border bg-card p-4 space-y-3",
        running ? "border-[var(--status-ai)]" : job.status === "failed" ? "border-[var(--status-urgent)]" : "border-border",
        className
      )}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-semibold flex items-center gap-2">
            {running && <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--status-ai-fg)]" />}
            {title}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {running
              ? job.currentStep
                ? `Working on: ${job.currentStep}`
                : "Waiting for the server to pick this up…"
              : partial
                ? "Stopped at the time limit with work left — resume to finish."
                : job.error ?? (job.status === "completed" ? "Finished." : STATUS_LABEL[job.status])}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-semibold num">{percent}%</p>
          <p className="text-[11px] text-muted-foreground num">
            {running && job.etaSeconds != null
              ? `~${formatDuration(job.etaSeconds)} left`
              : job.elapsedSeconds != null
                ? `took ${formatDuration(job.elapsedSeconds)}`
                : STATUS_LABEL[job.status]}
          </p>
        </div>
      </div>

      <Progress value={percent} aria-label={`${title} progress`} />

      {!percentJob && job.total > 0 && (
        <p className="text-xs text-muted-foreground num">
          {job.done} of {job.total} {unit}
          {job.total !== 1 ? "s" : ""} done
          {job.failed > 0 ? ` · ${job.failed} failed` : ""}
          {running && job.elapsedSeconds != null ? ` · ${formatDuration(job.elapsedSeconds)} elapsed` : ""}
        </p>
      )}

      {steps.length > 0 && (
        <ul className="space-y-1">
          {visibleSteps.map((s) => (
            <li key={s.key} className="flex items-start gap-2 text-xs">
              <span className="mt-0.5 shrink-0">{STEP_ICON[s.status]}</span>
              <span className={cn("min-w-0", s.status === "queued" && "text-muted-foreground")}>
                {s.label}
                {s.error && (
                  <span className="block text-[11px] text-muted-foreground break-words">{s.error}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {steps.length > 5 && (
        <button
          type="button"
          onClick={() => setShowSteps((v) => !v)}
          className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
        >
          {showSteps ? "Show less" : `Show all ${steps.length} steps`}
        </button>
      )}

      {(running && onCancel) || canRetry || (!running && onDismiss) ? (
        <div className="flex items-center gap-2 flex-wrap">
          {running && onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted"
            >
              <X className="h-3 w-3" /> Cancel
            </button>
          )}
          {canRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1 rounded-md bg-foreground px-2.5 py-1 text-xs font-medium text-background"
            >
              <RotateCcw className="h-3 w-3" />
              {retryLabel ?? (partial ? "Resume" : `Retry ${failures.length || ""} failed`.replace("  ", " "))}
            </button>
          )}
          {!running && onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Dismiss
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
