"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert, Loader2, RotateCcw, Sparkles, ArrowDownRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/format-duration";
import type { StageCriterion } from "@/services/project-stages";
import { focusSection, stageForPath } from "@/components/layout/use-project-stages";
import { markStagesStale } from "@/lib/stage-events";
import { MANUAL_HINTS, STEP_ACTIONS, approveAllFrames } from "./step-actions";
import { runStep, useStepRun, AUTOPILOT_DONE } from "./step-runner";

/** Where on its page each check is done. */
export const STEP_ANCHOR: Record<string, string> = {
  "setup.product": "product-definition",
  "setup.confirmProduct": "product-definition",
  "setup.goal": "goal-type",
  "setup.goalType": "goal-type",
  "setup.brandKit": "brand-kit",
  "research.run": "research-progress",
  "research.competitors": "competitors",
  "research.ads": "ads",
  "research.paid": "ads",
  "insights.analyze": "analysis",
  "insights.style": "styles",
  "insights.picks": "picks",
  "creative.scripts": "scripts",
  "creative.select": "scripts",
  "creative.approve": "storyboards",
  "studio.compile": "runs",
  "studio.render": "runs",
};

/**
 * One unfinished check: what's missing, the AI action that does it, and a
 * "Show me" that scrolls to where it's done. Every click shows feedback —
 * a spinner and live progress while the AI works, then the result.
 */
export function StepItem({ projectId, criterion, compact = false }: { projectId: string; criterion: StageCriterion; compact?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const id = criterion.id ?? "";
  const action = STEP_ACTIONS[id];
  const run = useStepRun(projectId, id);
  const [note, setNote] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);

  // Refresh server-rendered sections once the AI has changed the data.
  useEffect(() => {
    const onDone = (e: Event) => {
      const d = (e as CustomEvent<{ projectId: string; id: string }>).detail;
      if (d?.projectId === projectId && d.id === id) router.refresh();
    };
    window.addEventListener(AUTOPILOT_DONE, onDone);
    return () => window.removeEventListener(AUTOPILOT_DONE, onDone);
  }, [projectId, id, router]);

  const anchor = STEP_ANCHOR[id];
  const path = criterion.href?.split("#")[0];
  const explain = action?.explain ?? MANUAL_HINTS[id] ?? "";
  const manualHint = MANUAL_HINTS[id];

  function showMe() {
    setNote(manualHint ?? explain);
    const samePage = path ? stageForPath(pathname, projectId) === stageForPath(path, projectId) : true;
    if (samePage && anchor && focusSection(anchor)) return;
    if (path) router.push(anchor ? `${path}#${anchor}` : path);
  }

  async function approveAll() {
    setApproving(true);
    setNote(null);
    try {
      const n = await approveAllFrames(projectId);
      setNote(n ? `Approved ${n} frame(s).` : "Every frame was already approved.");
      markStagesStale();
      router.refresh();
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not approve the frames");
    } finally {
      setApproving(false);
    }
  }

  const running = run.status === "running";
  const pct = run.progress?.percent;

  return (
    <div
      className={cn(
        "rounded-md border bg-background/80 px-2.5 py-2 text-xs",
        run.status === "done"
          ? "border-[color-mix(in_oklab,var(--status-healthy)_50%,transparent)]"
          : "border-[color-mix(in_oklab,var(--status-urgent)_45%,transparent)]"
      )}
    >
      <div className="flex items-start gap-2">
        {run.status === "done" ? (
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--status-healthy-fg)]" />
        ) : (
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--status-urgent-fg)]" />
        )}
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="font-medium text-foreground">{criterion.label}</p>
          {!compact && explain && run.status === "idle" && <p className="text-muted-foreground">{explain}</p>}

          {running && (
            <div className="space-y-1" aria-live="polite">
              <p className="flex items-center gap-1.5 text-[var(--status-ai-fg)]">
                <Loader2 className="h-3 w-3 animate-spin" />
                {run.progress?.message ?? "Working…"}
              </p>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full bg-[var(--status-ai-fg)] transition-[width]", pct == null && "w-1/3 animate-pulse")}
                  style={pct != null ? { width: `${Math.max(4, Math.min(100, pct))}%` } : undefined}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                {pct != null ? `${Math.round(pct)}%` : "Working"}
                {run.progress?.etaSeconds != null ? ` · about ${formatDuration(run.progress.etaSeconds)} left` : ""}
              </p>
            </div>
          )}
          {run.status === "done" && run.message && <p className="text-[var(--status-healthy-fg)]">{run.message}</p>}
          {run.status === "error" && run.message && <p className="text-[var(--status-urgent-fg)]">{run.message}</p>}
          {note && <p className="rounded bg-muted px-2 py-1 text-foreground">{note}</p>}

          <div className="flex flex-wrap items-center gap-1.5">
            {action && (
              <button
                type="button"
                disabled={running}
                onClick={() => {
                  setNote(null);
                  void runStep(projectId, id);
                }}
                className="inline-flex items-center gap-1 rounded-md bg-foreground px-2 py-1 font-medium text-background transition-transform hover:opacity-90 active:scale-95 disabled:opacity-60"
              >
                {running ? <Loader2 className="h-3 w-3 animate-spin" /> : run.status === "error" ? <RotateCcw className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
                {running ? "Working…" : run.status === "error" ? "Try again" : run.status === "done" ? "Run again" : action.label}
              </button>
            )}
            {id === "creative.approve" && (
              <button
                type="button"
                disabled={approving}
                onClick={approveAll}
                className="inline-flex items-center gap-1 rounded-md border border-[var(--status-healthy)] px-2 py-1 font-medium text-[var(--status-healthy-fg)] transition-transform hover:bg-[var(--status-healthy-bg)] active:scale-95 disabled:opacity-60"
              >
                {approving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                Approve all frames
              </button>
            )}
            {(anchor || path) && (
              <button
                type="button"
                onClick={showMe}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 font-medium text-foreground transition-transform hover:bg-muted active:scale-95"
              >
                Show me <ArrowDownRight className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
