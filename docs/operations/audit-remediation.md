# Audit remediation: implementation and release checklist

Branch: `codex/audit-remediation`. This is a code completion record, not a production deployment claim.

| # | Implemented change | Release / operational requirement |
|---|---|---|
| 1 | One schema-qualified SQL stage summary for all selected projects; homepage batch; SSR stage provider; visible-only 60-second polling. | Deploy; compare production queries and latency. Local PostgreSQL summary queries passed. |
| 2 | fal/Veo submit and poll 30-second timeouts; OpenAI image and Whisper 90-second deadlines with SDK retries disabled. | Deploy; real provider timeout testing remains external. |
| 3 | Explicit Gemini 3.8 Flash, Sonnet 5, Opus 5.5, fal Flux Schnell prices; Gemini date boundary; fal dimensions billing. | Deploy. Prices are estimates; provider invoices remain authoritative. |
| 4 | Zhipu retries share a 120-second deadline; LLM routing, vision prep and JSON repair share 150 seconds. | Deploy. |
| 5 | Persistent research phases/checkpoints, offline Worker deferral, callback wakeup, three retry cap; process pool with distinct machine/instance browser spaces; queue depth UI. | Apply ResearchContinuation + SharedLease migrations; deploy queue; start configured worker pool on each participating machine. |
| 6 | Vercel Queues render/research consumers, expiring execution leases, delayed dispatch and cron recovery; status poll handlers only read. Cron recovers up to 100 run and 100 video records. | Deploy `queue/v2beta` triggers; verify authenticated callback delivery in the production account. |
| 7 | Verified private Blob archive storage, public hosted previews, checksum readback, resumable byte/data-URL migration, bounded-lock VACUUM FULL script. | Private archive store/token and real application DB access required. Until the private token exists, archive keeps its existing DB backup to avoid losing the only copy. Actual migration/VACUUM have NOT run. |
| 8 | Member usage grouped query; `/all` pagination; bounded overview queries with SQL chart aggregates; four indexes. | Apply query-index migration and deploy. |
| 9 | Shared PostgreSQL GLM/crawl leases and existing shared CrawlCache; expired cache/lease cleanup bounded to 500. Authorization reads shared DB directly, eliminating stale per-instance grants. | Apply SharedLease migration first. Local PG concurrent claims and immediate block/share revocation passed. |
| 10 | Script-source report-only header, bounded privacy-preserving violation endpoint, nonce enforcement switch with explicit full-week gate. | Set `CSP_REPORT_STARTED_AT` at actual deployment. Inspect reports for seven days. Only then set `CSP_MODE=enforce`; do not auto-enforce on a calendar assumption. Static legal pages stay report-only to preserve static caching. |
| 11 | Hosted no-auth fallback denied; previews require separate `PREVIEW_DATABASE_URL` and Clerk test keys. Unconfigured previews lock machine routes too. | The current branch preview uses an isolated database and Clerk test keys. Keep this separation and never copy production database credentials. |
| 12 | Auth-free root layout, Clerk/application shell in `(app)` group; proxy bypass for public legal documents. | Build must mark `/terms` and `/privacy` static; verify CDN cache after deployment. |
| 13 | Canonical redirect 308; local filesystem route disabled on Vercel; realpath blocks symlink escapes; API NFT excludes repository docs/source/tooling; local-files no longer traces workspace files. | Local serving requires an absolute LOCAL_FILES_ROOT. Vercel's static analyzer still reports dynamic filesystem reads in rendering modules, but route NFT manifests confirm those files are not included in the affected bundles. |
| 14 | Hook correction, unused code removal, explicit side-effect statements, Next Image with unoptimized external media, generated-code ESLint ignore. | Final repository lint verification recorded below. |
| 15 | 15-second test default, 30-second hooks, bounded worker count; manual `zz-ops` tests explicitly opt-in with RUN_OPERATOR_TESTS=1. | Run unit suite; run manual media experiments only with their documented fixtures. |
| 16 | Production/development env files ignored; obsolete npm lock removed; pnpm lock retained. | Clean `pnpm install --frozen-lockfile` verified. |
| 17 | Source environment inventory/checker; explicit runtime defaults; paired random browser-worker credential provisioning. | Production configuration added; a new deployment is needed for activation. Paired token file is gitignored at `.vercel/browser-worker.env.local`; values are never logged. Legal mailbox existence remains unverified. |
| 18 | Safe API exception messages and persisted/nested-error redaction, typed validation and budget messages retained. | Deploy; source regression test prevents response exception leakage. |
| 19 | Prisma/Anthropic/Vitest upgrades; compatible security overrides; vendored MIT shadcn CSS removes unused CLI dependency; local braces depth patch. | Audit still flags upstream braces 3.0.3 despite the tested local mitigation; no upstream 3.0.4 exists in registry. One moderate sprintf-js advisory also has no published patched version. Do not call audit zero. |

## Release sequence

