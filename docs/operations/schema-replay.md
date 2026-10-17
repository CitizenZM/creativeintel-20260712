# Schema replay and release gate

The original April migration creates 12 application tables. The schema now
contains 54 models because older releases used `prisma db push`. Migration
`20261014000000_schema_alignment` fills that gap for a **new, empty** database.
CI replays all migrations against PostgreSQL 17 and requires a zero-diff result.

Do not run the init or alignment migration directly against the existing
production database: their objects already exist. The live `creativeintel`
schema has no `_prisma_migrations` table. It is also missing `SharedLease`
and `ResearchContinuation` (read-only dashboard inspection, 2026-10-15).
Before releasing:

1. Take a database backup and verify it restores into a separate database.
2. Set `APP_DATABASE_DIRECT_URL` to a **direct/session** connection to the
   `creativeintel` schema. Run the read-only `pnpm prisma migrate diff
   --from-config-datasource --to-schema prisma/schema.prisma --script`.
   Review the whole script and catalog against both the initial and alignment
   migrations. Expected additive work includes the two tables above, four
   query indexes, `FalVideoJob.submissionKey` and its unique index,
   `FalVideoJob.submissionInputHash`, and `AiUsage.requestId/latencyMs`.
   Do not assume this list exhausts live drift: stop if any other difference
   or missing baseline object appears.
3. Rehearse against a restored copy of the live database. Only after confirming
   that the existing schema already contains every object from the init and
   alignment migrations, baseline **both** historical migrations:
   `pnpm prisma migrate resolve --applied 20260412175941_init` and
   `pnpm prisma migrate resolve --applied 20261014000000_schema_alignment`.
   Recording only alignment would cause `migrate deploy` to replay the
   initial CREATE TABLE statements and fail. Baseline changes migration
   history, not application tables.
4. Run `pnpm prisma migrate deploy` on the restored copy. It should apply
   `shared_leases`, `research_continuation`, `query_indexes`,
   `video_submission_key`, `ai_usage_trace`, and
   `video_submission_input_hash`. Require `pnpm prisma migrate diff
   --from-config-datasource --to-schema prisma/schema.prisma --exit-code`
   to report no difference, and test application reads and writes.
5. Repeat steps 3–4 on production in the approved maintenance window, using
   the verified backup and the same direct connection. Check migration history
   and zero schema diff before deploying code that depends on the new tables.

Never mark the alignment migration applied on an empty database. On a fresh
installation, `prisma migrate deploy` must execute every migration in order.
An isolated local simulation of a db-pushed schema with these tables,
indexes and columns removed passed this exact two-baseline/deploy sequence and
ended with zero Prisma schema diff on 2026-10-16. It does not replace the
restored-production rehearsal. Keep the PR draft until the live diff and
restore drill are complete.

For provider billing, export a CSV containing `task_id,actual_cost_usd` and run
`APP_DATABASE_URL=... pnpm tsx scripts/reconcile-video-billing.ts invoice.csv`.
The tool is read-only and emits one JSON line per task with its recorded estimate,
actual charge and difference. Do not treat a missing invoice row as a $0 charge.
