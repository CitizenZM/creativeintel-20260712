"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import type { ProjectStage, ProjectStages } from "@/services/project-stages";
import { STAGES_FRESH, STAGES_STALE, shareFreshStages } from "@/lib/stage-events";

/** Which stage a project page belongs to, by its first path segment. */
export const STAGE_SEGMENTS: Record<ProjectStage["id"], string[]> = {
  setup: ["overview"],
  research: ["content", "research"],
  insights: ["insights", "competitors"],
  creative: ["creative"],
  studio: ["studio"],
  deliver: ["deliver"],
};

export function stageForPath(pathname: string, projectId: string): ProjectStage["id"] | null {
  // Pages are served under both the id and a "brand-id" slug.
  const m = pathname.match(/^\/projects\/[^/]+\/([^/?#]+)/);
  if (!m || !projectId) return null;
  const seg = m[1];
  for (const [id, segs] of Object.entries(STAGE_SEGMENTS)) {
    if (segs.includes(seg)) return id as ProjectStage["id"];
  }
  return null;
}

/**
 * Live pipeline stages for a project. Refetches when anything marks the stages
 * stale (a save, a finished job), on navigation, on window focus and every
 * 15s as a fallback — the header, tabs and step frames all read this, so they
 * never disagree or go stale after an edit.
 */
export function useProjectStages(projectId: string, initial?: ProjectStages | null) {
  const pathname = usePathname();
  const [data, setData] = useState<ProjectStages | null>(initial ?? null);

  const load = useCallback(
    (): Promise<ProjectStages | null> =>
      fetch(`/api/projects/${projectId}/stages`, { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<ProjectStages>) : null))
        .then((d) => {
          if (d) setData(d);
          return d;
        })
        .catch(() => null),
    [projectId]
  );

  useEffect(() => {
    let cancelled = false;
    void load();
    const t = setInterval(() => void load(), 15000);
    const onStale = () => void load();
    const onFresh = (e: Event) => {
      const d = (e as CustomEvent<ProjectStages>).detail;
      if (!cancelled && d?.projectId === projectId) setData(d);
    };
    window.addEventListener(STAGES_STALE, onStale);
    window.addEventListener(STAGES_FRESH, onFresh);
    window.addEventListener("focus", onStale);
    return () => {
      cancelled = true;
      clearInterval(t);
      window.removeEventListener(STAGES_STALE, onStale);
      window.removeEventListener(STAGES_FRESH, onFresh);
      window.removeEventListener("focus", onStale);
    };
  }, [projectId, pathname, load]);

  /** Fetch now and tell every other listener (used right before deciding). */
  const refresh = useCallback(async () => {
    const d = await load();
    if (d) shareFreshStages(d);
    return d;
  }, [load]);

  return { data, refresh };
}

/** Scroll to a section and flash it, so the user sees exactly where to act. */
export function focusSection(anchor: string) {
  const el = document.getElementById(anchor);
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  el.classList.remove("step-flash");
  // Restart the animation even if it is already running.
  void el.offsetWidth;
  el.classList.add("step-flash");
  window.setTimeout(() => el.classList.remove("step-flash"), 2400);
  return true;
}
