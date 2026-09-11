# Audit 04 — Create Studio / Video generation (Claude Opus)

Production env cross-check: `FAL_KEY`, `GOOGLE_API_KEY`, `GOOGLE_GENAI_API_KEY` **present**; `CLOUDINARY_*`, `GROQ_API_KEY`, `BROWSER_WORKER_TOKEN`, `CRON_SECRET` **absent** → assembly, transcription, browser-worker and cron auth are all dead in production. `FalVideoJob` = 50 rows (used), `BrowserGenJob` = 0 rows (never used).

## 1. Generation paths

| Path | Code | Status | Env | Vercel? |
|---|---|---|---|---|
| Veo (raw REST) | `studio/generate-video/route.ts:109-119`; `video-gen/poll.ts:83-121` | Live | `GOOGLE_API_KEY` | Yes |
| fal.ai t2v/i2v | `generate-video:38-93`, `generate-from-script:139`, `generate-shots:211`; `models.ts:46-111` | Live | `FAL_KEY` | Yes |
| Image keyframes | `studio/frames/route.ts:23` gpt-image-1 → fal flux → Pollinations; `storyboard-keyframes` → Pollinations | Live | `OPENAI_API_KEY`, `FAL_KEY` | Yes |
| browser-worker (Gemini/Flow/Kling) | `BrowserGenJob`, `api/worker/browser-jobs`, `workers/browser-worker/worker.mjs` | Orphaned; `kling.mjs:32-36` NOT_IMPLEMENTED | `BROWSER_WORKER_TOKEN`, `CLOUDINARY_*` | Local only |
| moneyprinter | `video/moneyprinter.ts:26`, `runner.ts:283-318` | Stub | `MONEYPRINTER_PATH` | No |
| yt-dlp/ffmpeg import + shortsify | `downloader.ts:68`, `shortsify.ts:91`, `binaries.ts:30-35` | Local only | — | No |
| Cloudinary fallback | `runner.ts:38-72`, `cloudinary-render.ts:72`, `cloud-downloader.ts:30` | Needs keys | `CLOUDINARY_*` | YouTube-only |
| Assembly | `video-gen/assemble.ts` (`fl_splice`) | crossfade no-op (`:157-162`), 20-clip cap (`:23`) | `CLOUDINARY_*` | Yes |
| Cron sweep | `api/cron/poll-video-jobs`, `vercel.json` */5 | Polls `FalVideoJob` only (`poll.ts:236`) | `CRON_SECRET` | Yes |

**UI triggers today:** `studio/page.tsx` → `video-brief` (:150), `storyboard-keyframes` (:167), `veo-prompt` (:183), `generate-video` (:197), `video-status` (:226). `studio/video/page.tsx` → `fal-jobs` (:411), `fal-status` (:425), `veo-prompt` (:450), `generate-video` (:473). `studio/frames` from Creative tab (`lofi-frame.tsx:30`, `storyboard-frame-card.tsx:171`).

**Never called by any UI:** `studio/browser-jobs`, `studio/generate-shots`, `studio/generate-from-script`, `studio/assemble`. The keyframe→i2v→assemble spine and the local-worker spine have no entry point.

**Live bugs:**
- `studio/page.tsx:771-775` offers `veo-3.1-lite`, `veo-3-fast`, `veo-3` — none exist in `models.ts`; coerce to `veo-3.1-fast` (`generate-video:106`).
- `studio/page.tsx:208` only reacts to `operationId`; fal returns `jobId` → button does nothing.
- `video-library-panel.tsx:84-85` `Array.isArray(data)` but `video/references/route.ts:38` returns `{references}` → list always empty.
- `assemble.ts:41` reads `FalVideoJob` only.

## 2. Local-worker pattern assessment

**Reusable:** constant-time token auth (`worker/browser-jobs/route.ts:23-35`); race-safe claim via conditional `updateMany` (`browser-queue.ts:90-119`); heartbeat + `requeueStale` 15 min (`route.ts:83-87`, `browser-queue.ts:168-181`); worker loop with SIGTERM (`worker.mjs:181-257`); Cloudinary upload from worker, no DB creds on Mac (`worker.mjs:154-164`).

