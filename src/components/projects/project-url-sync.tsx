"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { projectPath } from "@/lib/project-slug";

/**
 * Rewrites the visible address bar to `/projects/<brand-slug>-<id>/...` via
 * `history.replaceState` — no Next navigation, no refetch, no remount. Every
 * page/layout under `[projectId]` still keys off the bare id; the slug is
 * purely cosmetic and stripped back off by `src/middleware.ts` if the page
 * is reloaded or the URL is shared.
 */
export function ProjectUrlSync({ projectId, brandName }: { projectId: string; brandName: string }) {
  // Client-side navigation inside a project keeps this layout mounted, so
  // without the pathname in the deps the effect never re-runs and every
  // in-project link (competitor detail, asset detail) drops back to the bare
  // cuid it was rendered with.
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const path = window.location.pathname;
    const rest = path.startsWith(`/projects/${projectId}`) ? path.slice(`/projects/${projectId}`.length) : null;
    if (rest === null) return;

    const desired = projectPath(projectId, brandName, rest);
    if (desired === path) return;

    window.history.replaceState(window.history.state, "", `${desired}${window.location.search}${window.location.hash}`);
  }, [projectId, brandName, pathname]);

  return null;
}
