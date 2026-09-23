import { getProjectStages, type ProjectStage } from "@/services/project-stages";
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
 * Shows the same next-step banner the header CTA points at, on the page where
 * the work actually happens — but only when this stage is the one to do next,
 * so a finished stage stays quiet.
 */
export async function StageGuide({
  projectId,
  stage,
  detail,
}: {
  projectId: string;
  stage: ProjectStage["id"];
  detail?: string;
}) {
  const stages = await getProjectStages(projectId).catch(() => null);
  if (!stages?.next || stages.next.id !== stage) return null;

  return (
    <div className="mb-4">
      <NextStepHint step={`Step ${STEP_NUMBER[stage]}`} title={stages.next.action} detail={detail} />
      <StageChecklist criteria={stages.next.criteria} />
    </div>
  );
}
