# Schema replay and release gate

The original April migration creates 12 application tables. The schema now
contains 54 models because older releases used `prisma db push`. Migration
`20261014000000_schema_alignment` fills that gap for a **new, empty** database.
CI replays all migrations against PostgreSQL 17 and requires a zero-diff result.

Do not run the alignment migration directly against an existing production
database: many of its columns and tables may already exist. Before releasing:

1. Take a database backup and verify it restores into a separate database.
2. On the existing database, run a read-only `prisma migrate diff
   --from-config-datasource --to-schema prisma/schema.prisma --script` using
   the direct URL. Review every difference. Expected differences are limited
   to the new `FalVideoJob.submissionKey`,
   `FalVideoJob.submissionInputHash`, `AiUsage.requestId`, and
   `AiUsage.latencyMs` fields/index. If the diff is larger, stop and reconcile
   the live schema separately.
3. Once the existing schema is confirmed to include the alignment migration's
   objects, record `20261014000000_schema_alignment` as already applied with
   `prisma migrate resolve --applied 20261014000000_schema_alignment`.
4. Run `prisma migrate deploy` to apply the subsequent additive migrations.
   Repeat the read-only diff and require no remaining differences.

Never mark the alignment migration applied on an empty database. On a fresh
installation, `prisma migrate deploy` must execute every migration in order.
The PR must remain a draft until the existing database check and restore drill
are complete.

For provider billing, export a CSV containing `task_id,actual_cost_usd` and run
`APP_DATABASE_URL=... pnpm tsx scripts/reconcile-video-billing.ts invoice.csv`.
The tool is read-only and emits one JSON line per task with its recorded estimate,
actual charge and difference. Do not treat a missing invoice row as a $0 charge.
