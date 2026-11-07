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
