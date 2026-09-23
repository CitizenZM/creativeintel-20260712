"use client";

import { useEffect, useState } from "react";
import type { ProjectStage, ProjectStages } from "@/services/project-stages";
import { NextStepHint } from "./next-step-hint";
import { StageChecklist } from "./stage-checklist";

const STEP_NUMBER: Record<ProjectStage["id"], number> = {
  setup: 1,
  research: 2,
  insights: 3,
  creative: 4,
  studio: 5,
  deliver: 6,
};

/**
 * StageGuide for client-rendered pages (Creative, Studio). Re-reads the stages
 * whenever `refreshKey` changes so the checklist ticks as the user works.
 */
export function StageGuideClient({
  projectId,
  stage,
  detail,
  refreshKey,
}: {
  projectId: string;
  stage: ProjectStage["id"];
  detail?: string;
  refreshKey?: unknown;
}) {
  const [stages, setStages] = useState<ProjectStages | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectId}/stages`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled) setStages(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshKey]);

  if (!stages?.next || stages.next.id !== stage) return null;
  return (
    <div>
      <NextStepHint step={`Step ${STEP_NUMBER[stage]}`} title={stages.next.action} detail={detail} />
      <StageChecklist criteria={stages.next.criteria} />
    </div>
  );
}
