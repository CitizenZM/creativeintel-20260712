"use client";

import { useEffect } from "react";
import { projectPath } from "@/lib/project-slug";

/**
 * Rewrites the visible address bar to `/projects/<brand-slug>-<id>/...` via
 * `history.replaceState` — no Next navigation, no refetch, no remount. Every
 * page/layout under `[projectId]` still keys off the bare id; the slug is
 * purely cosmetic and stripped back off by `src/middleware.ts` if the page
 * is reloaded or the URL is shared.
 */
export function ProjectUrlSync({ projectId, brandName }: { projectId: string; brandName: string }) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const path = window.location.pathname;
    const rest = path.startsWith(`/projects/${projectId}`) ? path.slice(`/projects/${projectId}`.length) : null;
    if (rest === null) return;

    const desired = projectPath(projectId, brandName, rest);
    if (desired === path) return;

    window.history.replaceState(window.history.state, "", `${desired}${window.location.search}${window.location.hash}`);
  }, [projectId, brandName]);

  return null;
}
