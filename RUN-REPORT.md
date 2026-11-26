# RUN-REPORT — creativeintel

## 2026-11-07 · feat/adstudio-studio — Ad Studio inside Studio (pushed as branch only; main untouched)
Goal: the Studio storyboard is fed to the Ad Studio pipeline for a second pass (re-analysis, hook per picked hook type,
generation per picked engine) without replacing or dropping any storyboard detail.

Changes: `AdStudioRun` model (additive); `services/video-gen/adstudio-{catalog,queue,worker-status}.ts`;
`/api/projects/[projectId]/studio/adstudio-runs` (+ `[runId]/approve`, `[runId]/cancel`); `/api/worker/adstudio`;
blob prefix `creativeintel/adstudio/`; `components/studio/adstudio-panel.tsx` mounted under the LibTV panel behind
`NEXT_PUBLIC_ADSTUDIO=1`; `workers/adstudio-worker`.

Verification (local Docker Postgres `localhost:55432`, `prisma db push --url` to it only; `next dev` with AUTH_PROVIDER=none):
- `npx tsc --noEmit` exit 0; eslint on changed files clean; `vitest run src/services/video-gen src/app/api/worker src/components/studio` 455 passed / 1 skipped; worker `node --test` 2/2.
- State machine with a fake pipeline root: 2 hook types × 2 engines → 4 runs; engines of the same hook copied the leader's plan
  (copy_plan) with their own estimate; approve 200, second approve 409, cancel 200, approve-after-cancel 409; 2 generated to
  `completed`; SpendEntry rows: 2 key-frame entries (0.40) + 2 video entries settled (0.91, 1.20); cancel during planning killed
  the pipeline process and ended `cancelled`; Storyboard row `updatedAt = createdAt` (never written).
