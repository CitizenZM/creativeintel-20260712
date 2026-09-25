"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { CheckCircle2, CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { FIELD_TONE } from "@/lib/field-status";
import type { ProjectStage, StageCriterion } from "@/services/project-stages";
import { focusSection, useProjectStages } from "./use-project-stages";
import { StepItem } from "@/components/autopilot/step-item";
import { STEP_ACTIONS } from "@/components/autopilot/step-actions";
import { autoAttempted, markAutoAttempted, runStep } from "@/components/autopilot/step-runner";

function criteriaFor(stages: ProjectStage[], anchor: string): StageCriterion[] {
  return stages.flatMap((s) => s.criteria).filter((c) => c.href?.endsWith(`#${anchor}`));
}

/**
 * A section of a stage page that one or more checks point at (by #anchor).
 * Red frame and background while any of its checks is open, green once they
 * all pass, neutral when no check points here.
 */
export function StepFrame({
  projectId,
  anchor,
  children,
  className,
}: {
  projectId: string;
  anchor: string;
  children: ReactNode;
  className?: string;
}) {
  const { data } = useProjectStages(projectId);
  const items = data ? criteriaFor(data.stages, anchor) : [];
  const open = items.filter((c) => !c.met);
  const tone = items.length === 0 ? null : open.length ? FIELD_TONE.missing : FIELD_TONE.confirmed;

  return (
    <section id={anchor} className={cn("scroll-mt-28 space-y-3 rounded-xl", tone && `border p-3 sm:p-4 ${tone}`, className)}>
      {open.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-[var(--status-urgent-fg)]">
          <CircleAlert className="h-3.5 w-3.5" />
          <span>To do here:</span>
          {open.map((c) => (
            <span key={c.label} className="rounded bg-background/70 px-1.5 py-0.5">{c.label}</span>
          ))}
        </div>
      )}
      {items.length > 0 && open.length === 0 && (
        <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--status-healthy-fg)]">
          <CheckCircle2 className="h-3.5 w-3.5" /> Done
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * Top-of-page checklist for a stage: always shown on that stage's page. Each
 * unfinished check has its AI action and a "Show me". When this is the step
 * to do next, the AI actions run automatically on arrival, one after another,
 * so the user lands on pre-made answers to confirm rather than a blank page.
 */
export function StagePanel({
  projectId,
  stage,
  detail,
}: {
  projectId: string;
  stage: ProjectStage["id"];
  detail?: string;
}) {
  const { data, refresh } = useProjectStages(projectId);
  const s = data?.stages.find((x) => x.id === stage);
  const isNext = data?.next?.id === stage;
  // Checks already queued on this page (by id + label, so a new competitor or a
  // changed requirement queues the step again).
  const queued = useRef(new Set<string>());
  const busy = useRef(false);

  // Land on the section a cross-page "Show me" pointed at.
  useEffect(() => {
    const anchor = typeof window !== "undefined" ? window.location.hash.slice(1) : "";
    if (!anchor) return;
    const t = window.setTimeout(() => focusSection(anchor), 600);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!s || !isNext || busy.current) return;
    const sig = (c: StageCriterion) => `${c.id}|${c.label}`;
    const queue = s.criteria.filter(
      (c) =>
        !c.met &&
        c.id &&
        STEP_ACTIONS[c.id]?.auto &&
        !queued.current.has(sig(c)) &&
        !autoAttempted(projectId, sig(c))
    );
    if (!queue.length) return;
    busy.current = true;
    queue.forEach((c) => queued.current.add(sig(c)));
    void (async () => {
      try {
        for (const c of queue) {
          // An earlier action may already have satisfied this one.
          const fresh = await refresh();
          const now = fresh?.stages.find((x) => x.id === stage)?.criteria.find((x) => x.id === c.id);
          if (now?.met) continue;
          markAutoAttempted(projectId, sig(c));
          const result = await runStep(projectId, c.id!);
          if (result.status === "error") break;
        }
        await refresh();
      } finally {
        busy.current = false;
      }
    })();
  }, [s, isNext, projectId, stage, refresh]);

  if (!s) return null;
  const open = s.criteria.filter((c) => !c.met);
  const met = s.criteria.filter((c) => c.met);
  const done = open.length === 0;

  return (
    <div className={cn("mb-4 rounded-xl border p-3 sm:p-4", done ? FIELD_TONE.confirmed : FIELD_TONE.missing)}>
      <div className="flex items-start gap-2">
        {done ? (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--status-healthy-fg)]" />
        ) : (
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--status-urgent-fg)]" />
        )}
        <div className="min-w-0 flex-1">
          <p className={cn("text-sm font-semibold", done ? "text-[var(--status-healthy-fg)]" : "text-[var(--status-urgent-fg)]")}>
            {done ? `${s.label} is complete — use Next step to continue` : `${s.label}: ${open.length} left to do`}
          </p>
          {!done && detail && <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>}
          {!done && isNext && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              The AI runs each step for you and leaves the results for you to check — or press a button to run one now.
            </p>
          )}
          {open.length > 0 && (
            <div className="mt-2 grid gap-2 lg:grid-cols-2">
              {open.map((c) => (
                <StepItem key={c.id ?? c.label} projectId={projectId} criterion={c} />
              ))}
            </div>
          )}
          {met.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              {met.map((c) => (
                <li key={c.label} className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <CheckCircle2 className="h-3 w-3 text-[var(--status-healthy-fg)]" />
                  {c.label}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
