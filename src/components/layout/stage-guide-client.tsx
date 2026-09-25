"use client";

import { useEffect, useRef } from "react";
import type { ProjectStage } from "@/services/project-stages";
import { markStagesStale } from "@/lib/stage-events";
import { StagePanel } from "./step-frame";

/**
 * StageGuide for client-rendered pages (Creative, Studio): a change in
 * `refreshKey` (new scripts, approvals…) re-reads the stages everywhere.
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
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    markStagesStale();
  }, [refreshKey]);
  return <StagePanel projectId={projectId} stage={stage} detail={detail} />;
}