- Real pipeline (ad-studio repo, API-key mode for this one run because the Mac's Claude CLI is logged out): 8-frame Moneta
  storyboard → plan with 8/8 planned frames carried, hook "Tastes like chalk" locked, 9 shots, estimate $1.01
  (Seedance 1.5 Pro ×2 + Veo 3.1 Lite ×3), $0.45 spent on first frames; stopped at awaiting_approval; no video generated.
- 1 setup failure found and recorded: CLI subscription login missing → `claude -p` "Not logged in".

## 2026-11-07 push + first real video
- Branch `feat/adstudio-studio` pushed to GitHub (main untouched). The push started a Vercel Preview build; Preview and Production share
  the same Neon DATABASE_URL (checked by hashed host) and the build runs `prisma db push`, so the build was removed before it reached
  the DB. Read-only check: production has no `AdStudioRun` table. `vercel.json` now sets
  `git.deploymentEnabled["feat/adstudio-studio"] = false`; the next push created no deployment.
- Real end-to-end video through Xark (local Docker DB, next dev, worker --once): approve 200 → SpendEntry video reserved →
  worker generate → run `completed`, progress 100, actualUsd 1.6899, finalMp4Url/posterUrl set (local media base, no Blob).
  Ledger: image 0.4542 + video 1.2357 (est 1.01) = 1.6899 = run actualUsd. Video 23.7 s 1080x1920 with audio.
- Not done: Blob upload path (needs the deployed app), production `prisma db push` (needs Barron's OK), launchd plist for the worker.

## 2026-11-17 · release/adstudio — Ad Studio goes live (Barron: "最新的这个版本可以上线")
Brings the lab's Ad Studio work (xark-adstudio-lab-20261107, Nov 7-17) onto main: storyboard/reference workflows, hook and
end-card gallery (our own example ads only - third-party reference clips are kept out of public/), branding fields, context
pack, claim lease + reserve-then-approve + safe cancel, key frames / warnings / full cost at approval, Retry, sound profile per
product (`auto:<k>`), learning-loop weights, run id in ad names, worker updates.
- Schema: additive only (`AdStudioRun` + `Project.adStudioRuns`); the build's `prisma db push` creates the table.
- Panel stays behind `NEXT_PUBLIC_ADSTUDIO=1` (set for Production at go-live).
- Verification on this branch: `tsc --noEmit` 0; `vitest run` 1754 passed / 2 skipped (gallery test now asserts no reference clip ships);
  worker `node --test` 12/12; eslint on changed Ad Studio paths 0 errors. Files main changed since the branch point were not overwritten.

## 2026-11-17 · Production Ad Studio worker started
- launchd `co.celldigital.adstudio-worker` (KeepAlive) runs `workers/adstudio-worker/worker.mjs` from this checkout (now on `main` c42f2e8); env from `~/.config/adstudio-worker/prod.env` (chmod 600: APP_URL https://creative.account.xark.io, production WORKER_TOKEN, AD_STUDIO_ROOT); log `~/Library/Logs/adstudio-worker.log`.
- Checks: token probe → 404 "Run not found" (auth ok, prod `AdStudioRun` table queried), wrong token → 401; Claude CLI answers with a login environment (pipeline subscription mode works); worker process alive, first claim returned no run and logged no error.
- Spend still only after a user approves a run in Studio (reservation = estimate × 1.3).

## 2026-11-17 · feat/visual-mode — Picture mode asked before generation
- Studio panel "Picture": Video (default, every shot is real footage), Slides (key frames + camera moves, no video model), Slides + video. Stored as `input.visualMode`; the worker passes it to the pipeline. Video mode refuses the stock-photo remix engine. A slides run finishes from planning (no gate, $0 video) and books its key frames as image spend.
- Engine list: "Seedance 1.5 Pro" removed (retired from OpenRouter; the pipeline maps old runs to Seedance 2.0).
- Verification: vitest video-gen + studio 500 passed; worker 13/13; tsc 0.

## 2026-11-18 · prod video-mode smoke run — NOT RUN (blocked)
- Why: a video-mode run generates real footage (last real run $1.69, reservation = estimate x 1.3) and the approval gate needs a signed-in Studio user (Clerk/Xark SSO). The project's only token-based test path (`scripts/smoke.ts`, worker token) is free-only: health, operator select-creative, estimate-run. It cannot create or approve a run. Run rules forbid spending money, so nothing was triggered.
- Not done: no run created, no ffprobe, no frame grid. Status is not success.
- Tooling ready: ffprobe/ffmpeg at /opt/homebrew/bin; worker co.celldigital.adstudio-worker on main.
- Needs from Barron: OK on ~$2 spend, or a test-user path (service session / Access token) that can create and approve a run. Then: create video-mode run, approve, poll, `ffprobe -show_entries format=duration`, `ffmpeg -vf tile` frame grid, save in this file.

## 2026-11-18 · Video Brain (PRs #168 #169 #170 + this one)
- Built: Mac daemon `workers/video-brain` (launchd `co.celldigital.video-brain`, every 300 s, from this checkout), `POST /api/worker/brain`, `GET /api/brain`, admin page `/brain`. Design: ad-studio-20261104/docs/VIDEO-BRAIN-ARCHITECTURE-20261117.md; Barron's 5 decisions taken at the recommended A (in creative.xark.io; auto-approve ≤ $3/run, ≤ $20/day; learnings → rules via PR; Xark + local Ad Studio + batch scope; second-family review).
- Verification: `node --test workers/video-brain/test/*.test.mjs` 21/21 (tick wiring against a fake API: approve/retry/check/sync/publish, local jobs, strategist, digest, time budget); vitest brain/gate/layout 365 passed; `tsc --noEmit` 0; eslint 0 on changed paths; `build:check` exit 0 (routes /brain, /api/brain, /api/worker/brain); `/brain?fixture=1` rendered at 1280 and 375 px (scrollWidth 375).
- Live: production `/api/worker/brain` wrong token → 401; first launchd ticks `__VIDEO_BRAIN__ ok:true verified:true` (14 loops = 9 Xark projects + 5 local Ad Studio project groups, 3 incidents, all 11 probes green incl. OpenRouter balance and every routed video model listed). Strategist (`claude -p` Sonnet) wrote next actions for 8 stalled projects; learnings synced to 6 skills + Ad Studio `data/brain-learnings.json` (script prompt).
- Bugs found by the live run and fixed with failing tests: second check skipped local files; snapshot's auto-approved total ignored the same tick; pattern scan false positives (stem −16 LUFS, 30 ms fades); learning from pre-baseline videos; ticks up to 212 s (check time budget 120 s).
- Not done / limits: `/brain` live view needs Barron's sign-in (Xark Account; not typed by the agent); no production AdStudioRun exists yet, so server-side auto-approve/retry are tested only against the fake API; storage is AppSetting rows (new tables = production migration, needs Barron); the 2 lab jobs stuck at approval since 11-09 are Xark-managed and left for Studio.

## 2026-11-19 P1+P2 (no schema) — PR #187 (stacked on #186)
- workstreams.json + xark-job CLI + directive harvest; backfilled jobs acw-bf(81) bdsmpub-noir(10) bdsmpub-slides(10)
- verify: node --test test/*.test.mjs 39/39; sabotage (drop directives from syncAll) fails directives test; gh pr view 187 OPEN base p1-bdsmpub-batches
- 11 directive candidates in ~/.config/xark-studio/directives.json await Barron confirm
- assumption: one daemon tick ran branch code (00:13Z) and harvested with the old loose filter; store reset to [] and re-seeded with the strict filter

## 2026-11-26 overnight swarm round 2 (Video Brain)
- Merged after independent verification: creativeintel #194 (incident reclassify + ENOSPC, confirmFailures, strategist stdin/stderr), #195 (URL in product-name → productUrl; Vercel prod success), #196 (digest at-most-once, stalled dedupe, local/batch done, wait labels + priority, setup deep links with href guard, phaseMs). #196 failed first verification (double-send paths A/B/C, no href guard), fixed, passed second.
- Verify: `node --test workers/video-brain/test/*.test.mjs` 88/88; `worker.test.mjs` 17/17 on main 684c6b0.
- Assumptions: at-most-once digest preferred over a possible duplicate DM; corrupt state = fresh start (pre-existing).

## 2026-11-26 overnight swarm round 3 (Video Brain)
- 19 candidates from 3 lenses → 2 critics (2 rounds) → 6 jobs. Merged after independent verification: creativeintel #197 (worker signal), #198 (loops/strategist/digest/board; 2nd pass), #199 (incidents; wiring gap accepted, closed by #200), #200 (atomic state, read-only dry-run, tick lock, logs, batch freshness, critic refund, loudness retry; passed on 3rd verification); ad-studio #8, #9, #10.
- Dropped this round: BL12 blank-frame gate (false-fail risk), P5 pipeline double-run (deferred; paid video off).
- Verify: brain 136/136 on main eb35621; worker 18/18; AS pipeline 161/161; Vercel prod success for #198.
