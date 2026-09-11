# libtv-worker

Local Mac worker for Create Studio's LibTV runs. It claims an **approved**
`LibtvRun` from the deployed app over HTTPS, binds a canvas, walks the node
graph with the `libtv` CLI, downloads every keyframe and clip, assembles the cut
locally with `assemble.py`, and reports per-node status back.

It runs locally because the `libtv` CLI authenticates against the operator's
browser session — there is no server-side API key. The database is never
touched from this machine; the only credential here is `WORKER_TOKEN`.

## Prerequisites

| Thing | Check |
|---|---|
| `libtv` CLI, logged in | `~/.libtv/libtv account` |
| Python 3 with Pillow | `python3 -c "import PIL"` |
| ffmpeg | `ffmpeg -version` |
| `aubio` (optional, beat grid) | `aubio --help` |

## Environment

```bash
export APP_URL="https://creativeintel.vercel.app"
export WORKER_TOKEN="<same value as the app's WORKER_TOKEN>"
# Deployment Protection (SSO) is enabled on the Vercel project — required:
export VERCEL_AUTOMATION_BYPASS_SECRET="<Vercel → Settings → Deployment Protection → Protection Bypass for Automation>"

# optional
export LIBTV_BIN="$HOME/.libtv/libtv"
export LIBTV_RUNS_DIR="$HOME/Projects/libtv-ad-studio/runs"
export POLL_INTERVAL_MS=20000
export CLOUDINARY_URL="cloudinary://key:secret@cloud"   # or BLOB_READ_WRITE_TOKEN
export LIBTV_MUSIC_FILE="$HOME/Music/track-15s.m4a"     # enables the aubio beat grid
```

With neither `CLOUDINARY_URL` nor `BLOB_READ_WRITE_TOKEN` set the worker still
finishes the run and publishes results as
`${APP_URL}/api/local-files/<runId>/<relative path>` (keeping `localPath`
alongside), so the dashboard can still play the cut. The app serves those from
`LOCAL_FILES_ROOT`, which must point at the same directory as `LIBTV_RUNS_DIR`:

```bash
export LOCAL_FILES_ROOT="$LIBTV_RUNS_DIR"   # app side, local dev only
```

That route is disabled in production unless `LOCAL_FILES_ROOT` is set, so a
deployed worker still wants a real storage provider.

## Running

```bash
# from the repo root
npm run worker:libtv

# rehearse the whole graph without spending a credit or touching the network
node workers/libtv-worker/worker.mjs --dry-run --fixture

# prove the assembly timeline against synthetic clips (no network, no credits)
bash workers/libtv-worker/test-assemble.sh

# one run, then exit (useful under launchd with a short interval)
node workers/libtv-worker/worker.mjs --once
```

`--fixture` reads `fixtures/run.json` (or `--fixture=/path/to/run.json`) instead
of claiming, and prints what it *would* report rather than calling the API. The
bundled fixture is an economy-mode 15 s board: 8 frames, two clip groups, 76
credits.

`test-assemble.sh` builds a throwaway run directory with two 6-second
`testsrc2` clips and a generated packshot, runs `assemble.py` over it, and
asserts with `ffprobe` that the master is 15.00 s ±0.1 s at 1080×1920 and the
preview 720×1280. `KEEP=1` leaves the directory behind for inspection.

## Where files land

```
$LIBTV_RUNS_DIR/<runId>/
  run.json            the claimed payload
  canvas.json         { uuid, name } when the worker created the canvas
  manifest.json       one entry per executed node, plus clips[] (coversFrames,
                      frameOffsetsSec, localPath) — the map assemble.py cuts from
  refs/               PROD-1…, LOGO — downloaded brand assets
  keyframes/          K<n> images from LibTV
  clips/              V<n> clips from LibTV
  final/master.mp4    1080x1920 @30fps
  final/preview-720p.mp4
  final/contact-sheet.jpg
```

## Token expiry

`接口错误 [10001]: 用户未授权` means the LibTV token died mid-session. The worker
reports `run_failed` with `needsLogin: true` (the dashboard shows a "needs libtv
login" banner) and exits with code 2 rather than burning retries. Recover with:

```bash
~/.libtv/libtv login web     # open the printed URL in the logged-in browser
npm run worker:libtv
```

## launchd

`~/Library/LaunchAgents/com.creativeintel.libtv-worker.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>              <string>com.creativeintel.libtv-worker</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/Users/xiaozuo/Projects/creativeintel-20260712/workers/libtv-worker/worker.mjs</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>APP_URL</key>          <string>https://creativeintel.vercel.app</string>
    <key>WORKER_TOKEN</key>     <string>REPLACE_ME</string>
    <key>LIBTV_RUNS_DIR</key>   <string>/Users/xiaozuo/Projects/libtv-ad-studio/runs</string>
    <key>PATH</key>             <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key>          <true/>
  <key>KeepAlive</key>          <true/>
  <key>StandardOutPath</key>    <string>/tmp/libtv-worker.out.log</string>
  <key>StandardErrorPath</key>  <string>/tmp/libtv-worker.err.log</string>
</dict>
</plist>
```

```bash
launchctl load  ~/Library/LaunchAgents/com.creativeintel.libtv-worker.plist
launchctl list | grep libtv-worker
launchctl unload ~/Library/LaunchAgents/com.creativeintel.libtv-worker.plist
```

`PATH` must include the directory holding `ffmpeg` and `python3` — launchd does
not read your shell profile. `KeepAlive` restarts the worker after a login
expiry exit; remove it if you would rather re-login by hand.

## Node graph

Nodes execute uploads → every `K<n>` → every `V<n>`, where `<n>` is the first
frame of a clip group (in economy mode one group is up to three 2-second frames):

```
PROD-1      libtv upload "PROD-1" --file refs/PROD-1.png
K<n>        libtv node create "K<n>" -t image --left "PROD-1" --prompt "…" \
              -s "model=Seedream 5.0 Pro" -s modeType=image2image \
              -s ratio=9:16 -s quality=2K -s count=1 --run
V<n>        libtv node create "V<n>" -t video --left "K<n>" --prompt "…" \
              -s "model=Hailuo 2.3 Fast" -s modeType=singleImage2video \
              -s duration=6 -s resolution=1080P --run
            libtv download -n "V<n>" -o clips/ --without-ai-watermark --vip
```

`--run` blocks until the task is terminal and is never backgrounded or wrapped in
a timeout shorter than the model's own runtime. CTA frames carry
`settings.compositeLocally` and never reach LibTV — their cards come out of
`assemble.py`, because video models garble type and drift on packaging.

`coversFrames`, `frameOffsetsSec`, `frameSeconds`, `budgetMode`, `frameNumber`,
`segment` and `compositeLocally` are compiler bookkeeping for assembly: the
worker strips them before building the `-s` pairs, since the CLI rejects
settings the model does not declare.
