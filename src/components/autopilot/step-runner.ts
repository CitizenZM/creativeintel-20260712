"use client";

import { useSyncExternalStore } from "react";
import { markStagesStale } from "@/lib/stage-events";
import { STEP_ACTIONS, type ActionProgress } from "./step-actions";

export interface RunState {
  status: "idle" | "running" | "done" | "error";
  progress?: ActionProgress;
  message?: string;
}

const IDLE: RunState = { status: "idle" };
const runs = new Map<string, RunState>();
const listeners = new Set<() => void>();
const key = (projectId: string, id: string) => `${projectId}:${id}`;

function set(projectId: string, id: string, state: RunState) {
  runs.set(key(projectId, id), state);
  listeners.forEach((l) => l());
}

export const AUTOPILOT_DONE = "autopilot:done";

/**
 * Run one step's AI action. Shared across the page: the checklist panel and
 * the Next Step alert show the same progress, and a second click while it
 * runs is ignored.
 */
export async function runStep(projectId: string, id: string): Promise<RunState> {
  const action = STEP_ACTIONS[id];
  const current = runs.get(key(projectId, id));
  if (!action) return IDLE;
  if (current?.status === "running") return current;
  set(projectId, id, { status: "running", progress: { percent: null, etaSeconds: null, message: "Starting…" } });
  try {
    const message = await action.run(projectId, (progress) => set(projectId, id, { status: "running", progress }));
    const done: RunState = { status: "done", message };
    set(projectId, id, done);
    return done;
  } catch (err) {
    const failed: RunState = { status: "error", message: err instanceof Error ? err.message : "Something went wrong" };
    set(projectId, id, failed);
    return failed;
  } finally {
    markStagesStale();
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(AUTOPILOT_DONE, { detail: { projectId, id } }));
  }
}

export function useStepRun(projectId: string, id: string): RunState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => runs.get(key(projectId, id)) ?? IDLE,
    () => IDLE
  );
}

// ─── auto-run bookkeeping ───────────────────────────────────────────────────
// Auto-runs once per step per browser (retry allowed after 30 minutes); the
// user can always run it again with the button.

const AUTO_TTL_MS = 30 * 60 * 1000;

export function autoAttempted(projectId: string, id: string): boolean {
  try {
    const at = Number(localStorage.getItem(`autopilot:${key(projectId, id)}`) || 0);
    return Date.now() - at < AUTO_TTL_MS;
  } catch {
    return false;
  }
}

export function markAutoAttempted(projectId: string, id: string) {
  try {
    localStorage.setItem(`autopilot:${key(projectId, id)}`, String(Date.now()));
  } catch {
    // storage unavailable — auto-run just won't be remembered
  }
}
