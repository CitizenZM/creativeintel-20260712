# adstudio-worker

Runs the Ad Studio pipeline (repo `ad-studio-20261104`) for **Studio → "Ad Studio · optimise this storyboard and generate"**.

1. **Pick:** the user picks one or more hook types and one or more video engines. Each hook type × engine becomes one `AdStudioRun`; a batch holds at most 6.
2. **Plan:** the worker claims a run and writes an Ad Studio job with `source: "xark"`. The full storyboard snapshot (every frame field, the script, the brand kit, the offer) goes into the job.
3. **Second pass:** the pipeline re-analyses the storyboard and rewrites the hook for that hook type. It keeps every planned frame: each shot lists its `src_frames`, and a frame that gets dropped triggers one repair pass. It then makes A/B first frames and prices the video.
4. **Approval:** the run stops at `awaiting_approval`. The storyboard row is never written.
5. **Same hook type, other engines:** these runs copy the leader's plan (`pipeline/clone.mjs`), so the engines are compared on identical scenes and first frames.
6. **Generate:** after the user approves, the pipeline generates, adds the voice, renders, reviews and does at most one auto-fix round. It then uploads to Vercel Blob (`creativeintel/adstudio/`) and reports back.

## Run

```bash
cd workers/adstudio-worker && npm install
APP_URL=https://creative.account.xark.io WORKER_TOKEN=… node worker.mjs
```

| Env | Default | |
|---|---|---|
| `APP_URL` | `https://creative.account.xark.io` | |
| `WORKER_TOKEN` | — | Required. Same token as the libtv-worker |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | — | Needed if Deployment Protection is on |
| `AD_STUDIO_ROOT` | `~/Projects/ad-studio-20261104` | |
| `ADSTUDIO_MEDIA_BASE` | — | Local testing only: serve results from Ad Studio's file route (`http://localhost:5310/api/file/jobs`) instead of uploading them |
| `ADSTUDIO_BUDGET_USD` | `6` | Per-video cap for frame-QA re-generation |
| `POLL_INTERVAL_MS` / `MAX_IDLE_POLL_MS` | `20000` / `300000` | Idle backoff |

Use launchd (`~/Library/LaunchAgents/co.celldigital.adstudio-worker.plist`, `KeepAlive` true), the same way as `co.celldigital.ad-studio.web`. The worker removes `CLAUDE*` variables from the pipeline's environment so the pipeline never borrows a host Claude Code session. The pipeline's Claude calls need either the Mac's Claude CLI to be logged in (`claude /login`, subscription mode, for your own use) or Ad Studio set to API-key mode (`data/settings.json` `{"engine":"api"}` + `ANTHROPIC_API_KEY`); on 2026-11-07 the CLI was logged out, so plans fail in subscription mode until it is logged in again.

## Test

```bash
node --test workers/adstudio-worker/worker.test.mjs   # job mapping, plan extraction
npx vitest run src/services/video-gen/adstudio-catalog.test.ts src/app/api/worker/adstudio
```

For an end-to-end check against a local Postgres, set `AUTH_PROVIDER=none` and the local `APP_DATABASE_URL` / `DATABASE_URL`, and run `next dev` with `NEXT_PUBLIC_ADSTUDIO=1`. Point `AD_STUDIO_ROOT` at a fake root whose `pipeline/run.mjs` writes `status.json` (see RUN-REPORT); this tests the state machine without any spend.
