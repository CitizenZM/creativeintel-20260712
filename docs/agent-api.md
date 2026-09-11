# Driving CreativeIntel from an agent

Every stage is reachable over HTTP so a local Claude session (or any script) can run the whole pipeline headlessly. All routes live under `/api/projects/[projectId]/…` unless noted. Send `Idempotency-Key: <uuid>` on POSTs marked *idempotent* to make retries safe. When the app runs behind Vercel Deployment Protection, add `x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET`.

## Stage status

| Method | Route | Returns |
|---|---|---|
| GET | `/stages` | `{ brandKitScore, stages: [{id, label, href, state: done|partial|todo, detail}], next }` |

Poll this between steps to decide what to do next.

## 1 · Setup

| Method | Route | Body / notes |
|---|---|---|
| POST | `/api/projects` | `{ brandName, brandUrl?, productUrl?, productName?, category?, campaignGoal?, briefingText?, competitors: [{name, url?}] }` → project + `scrapeResult { ok, adapter, error, attempts }` |
| GET/PUT | `/brand-kit` | PUT any of `colorsHex[{name,hex,usage}]`, `fonts`, `ctaOptions[{text,priority}]`, `offerText`, `landingUrl`, `claimsAllowed[]`, `claimsForbidden[]`, `toneGuidelines`, `doNotShow[]`, `skuName`, `skuDimensionsCm{height,width,depth,weightG}`, `productSummary` → kit + `completeness { score, missing, ready:{creative,studio} }` |
| POST | `/brand-kit/assets` | multipart: `file`, `kind` (LOGO\|PACKSHOT\|LIFESTYLE\|FONT\|OTHER), `variant?` (light\|dark\|front\|side\|in-hand\|transparent), `caption?` |
| DELETE | `/brand-kit/assets/[assetId]` | — |
| PATCH | `/product` | `{ productUrl, mode: "preview" }` returns scraped data without writing; `mode: "commit"` writes |
| GET/POST/PATCH | `/campaign-selection` | platform (`tiktok|instagram|youtube|tvc|amazon`), `totalDurationSec`, environment/actor/selling points; `PATCH {action:"confirm"}` |

Studio refuses to compile a run until the brand kit has ≥1 PACKSHOT and `ready.studio` is true.

## 2 · Research

| Method | Route | Notes |
|---|---|---|
| POST | `/research` | *idempotent* — 202 `{ jobId, status }` |
| GET | `/research/status?jobId=` | `{ status, progress, currentStep, steps[], sources: [{name, status: ran|skipped_no_key|failed|pending_worker, count, note}] }` |
| GET | `/content?sort=&filter=` | ranked ad candidates; Top-N per owner via `rankInOwner`, `isPaidMedia`, `adSource`, `adEvidence`, `durationSec`, `aspectRatio` |
| POST | `/content/search-more` | honours the campaign platform |

Browser-only sources (Meta / TikTok / Google ad libraries) become `WorkerTask` rows executed by `workers/research-worker`; their status shows as `pending_worker` until the worker reports.

## 3 · Insights

| Method | Route | Notes |
|---|---|---|
| GET | `/insights` | `{ insights (grouped by competitorId), rollups, teardowns }` |
| POST | `/insights/continue` | runs the next pipeline stage; repeat until `{ done: true }` |
| POST | `/insights/reanalyze` | re-runs the same stages |
| GET | `/competitors/[competitorId]` | competitor + Top-N assets with `AdTeardown` + `CompetitorRollup` |

## 4 · Creative

| Method | Route | Body |
|---|---|---|
| POST | `/creative/angles` | `{}` → 10 angles, each with `videoType` + candidate `templateIds` |
| POST | `/creative/scripts` | *idempotent* `{ angle?, templateId?, videoType?, totalDurationSec? }` |
| POST | `/creative/scripts-batch` | *idempotent* `{ templateIds?: string[], count?: 1–20 (default 10), angles?, videoType?, totalDurationSec? }` → `{ scripts, requested, failures[] }` |
| GET | `/creative/scripts` | scripts with `videoType`, `template`, `hook`, `bodyBeats`, `cta`, `scenes`, rendered `body` |
| POST | `/creative/storyboards` | *idempotent* `{ scriptId }` → storyboard with `frames: GridFrame[]` (2 s, `segment: HOOK|BODY|CTA`, `imagePrompt`, `videoPrompt`, shot/camera/product/text/VO/sfx/sellingPoint/howExpressed) |
| POST | `/creative/storyboards-batch` | *idempotent* `{ scriptIds }` |
| PATCH | `/creative/storyboards/[id]/frames` | `{ frameNumber, ...contentFields }` (grid fields are read-only) |
| POST | `/creative/test-matrix` | *idempotent* — templates × videoType |

Template registry: `GET` is not needed — ids are in `src/services/ai/prompts/script-templates.ts` (20 archetypes across PRODUCT_INTRO / PROMO_OFFER / AWARENESS_INTEREST).

## 5 · Studio (LibTV)

| Method | Route | Notes |
|---|---|---|
| POST | `/studio/libtv-runs` | `{ storyboardId, imageModel?, videoModel?, clipDurationSec? }` → run in `awaiting_approval` with per-node jobs and `creditsEstimated`; 409 with `missing[]` when the brand kit is incomplete |
| GET | `/studio/libtv-runs` / `/studio/libtv-runs/[runId]` | runs + jobs (status, resultUrl, credits) |
| POST | `/studio/libtv-runs/[runId]/approve` | `{ creditCap? }` — the local `libtv-worker` only claims approved runs |
| POST | `/studio/libtv-runs/[runId]/cancel` | — |

The worker binds a LibTV canvas, uploads packshots, generates `K<n>` keyframes and `V<n>` clips per storyboard frame, downloads them, assembles the master locally and reports `masterMp4Url`, `previewMp4Url`, `contactSheetUrl`, `canvasUrl`.

## 6 · Deliver

| Method | Route | Notes |
|---|---|---|
| GET | `/export` | zip with scripts, storyboards, keyframe URLs and finished master/preview URLs |

## Worker endpoints (token-authenticated, `x-worker-token`)

- `POST /api/worker/tasks` — `claim | complete | fail | heartbeat` for `WorkerTask`
- `POST /api/worker/libtv` — `claim | job_started | job_done | job_failed | run_done | run_failed | heartbeat` for `LibtvRun`
