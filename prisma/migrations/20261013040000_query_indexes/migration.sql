-- Older installations used db push after the 2026-04 baseline. Apply each index
-- only after its columns exist; Prisma db push creates any missing indexes when
-- bootstrapping a fresh isolated database from the current schema.
DO $$
BEGIN
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = current_schema()
      AND table_name = 'Project' AND column_name IN ('workspaceId', 'updatedAt')) = 2 THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS "Project_workspaceId_updatedAt_idx" ON "Project" ("workspaceId", "updatedAt")';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = current_schema()
      AND table_name = 'Competitor' AND column_name IN ('projectId', 'excluded', 'createdAt')) = 3 THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS "Competitor_projectId_excluded_createdAt_idx" ON "Competitor" ("projectId", "excluded", "createdAt")';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = current_schema()
      AND table_name = 'AiUsage' AND column_name IN ('projectId', 'createdAt')) = 2 THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS "AiUsage_projectId_createdAt_idx" ON "AiUsage" ("projectId", "createdAt")';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = current_schema()
      AND table_name = 'WorkerTask' AND column_name IN ('status', 'updatedAt')) = 2 THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS "WorkerTask_status_updatedAt_idx" ON "WorkerTask" ("status", "updatedAt")';
  END IF;
END $$;
