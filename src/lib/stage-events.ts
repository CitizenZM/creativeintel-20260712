/**
 * Keeps the sidebar stage rail in step with the page. Anything that can
 * change a stage's criteria (a pick saved, a job finished) marks stages
 * stale; a component that already fetched fresh stages shares them.
 */
import type { ProjectStages } from "@/services/project-stages";

export const STAGES_STALE = "stages:stale";
export const STAGES_FRESH = "stages:fresh";

export function markStagesStale() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(STAGES_STALE));
}

export function shareFreshStages(stages: ProjectStages) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(STAGES_FRESH, { detail: stages }));
}
