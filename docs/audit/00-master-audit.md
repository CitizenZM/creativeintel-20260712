# CreativeIntel — Multi-model Audit & Rebuild Plan

Date: 2026-09-11 · Branch: `feat/v2-audit-rebuild` · Repo: `CitizenZM/creativeintel-20260712`

Models used: Claude Opus (research, insights, scripts, studio), Claude Sonnet (intake, UI/UX), OpenAI Codex `gpt-5.6-sol` (independent architecture review). Detail reports: `01`–`06` and `codex-architecture-audit.md` in this folder. Every claim below was cross-checked against the live production database (Neon) and the production Vercel environment.

## 现状 (Situation)

| Signal | Value |
|---|---|
| Production content assets | 241 — **100 % YouTube** (225 long-form, 14 Shorts). 0 TikTok, 0 Instagram, 0 Meta/Google ads. 0 rows with `isPaidMedia = true` |
| Scripts | 45 — formats `short_form` 30, `tvc` 10, `long_form` 3, `ugc` 2; no video type, no template |
| Storyboards | 39 — 3 s cadence, ≤10 frames, no HOOK/BODY/CTA tag |
| Studio jobs | `FalVideoJob` 50 (fal/Veo API), `BrowserGenJob` 0 (local worker never used), `DiscoveredVideo` 0 (corpus never written) |
| Production env | `OPENAI_API_KEY`, `FAL_KEY`, `GOOGLE_API_KEY` present. **Missing:** `YOUTUBE_API_KEY`, `META_ACCESS_TOKEN`, `CLOUDINARY_*`, `GROQ_API_KEY`, `BROWSER_WORKER_TOKEN`, `CRON_SECRET` |
| Type-check baseline | `tsc --noEmit` clean |

## 问题 (Root causes) — all seven reviewers converge

### 1. Research / scraping (why the wrong videos come back)
- **Platform bug:** `short_social` strategy (TikTok/Instagram campaigns) only searches YouTube Shorts + Vimeo, then the platform filter removes 100 % of results (`video-search.ts:51-57,406`). TikTok/IG never searched.
- **No duration/aspect anywhere:** `VideoResult` has no `durationSec`; YouTube API path discards the Shorts filter (`youtube-service.ts:44-53`).
- **No ad-vs-UGC gate:** ad-intent is a 0.1-weight regex; verifier asks "relevant brand content" (a review passes); `contentCategory` is a badge, never a filter (`video-relevance.ts:70,156`).
- **No paid sources in production:** Meta Ad Library needs a token that is not set and is queried for the brand only; TikTok Creative Center pulls a brand-agnostic `for_you` feed; Google Ads Transparency does not exist.
- **Per-competitor Top-N destroyed:** `analysis-pipeline.ts:216` slices the first 10 of a brand-first list — competitors 2+ get zero assets.

### 2. Insights (why competitor analysis is thin)
- Competitor prompt sees only the competitor **homepage text**, never an ad (`competitor-intel.ts:40-54`).
- **Zero vision** — thumbnails are described in prose; every "first-3-seconds visual" is invented.
- No per-ad teardown, no per-competitor rollup; `Insight` has no `competitorId`.
- **Data corruption:** `content/[assetId]/script/route.ts:63` overwrites real transcripts with LLM-reconstructed text.
- "Claude client" actually calls GPT-4o; UI mislabels the model.

### 3. Scripts & storyboards
- Only 3 scripts per run (`scripts-batch/route.ts:89`); batch path drops duration, platform, scenes, actor, environment — the default pipeline yields scripts with null scenes.
- No `videoType`, no template taxonomy; body is unlabeled prose; hook/CTA variants never bound to the body; no selling-point → shot mapping.
- Storyboard grid is 3 s with a 10-frame cap (60 s ads lose 30 s); frames carry no segment, shot type, product action or video prompt.

### 4. Create Studio
- Two competing studio pages + a third import pipeline; four API routes (`generate-shots`, `generate-from-script`, `assemble`, `browser-jobs`) have no UI entry.
- Local-worker pattern exists (claim/lease/heartbeat) but depends on the retired `browser-harness`, has a double attempt-increment bug, one result slot, no cost gate. **No LibTV integration anywhere.**
- Assembly, transcription and worker auth are dead in production (missing keys).

### 5. Brand / product intake
- **No logo or CTA fields, endpoints or UI exist.** Cloudinary is only used for render.
- Product images are base64 inside a Postgres JSON column; scrape failures are swallowed at creation; no Shopify/Amazon adapters; no confirm step; SSRF on arbitrary URLs.

### Structural (Codex)
- `prisma db push --accept-data-loss` runs on every production build.
- No authentication on any project route.
- Long work launched via `waitUntil` inside 60 s functions — not a durable queue.

## 解决方案 (Target architecture)

