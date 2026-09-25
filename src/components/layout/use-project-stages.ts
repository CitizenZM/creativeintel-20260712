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

// ─── One shared fetch per project ────────────────────────────────────────────
// Every component on the page (tabs, Next Step, step frames, the panel) reads
// the same store, so a page makes one /stages request per trigger instead of
// one per component.

type Store = {
  data: ProjectStages | null;
  inflight: Promise<ProjectStages | null> | null;
  listeners: Set<(d: ProjectStages) => void>;
  timer: ReturnType<typeof setInterval> | null;
  lastFetch: number;
};
const stores = new Map<string, Store>();
const POLL_MS = 20000;
const MIN_GAP_MS = 1500;

function storeFor(projectId: string): Store {
  let s = stores.get(projectId);
  if (!s) {
    s = { data: null, inflight: null, listeners: new Set(), timer: null, lastFetch: 0 };
    stores.set(projectId, s);
  }
  return s;
}

function publish(projectId: string, d: ProjectStages) {
  const s = storeFor(projectId);
  s.data = d;
  s.listeners.forEach((l) => l(d));
}

/** Fetch once for everyone; `force` skips the short de-duplication window. */
function fetchStages(projectId: string, force = false): Promise<ProjectStages | null> {
  const s = storeFor(projectId);
  if (s.inflight) return s.inflight;
  if (!force && s.data && Date.now() - s.lastFetch < MIN_GAP_MS) return Promise.resolve(s.data);
  s.lastFetch = Date.now();
  s.inflight = fetch(`/api/projects/${projectId}/stages`, { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<ProjectStages>) : null))
    .then((d) => {
      if (d) publish(projectId, d);
      return d;
    })
    .catch(() => null)
    .finally(() => {
      s.inflight = null;
    });
  return s.inflight;
}

let globalListeners = false;
function ensureGlobalListeners() {
  if (globalListeners || typeof window === "undefined") return;
  globalListeners = true;
  const refetchAll = (force: boolean) => {
    for (const [id, s] of stores) if (s.listeners.size) void fetchStages(id, force);
  };
  window.addEventListener(STAGES_STALE, () => refetchAll(true));
  window.addEventListener("focus", () => refetchAll(false));
  window.addEventListener(STAGES_FRESH, (e: Event) => {
    const d = (e as CustomEvent<ProjectStages>).detail;
    if (d?.projectId) publish(d.projectId, d);
  });
}

/**
 * Live pipeline stages for a project. Refetches when anything marks the stages
 * stale (a save, a finished job), on navigation, on window focus and every 20s
 * as a fallback — the header, tabs and step frames all read one shared store,
 * so they never disagree or go stale after an edit.
 */
export function useProjectStages(projectId: string, initial?: ProjectStages | null) {
  const pathname = usePathname();
  const [data, setData] = useState<ProjectStages | null>(() => storeFor(projectId).data ?? initial ?? null);

  useEffect(() => {
    ensureGlobalListeners();
    const s = storeFor(projectId);
    const listener = (d: ProjectStages) => setData(d);
    s.listeners.add(listener);
    if (!s.timer) s.timer = setInterval(() => void fetchStages(projectId), POLL_MS);
    void fetchStages(projectId);
    return () => {
      s.listeners.delete(listener);
      if (s.listeners.size === 0 && s.timer) {
        clearInterval(s.timer);
        s.timer = null;
      }
    };
  }, [projectId, pathname]);

  /** Fetch now (bypassing de-duplication) and share it with every listener. */
  const refresh = useCallback(async () => {
    const d = await fetchStages(projectId, true);
    if (d) shareFreshStages(d);
    return d;
  }, [projectId]);

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
