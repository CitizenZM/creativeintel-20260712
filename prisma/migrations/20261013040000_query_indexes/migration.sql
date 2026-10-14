CREATE INDEX IF NOT EXISTS "Project_workspaceId_updatedAt_idx" ON "Project" ("workspaceId", "updatedAt");
CREATE INDEX IF NOT EXISTS "Competitor_projectId_excluded_createdAt_idx" ON "Competitor" ("projectId", "excluded", "createdAt");
CREATE INDEX IF NOT EXISTS "AiUsage_projectId_createdAt_idx" ON "AiUsage" ("projectId", "createdAt");
CREATE INDEX IF NOT EXISTS "WorkerTask_status_updatedAt_idx" ON "WorkerTask" ("status", "updatedAt");