```
Setup ─▶ Research ─▶ Insights ─▶ Creative ─▶ Studio ─▶ Deliver
 Brand Kit   AdCandidate   AdTeardown   20 templates   LibtvRun     MP4 + canvas link
 (logo,      adapters:     per top ad   videoType      LibtvJob     Cloudinary/blob
  packshots, Meta/TikTok/  Competitor   hook/body/cta  local worker export zip
  CTA, SKU)  YT/Google/IG  Rollup       2 s frames     libtv CLI
```

**Brand truth (must exist before any generation):** logo (light+dark PNG/SVG), ≥2 packshots (front + side, transparent), SKU name + physical dimensions (cm), brand colours (hex), fonts, approved CTA pool, offer, landing URL, allowed/forbidden claims, tone, do-not-show list, canonical product paragraph. Stored in `BrandKit` + `BrandAsset`; a completeness score gates Creative and Studio.

**Research:** platform-driven adapter dispatch → unified `AdCandidate` (source, platform, format, durationSec, aspect, isPaidAd + evidence, advertiser, adLibraryId, firstSeen/lastSeen, landingUrl). Hard gates: paid-ad evidence or classifier ≥ 0.75 → UGC lexicon reject → format gate (≤60 s & 9:16 for short) → platform gate → performance floor. Rank = 0.30 views + 0.25 longevity + 0.20 engagement + 0.15 recency + 0.10 creative score, partitioned per competitor, Top-5/10. Meta/Google/TikTok ad libraries are browser-only for video URLs → local worker playbooks.

**Insights:** three prompt tiers — per-ad multimodal teardown (keyframes + timestamped transcript) → per-competitor rollup → cross-competitor gap → competitor-linked Insights. Deep tier only for Top-N.

**Creative:** 20-template registry (`script-templates.ts`) across PRODUCT_INTRO / PROMO_OFFER / AWARENESS_INTEREST; structured Script `{videoType, template, hook{}, bodyBeats[{sellingPoint, howExpressed, shot}], cta{}}`; storyboard at 2 s cadence, segment derived from template beat split (`storyboard-grid.ts`), each frame with shotType / cameraMove / productAction / textOverlay / VO / sfx / imagePrompt / videoPrompt.

**Studio → LibTV:** `LibtvRun` (canvas binding, models, credit estimate, approval gate, master MP4) + `LibtvJob` per node (upload / K<n> image / V<n> video). Local `workers/libtv-worker` claims approved runs over HTTPS, executes `libtv project create/use → upload → node create -t image --run → node create -t video --run → download`, assembles locally, uploads the master, reports per-node status. Dashboard shows the 2 s timeline with per-frame keyframe/clip status, credits, **Open in LibTV**, **Download MP4**. Skill `design-video-ad-libtv` is vendored into `.claude/skills/` so the local agent can run the same playbook.

## Phases (this branch)

| # | Phase | Status |
|---|---|---|
| 0 | Audit, local DB clone, env isolation, safety (`--accept-data-loss` removed) | done |
| 1 | Foundation: schema (BrandKit/BrandAsset, AdTeardown/CompetitorRollup, LibtvRun/LibtvJob, ContentAsset ad fields, Script v2 fields), template registry, 2 s grid | in progress |
| 2 | Brand Kit intake + product URL adapters + confirm step + completeness gate | queued |
| 3 | Research rebuild (adapters, gates, ranking, per-competitor Top-N, worker ad-library playbook) | queued |
| 4 | Insights rebuild (teardown, rollup, gap, transcript-overwrite fix, competitor page) | queued |
| 5 | Creative rebuild (templates → scripts → 2 s storyboards, UI badges, template picker) | queued |
| 6 | Studio → LibTV (runs, jobs, worker endpoint, local worker, studio UI merge, export MP4) | queued |
| 7 | Dashboard IA (6-stage rail, completeness chip, idempotency, dark mode, mobile nav) | queued |
| 8 | QC: typecheck, build, browser walk-through, worker dry-run against LibTV | queued |

## 需要你做的决策 (Decisions for Barron)

1. **Object storage for brand assets & masters** — no Cloudinary/Blob credentials exist anywhere. Options: (a) Cloudinary free tier (already a dependency; signed browser upload), (b) Vercel Blob (one env var, simplest on Vercel), (c) Supabase Storage (your default stack). Code ships with a provider interface defaulting to Cloudinary; set the keys and it works.
2. **Ad-library access** — Meta `ads_archive` API returns commercial ads only with approved access; TikTok Ad Library and Google Ads Transparency have no API. The local worker (ego-browser) is the reliable path. Confirm you accept browser scraping for these three.
3. **Credit cap per LibTV run** — default gate is "await approval" with an estimate; set a default cap (e.g. 300 credits ≈ 8 keyframes + 8 clips).
4. **Auth** — routes are open. Minimal fix is a shared bearer token + Vercel deployment protection; full fix is Clerk/Supabase auth. Which?
5. **YouTube Data API key** — production has none; Shorts filtering needs it. Provide one or accept scrape-only.
