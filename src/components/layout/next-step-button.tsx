"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowRight, CircleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProjectStage, ProjectStages } from "@/services/project-stages";
import { focusSection, stageForPath, useProjectStages } from "./use-project-stages";

type Gap = { label: string; href?: string };

/**
 * The header's Next Step control.
 * - On a stage page whose checks are not all met: stays put and shows what is
 *   still missing, each with a link that scrolls to the input that fixes it.
 * - When the current stage is done: moves on to the next stage.
 * - Anywhere else: goes to the first unfinished stage.
 * Every click gives visible feedback (press animation, and a shake when blocked).
 */
export function NextStepButton({ projectId, initial }: { projectId: string; initial: ProjectStages | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data, refresh } = useProjectStages(projectId, initial);
  const [pressed, setPressed] = useState<"go" | "blocked" | null>(null);
  const [opened, setOpened] = useState<{ stage: ProjectStage; items: Gap[]; path: string } | null>(null);
  const timer = useRef<number | null>(null);

  const stages = data?.stages ?? [];
  const currentId = stageForPath(pathname, projectId);
  const current = stages.find((s) => s.id === currentId) ?? null;
  const currentIdx = current ? stages.indexOf(current) : -1;
  const following = currentIdx >= 0 ? stages[currentIdx + 1] ?? null : null;
  const target = current ? (current.state === "done" ? following : current) : data?.next ?? null;

  // The alert belongs to the page it was opened on and closes itself once the
  // stage is finished.
  const gaps =
    opened && opened.path === pathname && !(current && current.id === opened.stage.id && current.state === "done")
      ? opened
      : null;
  const setGaps = (g: { stage: ProjectStage; items: Gap[] } | null) => setOpened(g ? { ...g, path: pathname } : null);
  useEffect(() => () => void (timer.current && window.clearTimeout(timer.current)), []);

  function animate(kind: "go" | "blocked") {
    setPressed(kind);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPressed(null), 650);
  }

  async function onClick() {
    const fresh = (await refresh()) ?? data;
    const list = fresh?.stages ?? [];
    const here = list.find((s) => s.id === currentId) ?? null;

    if (here && here.state !== "done") {
      animate("blocked");
      setGaps({ stage: here, items: here.criteria.filter((c) => !c.met) });
      return;
    }
    animate("go");
    setGaps(null);
    const idx = here ? list.indexOf(here) : -1;
    const dest = here ? list[idx + 1] ?? null : fresh?.next ?? null;
    if (dest) router.push(dest.href);
  }

  function goToGap(g: Gap) {
    if (!g.href) return;
    const [path, anchor] = g.href.split("#");
    const onPage = stageForPath(pathname, projectId) === stageForPath(path, projectId);
    if (onPage && anchor && focusSection(anchor)) return;
    router.push(g.href);
  }

  if (!data && !initial) return null;
  const allDone = stages.length > 0 && stages.every((s) => s.state === "done");
  if (allDone && (!current || !following)) return null;

  const blockedHere = !!current && current.state !== "done";
  const title = blockedHere
    ? `Finish ${current!.label}`
    : target
      ? `Go to ${target.label}`
      : "Next step";
  const subtitle = blockedHere
    ? `${current!.criteria.filter((c) => !c.met).length} item(s) left — ${current!.action}`
    : target?.action ?? "";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onClick}
        aria-expanded={!!gaps}
        className={cn(
          "next-step-btn inline-flex flex-col items-start rounded-md px-3.5 py-2 text-left transition-transform active:scale-95",
          blockedHere
            ? "bg-[var(--status-urgent)] text-white hover:opacity-90"
            : "bg-foreground text-background hover:opacity-90 cta-attention",
          pressed === "go" && "next-step-go",
          pressed === "blocked" && "next-step-shake"
        )}
      >
        <span className="text-[10px] font-medium uppercase tracking-wider opacity-80">Next step · {title}</span>
        <span className="flex items-center gap-1 text-xs font-semibold max-w-[18rem] truncate">
          {subtitle} <ArrowRight className="h-3 w-3 shrink-0" />
        </span>
      </button>

      {gaps && gaps.items.length > 0 && (
        <div
          role="alert"
          className="absolute right-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-[var(--status-urgent)] bg-background p-3 shadow-lg"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-[var(--status-urgent-fg)]">
              <CircleAlert className="h-4 w-4" />
              {`${gaps.stage.label} isn't finished yet`}
            </p>
            <button type="button" onClick={() => setGaps(null)} aria-label="Close" className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Complete these to continue:</p>
          <ul className="mt-2 space-y-1.5">
            {gaps.items.map((g) => (
              <li key={g.label}>
                <button
                  type="button"
                  onClick={() => goToGap(g)}
                  className="flex w-full items-center justify-between gap-2 rounded-md border border-[color-mix(in_oklab,var(--status-urgent)_45%,transparent)] bg-[color-mix(in_oklab,var(--status-urgent-bg)_60%,transparent)] px-2.5 py-1.5 text-left text-xs text-foreground hover:bg-[var(--status-urgent-bg)]"
                >
                  <span>{g.label}</span>
                  {g.href && <span className="shrink-0 font-medium text-[var(--status-urgent-fg)]">Fix →</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
