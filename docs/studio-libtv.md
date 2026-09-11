# Create Studio → LibTV runbook

Studio produces a finished vertical ad in five steps: compile a storyboard into
a node graph, approve its credit estimate, let the local worker render it on
LibTV, assemble the cut locally, and download the master.

LibTV is a render farm, nothing more. Briefs, scripts, storyboards, prompts and
the final edit all happen here — that rule comes from
`.claude/skills/design-video-ad-libtv/SKILL.md` and is what keeps the product
consistent and the cuts on the beat.

## 0. One-time setup

**App** (Vercel env, or `.env.local` for local dev):

| Var | Why |
|---|---|
| `WORKER_TOKEN` | shared secret for `POST /api/worker/libtv`; `openssl rand -hex 32` |
| `CLOUDINARY_URL` *or* `BLOB_READ_WRITE_TOKEN` | where keyframes, clips and masters are hosted |

**Operator's Mac:**

```bash
~/.libtv/libtv login web       # opens a URL; approve it in the logged-in browser
python3 -m pip install --user Pillow
brew install ffmpeg aubio      # aubio is optional — it supplies the beat grid
```

Same `WORKER_TOKEN` in the worker's environment. See
`workers/libtv-worker/README.md` for the full variable list and the launchd
plist.

## 1. Dry-run first

Never hand a new storyboard straight to a paying canvas. This prints every
`libtv` command, the node order and the assembly timeline without touching the
network or spending a credit:

```bash
node workers/libtv-worker/worker.mjs --dry-run --fixture
```

To rehearse a *real* compiled run, copy its payload
(`$LIBTV_RUNS_DIR/<runId>/run.json`) and pass
`--dry-run --fixture=/path/to/run.json`.

## 2. Compile

In Studio, pick a storyboard, an image model and a video model, then **Compile
run**. The run lands in `awaiting_approval` with:

- one `upload` node per packshot (`PROD-1…4`) and one for the logo (`LOGO`)
- one `K<n>` keyframe per 2-second frame, `image2image` off `PROD-1`
- one `V<n>` clip per non-CTA frame, `singleImage2video` off `FF K<n>`
- CTA frames flagged `compositeLocally` — no LibTV node, no credits

Compilation refuses with 409 if the brand kit has no packshot. That is
deliberate: AI models render packaging *nearly* right, and the brand owner
notices. Every legible product frame comes from the official photo.

## 3. Approve

**Approve** moves the run to `approved`, which is the only status a worker will
claim. It is blocked if the brand kit is not studio-ready (packshots, logo,
CTAs, landing URL, product summary, claims, SKU dimensions in cm) — the response
lists what is missing.

Set a credit cap at approval. Default sizing: 8 frames ≈ 7 keyframes (98) +
7 clips (168) ≈ 266 credits with Seedream 5.0 Pro + Hailuo 2.3 Fast. The cap
cannot be below the estimate.

Prices are measured, not quoted — the CLI has no balance command. Read the
balance in the LibTV web top bar before and after a batch.

## 4. Run

```bash
npm run worker:libtv
```

The worker claims the run, creates or reuses the canvas
(`Project.libtvCanvasUuid` is reused so a brand keeps one canvas), and walks the
graph. Studio polls every 5 s while the run is active and shows per-node status,
per-node errors and the live credit total. **Open in LibTV** links to
`https://www.liblib.tv/canvas?projectId=<canvasUuid>`.

A run whose worker dies is returned to `approved` after 30 minutes and can be
claimed again; completed nodes are not re-run.

## 5. Assembly and delivery

`assemble.py` runs locally after the last node:

- 1080×1920 @ 30 fps, one clip per 2 s window, trimmed to the grid
- CTA cards and the logo end card composited from `refs/PROD-1` and `refs/LOGO`
- boundaries snapped to an `aubio` beat grid when `LIBTV_MUSIC_FILE` is set
- exports `final/master.mp4`, `final/preview-720p.mp4`, `final/contact-sheet.jpg`

All three are uploaded and appear in Studio as **Download master**, preview and
contact sheet, and are included in the project's `/export` zip alongside every
per-frame keyframe URL.

## Where files land

```
$LIBTV_RUNS_DIR/<runId>/        default ~/Projects/libtv-ad-studio/runs/<runId>/
  run.json  manifest.json  canvas.json
  refs/  keyframes/  clips/  final/
```

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Studio shows "needs libtv login" | token expired (`10001 用户未授权`) | `~/.libtv/libtv login web`, restart the worker, re-approve the run |
| `图片生成节点须为图生图模式` | image node with a reference edge but no `modeType=image2image` | pricing table bug — the settings map must emit it |
| `params.settings.duration=N 不在允许范围` | duration outside the model's enum | pick an allowed duration in the Studio picker |
| Node result URLs start with `file://` | no storage provider configured | set `CLOUDINARY_URL` or `BLOB_READ_WRITE_TOKEN` and re-run |
| `download wrote nothing` | node name mismatch | node names are unique per canvas; a reused canvas may already hold a `K3` |
| Clips look like a slideshow | keyframes were static poses | regenerate keyframes — the prompt must capture mid-motion |

## Cost table (measured 2026-09-10, annual VIP)

| Model | Spec | Credits |
|---|---|---|
| Seedream 5.0 Pro | 2K image | 14 |
| Lib Image 2.5 Pro | 2K image | 27 |
| Hailuo 2.3 Fast | 6 s 1080P | 24 |
| Kling O3 | 3 s / 5 s | 24 / 40 |
| Kling 3.0 Turbo | 3 s 720p | 36 |
| Wan 3.0 | 2 s / 4 s | 20 / 40 |
| Seedance 2.0 Mini | 4 s 480P / 720P | 32 / 64 |
| Seedance 2.5 | 4 s 480P / 720P | 80 / 156 |
| Seedance 1.5 Pro | 5 s 1080P | 90 |
