# Ad Studio audit — bugs and inefficiencies (2026-11-11)

Scope: the Xark lab bridge (queue, worker API, Mac worker, Studio panel) and the Ad Studio pipeline
(`~/Projects/ad-studio-20261104`). Two read-only audits, then every finding re-read in the code before fixing.
Evidence: **C** = read in code, **L** = seen in job logs / lab DB, **R** = reproduced.

## Fixed (each with a test that fails without the fix)

| # | Where | Bug / waste | Evidence | Fix |
|---|---|---|---|---|
| 1 | lab queue + worker | A run requeued after a missed heartbeat (e.g. a long `final.mp4` upload) could be claimed again and generated twice; the first attempt's reports were still accepted | C | Each claim gets a lease id (`worker#random` in `workerId`); progress/gate/done/failed carry it; an old lease is refused and told to stop. Worker heartbeats during the upload |
| 2 | lab `approveRun` | Status went to `approved` before the spend was reserved; the worker could claim it in between, and a refused budget then overwrote `generating`; a parallel cancel could leave a reservation open forever | C | Reserve first, then one conditional write sets `approved` + `spendEntryId`; a lost race releases the reservation |
| 3 | lab `cancelRun` | Read-then-write: a run approved after the read was cancelled with its reservation left open | C | Conditional on the status and reservation it read; otherwise 409 "try again" |
| 4 | lab budget vs pipeline | Reserved the bare estimate, but frame-QA re-generation may spend up to `max(6, est × 1.3)`: lab run cmw7achmt est $1.30 → settled $1.75 | L | Reserve `est × 1.3`; the worker holds the job budget to that reservation |
| 5 | lab `requeueStale` | Cancelling a run whose worker died: requeued, never claimable, never cancelled, reservation open, followers blocked | C | A stale run with `cancelRequested` becomes `cancelled` and its reservation is released |
| 6 | lab `reportDone` | "Free run may finish from planning" was `estUsd === 0`, which is every run before its gate | C | Only the `remix` engine |
| 7 | lab `reportFailed` | A plan that failed after paid key frames booked nothing (gate never ran) | C, L | Books a key-frame spend entry and `actualUsd`; worker errors now send the spend from `status.json` |
| 8 | lab worker | `APP_URL` defaulted to production: a lab worker without it would claim production runs | C | Required, no default |
| 9 | lab panel poll | Every 5 s the full GET: 75.5 KB + ~15 queries, also in hidden tabs and with no worker online | R | `?runsOnly=1` (2 queries, 46.5 KB for 4 runs), paused in hidden tabs, 30 s when no worker is online |
| 10 | pipeline auto-fix | Undo restored the script but not the voice files: job xk-cmw8vvrgo… has v1 captions with v2 voice lines that overrun their slots; on a render error `final.mp4` could also stay v2 | R | `public/vo` backed up with `final_v1.mp4`; rejected and failed paths restore script + voice + video |
| 11 | pipeline review | A failed review left the previous run's scores, which could trigger an auto-fix of a different video | C | Review/auto-fix results cleared when the review step starts |
| 12 | pipeline render slots | Check-then-write lock: jobs starting in the same second all rendered (ENOSPC in xk-cmwbrjdo9… / dmd…) | L | One file per slot, taken with an exclusive create |
| 13 | pipeline `writeJSON` | Truncate-then-write: the web app could read an empty `status.json`, think the job idle and start a second pipeline | C | Temp file + rename |
| 14 | pipeline errors | The error kept the first 3 args — for `claude -p` the whole prompt — so the cause was cut off (3 Xark jobs show only prompt text) | L | Cause first; args longer than 80 chars left out |
| 15 | pipeline clip download | No `r.ok` check: an error page was saved as the clip, then the retry paid for a new generation | C | Download error is thrown with the job id and its cost |
| 16 | pipeline audio passes | Loudnorm analysis, LUFS and silence passes decoded the 1080×1920 video | C | `-vn` |

Verification: pipeline `node --test` 70/70 (5 new tests fail on the old code); lab vitest 1746 pass, 1 pre-existing cron
failure; new `adstudio-queue.test.ts` 9 tests (7 fail on the old code); worker test 10/10 (1 fails on the old code); tsc 0
(lab, renderer).

## Not fixed — needs a decision

| # | Where | Finding | Why not done |
|---|---|---|---|
| A | pipeline disk | ~3.3 GB of 5.0 GB in `data/jobs` is intermediates kept after `final.mp4`: `render_raw.mp4` 802 MB, `final_v1.mp4` 332 MB, `public/clips` copies 719 MB, `public/assets` copies 435 MB, `ref.mp4`+frames per job 353 MB, `*_raw` ~200 MB, `public/sfx` 118 MB | Deletes files (yours to approve): delete `render_raw.mp4` after `final.mp4`, `final_v1.mp4` after the verdict, hard links instead of copies, and a one-off cleanup of existing jobs |
| B | lab schema | No attempt counter: a run that crashes the worker every time is requeued forever and pays each time | Needs a new column → production `prisma db push` needs your OK |
| C | lab | No "retry" for a failed run: a re-POST re-plans and pays for key frames again | New route + UI; small, can do next |
| D | pipeline cost | A video job that times out while polling, then retried, pays twice and the first cost is not counted | Needs resume-by-job-id in `openrouter.mjs` |
| E | web app (local) | Approval in the local Ad Studio UI books only the estimate and ignores `AD_STUDIO_DAILY_USD` for re-generation | Local tool only |
| F | pipeline | refcache filled non-atomically; regenerating scene k leaves k+1 (`continues`) on the old frame | Unverified, no case in data |
| G | inefficiency | Second keyframe set generated after the first (+10–50 s per A/B job); known-bad pace refs retried every job (~5 s); product page re-fetched per job; end card rendered per variant; `copy_plan` leader can be a remix | Small gains; can batch next |