1. Follow [schema-replay.md](schema-replay.md): restore a production backup into a separate database, confirm the full existing baseline, mark **both** init and schema-alignment migrations applied, then deploy the six additive migrations. An isolated db-push simulation passed this sequence on 2026-10-16 with zero final Prisma schema diff. The live restore rehearsal and production change remain outstanding.
2. Configure a **private** Vercel Blob store and set `ARCHIVE_BLOB_READ_WRITE_TOKEN` for the app. Keep the existing public `BLOB_READ_WRITE_TOKEN` for generated preview images. Private archive objects are served through the existing authenticated artifact download route.
3. Deploy the branch. The build now generates Prisma and compiles Next; it deliberately does not run `db push`. Deploy triggers the two queue consumers in `vercel.json`.
4. Record the report-only deployment timestamp in `CSP_REPORT_STARTED_AT`. Test Clerk sign-in, sign-up, account blocking and shared project edit/download; inspect violation reports.
5. Run `pnpm storage:migrate` first as a read-only count; then `pnpm storage:migrate -- --apply --batch=20` with the actual application DB and both Blob credentials. Each upload is checksum-verified; database source bytes are removed only after verification. Rerunning skips migrated rows.
6. With a direct/session connection (not the transaction pooler), run `node scripts/database-maintenance.mjs` for size, then `--vacuum-full` during maintenance. Exclusive-lock acquisition stops after five seconds; execution is bounded to ten minutes.
7. Start the research pool with `WORKER_PROCESSES=2` (raise according to browser/machine capacity). Each machine needs its existing worker token and appropriate browser login. Browser generation worker: `APP_URL=https://creative.xark.io node --env-file=.vercel/browser-worker.env.local workers/browser-worker/worker.mjs`.
8. Verify real queue retry/redelivery, closed-page rendering progression, offline worker recovery and quotas. After seven days of actionable CSP reports reviewed, enable the enforcement switch.

## Database plan verification

On 2026-10-14/16, read-only dashboard inspection located the live `creativeintel` schema in the production Supabase project. The organization is on Pro with the spend cap enabled; this project has 8 GB provisioned disk, so the Free plan's 500 MB limit does not apply. The refreshed infrastructure page showed 1.33 GB used of 8 GB (17%): database 819.9 MB, WAL 368 MB and system 172.4 MB. The project status settled on **Healthy** after briefly showing Unhealthy during loading; CPU was 5%, RAM 51-60%, with 30-31 of 60 connections. SQL catalog reads found 52 application tables occupying 661 MB, led by `ArtifactBlob` 373 MB, `PreviewAsset` 155 MB, and `Storyboard` 114 MB. A fresh `pg_stat_user_tables` read showed 31 estimated live Storyboard rows and 26 estimated dead rows; this supports a maintenance-window bloat investigation but is not a measured reclaimable-byte count. The live `creativeintel` schema has no `_prisma_migrations` history table. A 2026-10-16 object check confirmed both queue tables, the four query indexes, and the four new trace/submission columns are all absent. These are read-only findings; no production migration or VACUUM was run. Scheduled physical backups are visible, most recently 2026-10-16 12:01:11 UTC, but no production restore drill was run. Supabase Advisor also flags `public._prisma_migrations` with RLS disabled and `public.abtest_results` as a security-definer view. Those are in the shared project's `public` schema and require separate ownership/privilege review before any change.

## Pricing sources

- Gemini: https://ai.google.dev/gemini-api/docs/pricing
- Anthropic: https://www.anthropic.com/claude-sonnet-5-5
- fal Flux Schnell: https://fal.ai/models/fal-ai/flux/schnell

## Validation

At PR head `eaaa11f`: fresh PostgreSQL migration replay had no schema diff; lint and typecheck passed; Vitest passed 1,731 tests (4 skipped); smoke and Vercel preview passed. A production-style local db-push baseline rehearsal also applied the six additive migrations with zero final schema diff. The local-files route manifest fell from 1,544 entries (1,427 workspace files) before exclusion to 123 entries (0 workspace files). Its Vercel deployment path returns 404 by design. Global output tracing now excludes ignored `out/` media fixtures; the render queue trace fell from 1,191 to 650 files, with fixture files falling from 541 to zero.

Isolated local PostgreSQL tests verified SQL summaries, grouped allowance reads, twelve competing lease claims, duplicate phase execution, persisted checkpoint/worker resume, budget retention and immediate authorization revocation. No production schema/data migration, VACUUM, production application deployment, or real multi-machine/queue execution has occurred. The prior five reviewed runtime variables plus `BACH_ACCESS_KEY` and `BACH_SECRET_KEY` are configured as Vercel secrets for Production and Preview and activate on redeploy. Remaining release gates are applying migrations, setting private archive storage credentials, media migration, direct-connection VACUUM FULL, live queue/worker verification, and seven days of CSP report observation. Bach integration validation is tracked separately in [bach-provider.md](bach-provider.md).

## Later preview validation

At commit `a01f7cd`, the OUFER user journey exposed stale structured script fields after body edits and no direct way to repair a storyboard frame. Commits `7a0c855` and `a01f7cd` address those issues. The branch preview and PR smoke/typecheck/test checks passed. Five local OUFER video review masters, scripts, and the full observed journey are recorded in [OUFER review](../deliverables/oufer-20261017/REPORT.md). Existing preview storyboard records created before the fix still require resaving and review; the code change does not silently rewrite them.
