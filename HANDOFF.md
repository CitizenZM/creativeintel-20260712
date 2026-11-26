# creativeintel-20260712 — HANDOFF
每次运行/更新后追加；新会话先读最后一条。

### 2026-10-29 11:08 · claude-opus-5-5
- 完成: feat/account-xark-sso pushed (e7a2bcb): Xark Accounts SSO — legacy host 301, account sign-in/up redirects, apps.creative gate, verified-email relink, owner claim, invitations. Based on origin/main to exclude 2 unpushed local-main commits containing .env.local.bak secrets (repo is PUBLIC).
- 验证: vitest 1689 passed/2 skipped (175 files); tsc exit 0; build:check exit 0
- 下一步: Barron: purge 2922258/958fe09 from local main before auto-sync pushes them to the public repo; set Vercel env; review/merge

### 2026-10-29 17:14 · claude-opus-5-5
- 完成: Xark Accounts SSO live on creative prod (a5a9109 on main)
- 验证: vitest 1689 pass, tsc 0; 301/302 redirects; Barron session sees 12 projects
- 下一步: Barron restores preview APP_DATABASE_URL; DB check for duplicate AppUser

### 2026-11-03 18:58 · claude-opus-5-5
- 完成: Cron cadence cut 42->16/hr (poll/autopilot 10m, hook-variants/ops-health 30m); CRON_SCHEDULES synced + sync test; f3ceb54 on main
- 验证: vitest 1695 pass; tsc exit 0; mutation test fails on mismatch; prod dpl_7MUyxpyWaRondEaSTiBWSW4YexJS READY; project crons show new schedules
- 下一步: Watch next Vercel invoice (Dec 3) for Fluid Provisioned Memory drop; consider disabling Observability Plus

### 2026-11-06 12:30 · claude-opus-5-5
- 完成: Worker idle backoff (cap 5 min) + hook-variants/ops-health hourly, PR #163 merged dcbc657 prod READY; 125 stale LibtvJob + 3 WorkerTask closed (reversible tag closed-stale-20261106)
- 验证: node --test workers/idle-backoff.test.mjs 3/3 (old code fails 47 claims/2.5s); vitest 1695 pass; tsc 0; prod crons re-read; SQL queued/running=0
- 下一步: Barron: on the operator Mac git pull + restart libtv/research/browser workers; transfer tcl-membership-v2 to a free org (needs affiliate@xark.io Supabase login)

### 2026-11-07 08:58 · claude-opus-5-5
- 完成: Ad Studio second pass inside Xark Studio on local branch feat/adstudio-studio: AdStudioRun model, APIs, worker route, Studio panel (multi hook types x multi engines, max 6), adstudio-worker; storyboard never written
- 验证: tsc 0, eslint clean, vitest 455 pass, worker 2/2; local Docker DB e2e: create/plan/copy-plan/approve/409/cancel/generate/spend OK; real pipeline plan 8/8 frames, est $1.01, $0.45 spent, no video
- 下一步: Barron: gh auth login + claude /login; decide push/preview DB; then real generate test after approval

### 2026-11-07 10:52 · claude-opus-5-5
- 完成: Pushed feat/adstudio-studio (main untouched); stopped the Preview build that would have run prisma db push on the shared prod Neon DB (prod has no AdStudioRun table, read-only check); disabled Vercel builds for the branch; first real video end to end via local Xark (run completed, $1.69, ledger matches)
- 验证: git ls-remote = HEAD; vercel ls no new deploy after push; ledger 0.4542+1.2357=1.6899=run actualUsd; final.mp4 23.7s 1080x1920
- 下一步: Barron OK for prod prisma db push + merge; then deploy and test Blob upload; launchd for worker

### 2026-11-10 23:21 · claude-fable-5-2
- 完成: Clerk azp fix: creative proxy authorizedParties now accepts https://portal.account.xark.io (PR #164 squash-merged c0ff48b, prod dpl_2dWbtoSKk7YWTwcg3ceJgwvWUVA5 Ready). client-portal JWKS 401 NOT fixed: Production CLERK_SECRET_KEY is a 14-char truncated value; no valid Xark Accounts production key exists locally or in readable Vercel envs
- 验证: vitest 177 files/1696 tests pass, tsc rc=0; vercel deployment READY on c0ff48b; no azp traffic since 04:45Z so live log confirmation pending; client-portal: jwks kid comparison of all candidate keys = no match for ins_3LNY0DFM9cAcjqks3YXG4yOD3ck
- 下一步: Barron: copy Secret key from Clerk app Xark Accounts > Production > API keys into Vercel client-portal Production CLERK_SECRET_KEY and redeploy; then re-check creative runtime logs for azp

