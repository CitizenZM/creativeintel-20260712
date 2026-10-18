CREATE TABLE "ResearchContinuation" (
 "jobId" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT NOT NULL,
 "checkpoint" JSONB, "waitingTaskIds" JSONB,
 "status" TEXT NOT NULL DEFAULT 'queued',
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "ResearchContinuation_status_updatedAt_idx" ON "ResearchContinuation"("status", "updatedAt");
