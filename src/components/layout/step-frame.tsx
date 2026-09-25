"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { CheckCircle2, CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { FIELD_TONE } from "@/lib/field-status";
import type { ProjectStage, StageCriterion } from "@/services/project-stages";
import { focusSection, useProjectStages } from "./use-project-stages";

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
 * Top-of-page checklist for a stage: always shown on that stage's page so the
 * user sees at a glance what is left (red) or that it's finished (green).
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
  const { data } = useProjectStages(projectId);
  const s = data?.stages.find((x) => x.id === stage);
  if (!s) return null;
  const open = s.criteria.filter((c) => !c.met);
  const done = open.length === 0;

  function go(c: StageCriterion, e: React.MouseEvent) {
    const anchor = c.href?.split("#")[1];
    if (anchor && focusSection(anchor)) e.preventDefault();
  }

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
          <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {s.criteria.map((c) => (
              <li key={c.label}>
                {c.href && !c.met ? (
                  <Link
                    href={c.href}
                    onClick={(e) => go(c, e)}
                    className="flex items-center gap-2 rounded-md border border-[color-mix(in_oklab,var(--status-urgent)_45%,transparent)] bg-background/70 px-2 py-1 text-xs hover:bg-background"
                  >
                    <CircleAlert className="h-3.5 w-3.5 shrink-0 text-[var(--status-urgent-fg)]" />
                    <span className="flex-1">{c.label}</span>
                    <span className="font-medium text-[var(--status-urgent-fg)]">Fix →</span>
                  </Link>
                ) : (
                  <span
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2 py-1 text-xs",
                      c.met ? "text-muted-foreground" : "text-foreground"
                    )}
                  >
                    {c.met ? (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[var(--status-healthy-fg)]" />
                    ) : (
                      <CircleAlert className="h-3.5 w-3.5 shrink-0 text-[var(--status-urgent-fg)]" />
                    )}
                    {c.label}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