### 2026-11-17 18:31 · claude-opus-5-5
- 完成: Production Ad Studio worker started: launchd co.celldigital.adstudio-worker, token in ~/.config/adstudio-worker/prod.env (600), checkout on main c42f2e8
- 验证: token probe 404 Run not found (auth+table ok), wrong token 401, claude CLI ok, worker alive, claim no error
- 下一步: Barron: sign in and run one storyboard through Studio > Ad Studio to see key frames at approval

### 2026-11-17 21:08 · claude-opus-5-5
- 完成: PR #167 merged (dcce8b4): picture mode video/slides/mixed; prod deploy success; worker restarted on main
- 验证: Vercel success; prod API 401 unauth; worker PID running
- 下一步: Barron: test one video-mode run in Studio

### 2026-11-18 00:58 · claude-sonnet-5-5 (barron-brain worker)
- 完成: Prod video-mode smoke NOT run: needs real spend (~$1.7) and a signed-in approval; project test path is free-only
- 验证: read scripts/smoke.ts and docs; RUN-REPORT updated; no run created
- 下一步: Barron: OK ~$2 spend or provide test-user session; then run, ffprobe, frame grid

### 2026-11-18 01:24 · claude-opus-5-5
- 完成: Video Brain live: daemon co.celldigital.video-brain (5-min ticks, verified publish), /api/worker/brain, /api/brain, admin page /brain; local Ad Studio jobs, strategist (claude -p), auto-approve caps $3/$20, second checks, incidents, probes, fix patterns, learnings synced to 6 skills, daily Feishu DM digest 07:30 PT; PRs #168-#171 merged
- 验证: node --test workers/video-brain 21/21; vitest 365 pass; tsc 0; build:check 0; live ticks ok:true verified:true; prod route wrong-token 401
- 下一步: Barron: sign in and open creative.xark.io/brain; confirm product details on 7 projects stuck at Setup; first production AdStudioRun will exercise server auto-approve

### 2026-11-18 02:28 · claude-opus-5-5
- 完成: Video Brain round 2: live run overlay on /api/brain, Gemini second-family critic (≤10/day), acw batch (81 videos) in the loop, rule changes via reviewable PRs on ad-studio (pipeline reads tracked brain-rules.json), launchd python bug found by probes and fixed (ad-studio 7c87048), daily Feishu DM digest; PRs #172-#174 merged
- 验证: workers 26/26; vitest brain 11; build:check 0; live ticks ok/verified, 15 loops, 39 checks, 6 critic reviews, 11/11 probes green
- 下一步: Barron: sign in to creative.xark.io/brain; confirm product details on 7 Setup-stalled projects; review rules PRs when they appear; approve real Brain* tables if wanted