**Broken:** double attempt increment (`browser-queue.ts:107` + `:145`) → effective retries ≈1; heartbeat ignores `workerId` (`route.ts:77-88`); single `resultUrl`; no cost field / approval gate; depends on retired `browser-harness` (`_harness.mjs:28`); README path wrong (`README.md:122`); no list/status action.

## 3. LibTV integration design

New models (do not reuse BrowserGenJob):

```
LibtvRun  id, projectId, scriptId, storyboardId, status(draft|awaiting_approval|approved|running|completed|failed),
          canvasUuid, canvasUrl, creditsEstimated, creditsSpent, approvedAt, masterMp4Url, workerId, claimedAt, updatedAt
LibtvJob  id, runId, projectId, shotIndex, kind(upload|image|video), nodeName, nodeId, prompt, leftRefs Json,
          settings Json, modelName, creditsEstimated, creditsSpent, status, resultUrl, localPath, error, attempts, workerId, claimedAt
Project.libtvCanvasUuid
```

Worker `workers/libtv-worker/` claims a whole run, binds canvas, walks jobs in order:
```bash
libtv project create "CI-<slug>-<scriptId>" && libtv project use <uuid>
libtv upload "PROD-<sku>" --file refs/product.png
libtv node create "K<n>" -t image --left "PROD-<sku>" --prompt "<imagePrompt>" \
  -s "model=Seedream 5.0 Pro" -s modeType=image2image -s ratio=9:16 -s quality=2K -s count=1 --run
libtv node create "V<n>" -t video --left "FF K<n>" --prompt "<videoPrompt>" \
  -s "model=Hailuo 2.3 Fast" -s modeType=singleImage2video -s duration=6 --run
libtv download -n "V<n>" -o clips/ --without-ai-watermark --vip
```
Frame n → K<n> (image2image from product ref) → V<n> (singleImage2video from FF K<n>). `--run` blocks — never background. Assembly local (ffmpeg / skill `build_cut.py`), master uploaded to Cloudinary.

Credit gate: estimate from measured table (Seedream 5.0 Pro 14/image; Hailuo 2.3 Fast 24/6 s); run stays `awaiting_approval` until dashboard approves; worker refuses unapproved. No CLI balance command → per-node arithmetic + operator-entered balance.

API: `POST .../studio/libtv-runs` (compile + estimate), `POST .../libtv-runs/[runId]/approve`, `POST /api/worker/libtv` (`claim|node_started|node_done|run_done|fail|heartbeat`).

Dashboard: per-frame keyframe thumb + status, per-clip status + preview, credits est/spent, **Open in LibTV**, final MP4 (Cloudinary URL, not `/tmp`).

## 4. Remove vs keep

**Remove:** `moneyprinter.ts` + `runner.ts:283-318` + `video/generate/route.ts`; `playbooks/kling.mjs`; `studio/generate-from-script` (shot 0 only, `:120-127`); dead model options `studio/page.tsx:771-775`; `scripts/test-video.mjs`.
**Deprecate (hide from UI):** Veo "Generate All Videos"; browser-jobs once LibTV lands.
**Keep:** `prompt-compiler.ts`, `veo-prompt`, `video-brief`, `storyboard-keyframes`/`frames`, VideoLibraryPanel import via Cloudinary, cron sweep, claim/lease machinery.

## 5. Top 10 changes

1. `schema.prisma` — `LibtvRun` + `LibtvJob` + `Project.libtvCanvasUuid`.
2. `api/worker/libtv/route.ts` — new worker endpoint.
3. `services/video-gen/libtv-queue.ts` — port of browser-queue with double-increment fixed.
4. `workers/libtv-worker/worker.mjs` + `libtv-cli.mjs`.
5. `api/projects/[id]/studio/libtv-runs/route.ts` (+ approve).
6. `studio/video/page.tsx` — LibTV run panel.
7. `video-library-panel.tsx:84-85` — `data.references`.
8. `.env.example` — add FAL/GOOGLE/CLOUDINARY/GROQ/LIBTV_WORKER_TOKEN.
9. Delete moneyprinter, video/generate, kling.mjs, generate-from-script.
10. README paths.
