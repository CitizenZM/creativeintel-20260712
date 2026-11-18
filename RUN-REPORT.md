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
