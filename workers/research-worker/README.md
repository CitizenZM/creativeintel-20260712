# research-worker

Local Mac daemon that resolves the research pipeline's browser-only ad sources.

Vercel cannot fetch the public ad libraries (Meta blocks datacentre IPs, TikTok's
Commercial Content Library is region-gated and renders client-side, Google's
Transparency Center resolves advertisers only through an SPA search box). So the
research runner enqueues a `WorkerTask` row instead, and this daemon — running on
the operator's own machine, behind the operator's own residential IP — claims it,
drives **ego-browser (ego-lite)**, and posts the results back over HTTPS.

The worker never touches the database. It only calls
`POST {APP_URL}/api/worker/tasks`, authenticated with the `x-worker-token`
header.

## What it does

1. `claim` — takes the oldest queued `ad_library_fetch` task.
2. Dispatches on `payload.source`:
   - `meta` → `playbooks/meta-ad-library.mjs`
   - `tiktok` → `playbooks/tiktok-ad-library.mjs`
   - `google` → `playbooks/google-ads-transparency.mjs`
3. Each playbook runs an `ego-browser nodejs` script that navigates the public
   site, extracts ad id / advertiser / dates / landing URL / video URL, and
   prints one `__RESULT__<json>` line.
4. `complete` — posts `{ candidates: AdCandidate[] }`. The server validates every
   field, ranks the candidates, and upserts `ContentAsset` rows for the project.

Failures are reported with `fail`; the task returns to `queued` until it has been
attempted 3 times.

## Task shapes

Payload (written by `src/services/research/adapters/browser-adapters.ts`):

```json
{
  "source": "meta" | "tiktok" | "google",
  "advertiser": "Acme Corp",
  "competitorId": "clxyz..." ,
  "countries": ["US"],
  "mediaType": "video",
  "limit": 20,
  "hash": "<sha1 of the fields above>"
}
```

Result:

```json
{ "candidates": [ /* AdCandidate[] — see src/services/research/ad-candidate.ts */ ] }
```

A completed task is reused for 7 days: a later research run with the same payload
hash reads its candidates back instead of re-queueing the work.

## Requirements

- **ego-browser (ego-lite)** installed and on `PATH` (`ego-browser --version`).
  This worker uses only the documented TaskSpace/Page API — it is not Playwright.
- Node 20+.
- No logins. All three sites are public; the playbooks never authenticate and
  never attempt a CAPTCHA. If a site presents one, the task fails with that note.

The worker keeps **one** ego-browser task space for its whole lifetime, stored in
`~/.creativeintel-research-worker/space.json`, per the ego-browser skill's
one-space-per-goal rule. Delete that file to start a fresh space.

## Environment

| Variable | Default | Notes |
|---|---|---|
| `APP_URL` | `https://creativeintel.vercel.app` | Deployed app base URL |
| `WORKER_TOKEN` | — | **Required.** Must equal the app's `WORKER_TOKEN` env var |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | — | **Required against the Vercel deployment.** Deployment Protection (SSO) is on; the worker sends it as `x-vercel-protection-bypass`. Create it in Vercel → Settings → Deployment Protection → Protection Bypass for Automation |
| `WORKER_KINDS` | `ad_library_fetch` | Comma-separated task kinds to claim |
| `POLL_INTERVAL_MS` | `30000` | Idle delay between claim attempts |
| `TASK_COOLDOWN_MS` | `15000` | Pause between tasks, so a queue burst is not a crawl |
| `EGO_BROWSER_BIN` | `ego-browser` | Override if the CLI is not on `PATH` |

## Run

```bash
cd workers/research-worker
APP_URL=https://creativeintel.vercel.app \
WORKER_TOKEN=<same value as the app env> \
node worker.mjs
```

## launchd (keep it running)

`run.sh` reads `WORKER_TOKEN` from the login Keychain, so the secret never sits
in the plist or the repo. Store it once:

```bash
security add-generic-password -a creativeintel -s creativeintel-worker-token -w '<token>' -U
```

Then point `~/Library/LaunchAgents/com.creativeintel.research-worker.plist` at
`/bin/bash <repo>/workers/research-worker/run.sh` (with `RunAtLoad`, `KeepAlive`,
`APP_URL=https://creativeintel.vercel.app`, and a `PATH` that includes
`~/.local/bin` for ego-browser) and load it:

```bash
launchctl load  ~/Library/LaunchAgents/com.creativeintel.research-worker.plist
tail -f /tmp/creativeintel-research-worker.log

# to stop
launchctl unload ~/Library/LaunchAgents/com.creativeintel.research-worker.plist
```

Use `https://creativeintel.vercel.app`, not `creative.xark.io`: Cloudflare Access
sits in front of the custom domain and would redirect the worker to a login page.
The app's middleware lets `/api/worker/*` through on the Vercel domain, where the
worker authenticates with its token.

`PATH` must include the directory holding `ego-browser` — launchd does not read
your shell profile.

## Site notes (probed live 2026-09-10)

**Meta Ad Library** — the richest of the three. Class names are obfuscated and
rotate per deploy, so the playbook anchors on the literal `Library ID: <digits>`
text node and climbs to the results grid. The `<video>` element is on the card
itself: `video.currentSrc` is a directly fetchable fbcdn mp4 and `video.poster`
is the thumbnail — no click into a snapshot view. The one genuinely fragile field
is the publisher-platform row, which is rendered as CSS sprite `mask-position`
offsets with no text or aria-label; the playbook infers Facebook vs Instagram
from the CTA link instead. A keyword search also returns ads that merely *mention*
the brand, so results are filtered against the requested advertiser name.

**TikTok Commercial Content Library** — reachable without a login, but URL
parameters do not hydrate the controls: `?query=`/`?adv_name=` are ignored and
the query has to be typed. The site's own `POST /api/v1/search` is the robust
integration point and the playbook tries it first. **During the probe every
query returned "Total ads: 0" from a non-US egress** (the page's analytics
reported the browser geo as CN). If this playbook keeps returning zero, verify
the machine's egress region before concluding the selectors broke — the API body
shape could not be confirmed because no result ever rendered.

**Google Ads Transparency Center** — `?query=` is ignored; the advertiser must be
typed into the search box to resolve its `AR…` id, after which
`/advertiser/<AR>?region=US&format=VIDEO` is directly addressable with clean
Angular selectors (`creative-preview`, `a[aria-label^="Advertisement ("]`,
`.advertiser-name`). There is **no `<video>` element anywhere** — creatives render
inside `tpc.googlesyndication.com` safeframes, so the practical video handle is
the YouTube id in the card thumbnail (`i.ytimg.com/vi/<ID>/…`). Dates live only
on the creative detail page, so the playbook visits at most 10 of them, paced.
A `google-hats-survey` iframe can overlay the page and swallow clicks, which is
why filters are applied by URL rather than by clicking.
