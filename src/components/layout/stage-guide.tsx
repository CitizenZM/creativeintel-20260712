import type { ProjectStage } from "@/services/project-stages";
import { StagePanel } from "./step-frame";

/**
 * The stage checklist at the top of a stage page — always shown, red while
 * anything is left to do and green once the stage is complete. Live: it
 * refreshes as soon as a save on the page changes a check.
 */
export function StageGuide({
  projectId,
  stage,
  detail,
}: {
  projectId: string;
  stage: ProjectStage["id"];
  detail?: string;
}) {
  return <StagePanel projectId={projectId} stage={stage} detail={detail} />;
}
