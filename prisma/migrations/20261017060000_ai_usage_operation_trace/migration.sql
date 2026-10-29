ALTER TABLE "AiUsage"
  ADD COLUMN "traceId" TEXT,
  ADD COLUMN "stage" TEXT,
  ADD COLUMN "runId" TEXT;

CREATE INDEX "AiUsage_traceId_createdAt_idx" ON "AiUsage"("traceId", "createdAt");
CREATE INDEX "AiUsage_runId_createdAt_idx" ON "AiUsage"("runId", "createdAt");
