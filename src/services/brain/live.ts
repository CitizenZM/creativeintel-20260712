/**
 * Live overlay for the /brain board: the daemon publishes a snapshot every 5 minutes, but Ad Studio runs move faster.
 * On every GET /api/brain the server re-reads the active runs and replaces the snapshot's server-side queue/executing
 * rows (local Ad Studio jobs stay as the daemon saw them), so the board reflects a run's state within one 10 s poll.
 */
import type { BrainSnapshot, BrainTask } from "./contract";

export interface LiveRun {
  id: string;
  projectId: string;
  status: string;
  step: string | null;
  progress: number;
  estUsd: number;
  actualUsd: number | null;
  hookType: string;
  engine: string;
  updatedAt: Date | string;
}

export const LIVE_STATUSES = ["queued", "planning", "awaiting_approval", "approved", "generating"] as const;

function task(r: LiveRun, kind: BrainTask["kind"], status: BrainTask["status"], agent: string, prev?: BrainTask): BrainTask {
  return {
    id: r.id, projectId: r.projectId, kind, title: `${r.hookType} · ${r.engine}`, status, step: r.step, progress: r.progress,
    estUsd: r.estUsd, actualUsd: r.actualUsd, gates: prev?.gates ?? [], agent, updatedAt: new Date(r.updatedAt).toISOString(),
  };
}

export function overlayRuns(snap: BrainSnapshot, runs: LiveRun[], now = Date.now()): BrainSnapshot & { liveAt: string } {
  const isLocal = (t: BrainTask) => t.id.startsWith("local:");
  const prev = new Map([...snap.queue, ...snap.executing].map((t) => [t.id, t]));
  const queue = snap.queue.filter(isLocal);
  const executing = snap.executing.filter(isLocal);
  for (const r of runs) {
    if (r.status === "queued") queue.push(task(r, "plan", "queued", "Producer", prev.get(r.id)));
    else if (r.status === "awaiting_approval") queue.push(task(r, "generate", "gated", "Producer", prev.get(r.id)));
    else if (r.status === "planning") executing.push(task(r, "plan", "running", "Director", prev.get(r.id)));
    else if (r.status === "approved" || r.status === "generating") executing.push(task(r, "generate", "running", "Editor", prev.get(r.id)));
  }
  return { ...snap, queue, executing, liveAt: new Date(now).toISOString() };
}
