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
| `VERCEL_AUTOMATION_BYPASS_SECRET` | worker-side only — the Vercel project has Deployment Protection (SSO) on, so the worker sends `x-vercel-protection-bypass`; create it in Vercel → Settings → Deployment Protection → Protection Bypass for Automation |
| `CLOUDINARY_URL` *or* `BLOB_READ_WRITE_TOKEN` | where keyframes, clips and masters are hosted |
| `LIBTV_MAX_RUN_CREDITS` | compile ceiling, default 120 — a board over it is refused with 409 |
| `LOCAL_FILES_ROOT` | only when there is no cloud storage: the worker's runs directory, streamed by `/api/local-files` |

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

In Studio, pick a storyboard, an image model, a video model and a **budget
mode**, then **Compile run**. The run lands in `awaiting_approval` with:

- one `upload` node per packshot (`PROD-1…4`) and one for the logo (`LOGO`)
- one `K<start>` keyframe per clip group, `image2image` off `PROD-1`
- one `V<start>` clip per clip group, `singleImage2video` off `K<start>`
- CTA frames flagged `compositeLocally` — no LibTV node, no credits

Compilation refuses with 409 if the brand kit has no packshot. That is
deliberate: AI models render packaging *nearly* right, and the brand owner
notices. Every legible product frame comes from the official photo.

It also refuses with 409 when the estimate exceeds `LIBTV_MAX_RUN_CREDITS`
(default 120). Send `allowOverBudget: true` — the Studio checkbox — to compile
anyway.

### Budget modes

**Economy (default).** One clip covers up to
`floor(clipDurationSec / frameSeconds)` consecutive non-CTA frames — three 2 s
windows out of one 6 s Hailuo clip. Consecutive non-CTA frames are grouped; a
CTA frame closes the group. Each group gets one keyframe (prompt: the group's
first frame plus the product-scale clause) and one clip whose prompt is the
group's `videoPrompt`s written as a single continuous two/three-beat phrase,
≤ 90 words, ending with the product-lock clause. The V job carries
`settings.coversFrames` and `settings.frameOffsetsSec`, which is how
`assemble.py` knows to cut window *i* from clip time
`[i·frameSeconds, +window length]`.

This is the cut-density rule from
`.claude/skills/design-video-ad-libtv/reference/shot-design.md`: a 15 s ad needs
~14 visible cuts but only 8–12 generated clips, so two or three shots come out
of each clip.

**Full.** One keyframe and one clip per non-CTA frame — the pre-economy graph.
Only worth it when every 2 s window needs its own camera setup.

### Credits (Seedream 5.0 Pro 14 + Hailuo 2.3 Fast 6 s 24)

| Board | Non-CTA frames | Economy | Full |
|---|---|---|---|
| 15 s, 8 frames (7–8 CTA) | 6 → 2 groups | 2×14 + 2×24 = **76** | 6×14 + 6×24 = 228 |
| 10 s, 5 frames (5 CTA) | 4 → 2 groups | 2×14 + 2×24 = **76** | 4×14 + 4×24 = 152 |

The second 10 s group holds a single frame and still costs a whole clip — that
is the rounding to watch when trimming a board.

Two 15 s ads therefore cost 152 credits in economy mode against 456 in full.

## 3. Approve

**Approve** moves the run to `approved`, which is the only status a worker will
claim. It is blocked if the brand kit is not studio-ready (packshots, logo,
CTAs, landing URL, product summary, claims, SKU dimensions in cm) — the response
lists what is missing.

Set a credit cap at approval. Default sizing in economy mode: a 15 s / 8-frame
board is 2 keyframes (28) + 2 clips (48) = 76 credits with Seedream 5.0 Pro +
Hailuo 2.3 Fast. The cap cannot be below the estimate.

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

- 1080×1920 @ 30 fps, libx264 crf 19, silent (`-an`) unless `LIBTV_MUSIC_FILE`
  supplies a bed
- each 2 s window cut from its clip at the offset the compiler recorded in
  `frameOffsetsSec` (economy) or from the head of its own clip (full); the last
  window may be shorter than the grid
- CTA cards composited from `refs/PROD-1` on a brand-colour plate with the CTA
  and offer lines; the **final** CTA window is the logo end card from `refs/LOGO`
- `textOverlay` captions burned inside the safe zones (top 14 % / bottom 20 %
  clear); `--no-captions` turns them off, `--brand-color "#RRGGBB"` sets the plate
- boundaries snapped to an `aubio` beat grid when `LIBTV_MUSIC_FILE` is set
- exports `final/master.mp4`, `final/preview-720p.mp4`, `final/contact-sheet.jpg`

Prove the timeline before spending anything:

```bash
bash workers/libtv-worker/test-assemble.sh
```

It synthesises two 6 s colour-bar clips and a fake packshot, assembles the
economy fixture, and checks with `ffprobe` that the master is 15.00 s ±0.1 s at
1080×1920.

All three outputs are uploaded and appear in Studio as **Download master**,
preview and contact sheet, and are included in the project's `/export` zip
alongside every per-frame keyframe URL.

### When there is no cloud storage

With neither `CLOUDINARY_URL` nor `BLOB_READ_WRITE_TOKEN` the worker used to
report `file://` paths, which a browser cannot load. It now publishes

```
${APP_URL}/api/local-files/<runId>/<relative path>
```

e.g. `…/api/local-files/<runId>/final/preview-720p.mp4`, and keeps `localPath`
alongside. `/api/local-files` streams from `LOCAL_FILES_ROOT` (default
`~/Projects/libtv-ad-studio/runs`) with a path-traversal guard, `Range` support
for video, and 404 for anything that is not mp4/jpg/png. It is active only when
`LOCAL_FILES_ROOT` is set or `NODE_ENV !== "production"`, so this is a
local-operator path: on Vercel, set a storage provider instead.

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
| Node result URLs start with `file://` | output landed outside `LIBTV_RUNS_DIR` and no storage provider is configured | set `CLOUDINARY_URL` or `BLOB_READ_WRITE_TOKEN`, or point `LOCAL_FILES_ROOT` at the runs directory |
| `/api/local-files/...` 404s in production | the route is disabled unless `LOCAL_FILES_ROOT` is set | set it, or configure cloud storage (preferred on Vercel) |
| Compile answers 409 "over the ceiling" | estimate above `LIBTV_MAX_RUN_CREDITS` | switch to economy mode, trim the board, or tick "compile anyway" |
| One clip reads as three jump cuts | the grouped prompt described three separate shots | the group prompt must be one continuous take; rewrite the frames' `videoPrompt`s as one move |
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
