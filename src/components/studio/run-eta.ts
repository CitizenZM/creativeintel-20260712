import type { LibtvRunView } from "./types";

/** Estimate only from completed clips in this run, on the same provider/model. */
export function clipEta(run: LibtvRunView, nowMs = Date.now()): { minMinutes: number; maxMinutes: number; sampleSize: number } | null {
  if (!(["claimed", "running"] as string[]).includes(run.status)) return null;
  const clips = run.jobs.filter((job) => job.kind === "video");
  const pending = clips.filter((job) => job.status === "queued" || job.status === "running");
  if (!pending.length) return null;

  const completed = clips.flatMap((job) => {
    const start = Date.parse(job.startedAt ?? "");
    const end = Date.parse(job.completedAt ?? "");
    if (job.status !== "completed" || job.modelName !== run.videoModel || !Number.isFinite(start) || !Number.isFinite(end)) return [];
    const minutes = (end - start) / 60_000;
    return minutes >= 0.2 && minutes <= 120 ? [minutes] : [];
  }).sort((a, b) => a - b);
  if (completed.length < 2) return null;

  const mid = Math.floor(completed.length / 2);
  const median = completed.length % 2 ? completed[mid] : (completed[mid - 1] + completed[mid]) / 2;
  const remainingMinutes = pending.reduce((sum, job) => {
    if (job.status !== "running" || !job.startedAt) return sum + median;
    const elapsed = (nowMs - Date.parse(job.startedAt)) / 60_000;
    return sum + (Number.isFinite(elapsed) ? Math.max(median * 0.25, median - Math.max(0, elapsed)) : median);
  }, 0);
  // Provider queueing and assembly have no dependable local measurement yet.
  return {
    minMinutes: Math.max(1, Math.floor(remainingMinutes * 0.75)),
    maxMinutes: Math.max(2, Math.ceil(remainingMinutes * 1.5 + 2)),
    sampleSize: completed.length,
  };
}
