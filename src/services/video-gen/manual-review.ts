export interface ReviewableJob {
  id: string;
  kind: string;
  status: string;
  settings: unknown;
}

/** Finished outputs that a machine check could not confidently approve. */
export function manualReviewJobs<T extends ReviewableJob>(jobs: T[]): T[] {
  return jobs.filter((job) => {
    if (job.status !== "completed") return false;
    const settings = job.settings && typeof job.settings === "object" && !Array.isArray(job.settings)
      ? job.settings as Record<string, unknown> : {};
    if (job.kind === "image") return !!(settings.consistency || settings.qcIssues) && settings.qcOk !== true;
    if (job.kind === "video") return settings.driftFlag === true || (settings.drift && typeof settings.drift === "object" && (settings.drift as { driftFlag?: unknown }).driftFlag === true);
    return false;
  });
}