### 2026-11-18 02:38 · claude-opus-5-5
- 完成: Final acceptance: worker 'view' action (#175) proves the live /brain payload (15 loops, 39 checks, 87 events, 16 learnings, 11/11 probes, live overlay); that exact payload rendered in the board; prod approve/retry routes 404 on unknown run against the real DB; first digest DM sent and read back (verified)
- 验证: curl view 200; board render of prod payload: 10 sections, no fetch error; sendVerifiedDM ok+verified
- 下一步: Barron: approve or decline real Brain* tables (production migration); act on the 8 items in the digest

### 2026-11-18 02:58 · claude-opus-5-5
- 完成: Brain now pushes: started a real production Ad Studio batch for TCL Analysis (#176); it failed at script with OpenRouter 402 because the Ad Studio key's own monthly cap ($60) has $0.50 left (account $94.89). Probe fixed to read the key cap (#177); no new paid work while short; 402 failures auto-retried when funds return (#178); Barron DM'd (verified)
- 验证: workers 31/31; prod run cmwm03l8i…gslpetbu queued→planning→failed(402) observed; probe live: '$0.50 spendable … raise the key limit'
- 下一步: Barron: raise the OpenRouter key limit (openrouter.ai/settings/keys) — then the brain retries TCL/biggreenorganic runs, gate auto-approves ≤$3, second check + critic run on the result

### 2026-11-18 03:22 · claude-opus-5-5
- 完成: End-to-end production acceptance: brain started a free stock-remix batch for TCL Analysis (#179, paid key capped) → worker script/voice/render/review → completed video on Vercel Blob in 7 min → brain second check PASS (200 mp4, 23.33 s, 1080x1920, h264, aac, -14.0 LUFS)
- 验证: run cmwm0tra5000008lbzt62l6wa queued 11:11 → completed 11:18; view checks pass:true; workers 32/32
- 下一步: Barron: raise OpenRouter key cap (paid AI-video path + gate auto-approve then run automatically); decide on Brain* tables

### 2026-11-18 03:25 · claude-opus-5-5
- 完成: Paid gate path proven end to end on lab Postgres with this code: $1 run auto-approved (SpendEntry 1.3, OpsEvent), $5 held + direct approve refused 409, transient failure retried then approved (day 2.60). Brain tables built as PR #180 (unmerged: merge = production db push), verified on lab DB
- 验证: lab brain_e2e: 2 ticks; SELECT shows approved+reserved; tables smoke 1 pass
- 下一步: Barron: merge #180 if you want tables (then BRAIN_TABLES=1); raise OpenRouter key cap for paid AI video in production

### 2026-11-18 06:23 · claude-opus-5-5 (barron-brain)
- 完成: 大脑代决（可回退、不花钱，Barron 可推翻）：Video Brain 的真 Brain* 表要不要上 production migration → 先在 preview/branch DB 跑一周，数据没问题再迁 prod
- 验证: brain asks.json 推荐项；仅暂停/归档/留空/先走 preview
- 下一步: 按代决执行：先在 preview/branch DB 跑一周，数据没问题再迁 prod

### 2026-11-19 01:04 · claude-opus-5-5
- 完成: STOPPED: Brain* local migration timed out 4x (25 min); no further dispatch
- 验证: lastBrainRun failed 2026-11-18T17:21 timeout
- 下一步: STOPPED — wait for Barron answer on migration/OpenRouter budget

### 2026-11-19 11:45 · claude-opus-5-5
- 完成: Architecture review of video platform vs 4 target systems; roadmap P1-P5 in docs/ARCHITECTURE-REVIEW-20261119.md
- 验证: Grounded on video-brain log (learn:0, openrouter probe failing), 6 LEARNINGS.md, product scrape route, AdPerformance has no import
- 下一步: Barron picks start phase (rec P1+P2) and schema path (rec with PR #180)

### 2026-11-19 14:01 · claude-sonnet-5-5 (barron-brain worker)
- 完成: P1 no-migration slice: PR #186 registers bdsmpub noir+slides sets as Video Brain batch jobs (dir-scan when no INDEX.csv). OpenRouter probe fail is empty balance, not code
- 验证: node --test workers/video-brain/test: 36/36 pass; new batch-dir test fails 0!==2 with lib/batch.mjs reverted; gh pr view OPEN
- 下一步: Barron: merge #186; remaining P1 (Workstream via AppSetting, xark-job CLI) not started; P2 needs #180 schema

### 2026-11-19 16:19 · claude-opus-5-5
- 完成: P1+P2 no-schema: PR #187 (stacked on #186) workstreams.json, xark-job CLI (start/finish/list/backfill/directives), daily harvest of Barron's typed video instructions as candidates, synced to skills/_shared/VIDEO-KNOWLEDGE.md + Ad Studio json
- 验证: node --test 39/39; directives wiring test fails when unwired; readBatches shows acw 81 + bdsmpub 10+10; 11 real candidates
- 下一步: Barron: merge #186 then #187; confirm/reject 11 directive candidates; #180 for Neon tables

### 2026-11-19 16:42 · claude-opus-5-5
- 完成: Merged #186+#187; Barron confirmed all 11 harvested directives; Brain synced them to _shared/VIDEO-KNOWLEDGE.md, 6 skills LEARNINGS.md, ad-studio brain-learnings.json
- 验证: directives.json 11 confirmed; grep finds rule in 6 skills + ad-studio json; shared file 11 session-sourced rules
- 下一步: Ad Studio script prompt should read data/brain-learnings.json workstreams; P4 Quick Create

### 2026-11-19 18:27 · claude-opus-5-5
- 完成: Directives wired to Ad Studio script prompt: ad-studio PR #2 (directivesBlock per workstream/brand), creativeintel PR #188 (rules PR carries global+workstreams)
- 验证: ad-studio test_brain_rules 9/9; video-brain 40/40; sabotage fails wiring test
- 下一步: Barron merges ad-studio#2 then creativeintel#188; then merge the Brain's brain/rules-* PR

### 2026-11-26 07:37 · claude-opus-5-5
- 完成: Overnight Video Brain swarm rounds 2-4: merged creativeintel #194-#205 and ad-studio #5-#11 after independent verification (brain 167/167, worker 29/29, AS 167/167); live learnings repaired; worker restarted on adopt code
- 验证: node --test workers/video-brain/test/*.test.mjs (temp HOME) 167/167; adstudio-worker 29/29; ad-studio pipeline 167/167; Vercel prod success
- 下一步: Round 5 queue in scratchpad r5-queue.md; Barron: OpenRouter key cap, rules PR ad-studio#4, reminders doc
