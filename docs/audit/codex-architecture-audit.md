# CreativeIntel Independent Architecture Audit

## A. Architecture verdict

**Verdict: promising prototype, not a dependable production pipeline.** The UI and prompt work are ahead of the ingestion, orchestration, and artifact infrastructure. Current results can look authoritative while being inferred from weak or irrelevant evidence.

### Keep

- Prisma’s basic project → competitor → asset relationships and source flags.
- Zod validation around LLM output.
- The model registry/prompt compiler in `src/services/video-gen/*`.
- The browser queue’s conditional claim and lease concept (`src/services/video-gen/browser-queue.ts:62-119`).
- Separate raw-source metadata from AI-derived analysis.

### Rip out or consolidate

- Treat generic DuckDuckGo/YouTube search as discovery fallback, never as the paid-ad corpus.
- Replace `RenderJob`, `FalVideoJob`, and `BrowserGenJob` with one typed job/task/artifact system. Their string statuses and duplicated provider semantics are already diverging (`prisma/schema.prisma:431-486`, `654-685`).
- Retire browser-harness, MoneyPrinter, FAL/Veo submission, and Cloudinary assembly paths once LibTV covers production. Today Studio exposes several incompatible execution systems.
- Stop storing core domain structures—shots, frames, products, analyses—as unversioned JSON.

### Largest structural risks

1. **Wrong compute boundary.** Vercel handlers launch long research/render work through `waitUntil` (`api/.../research/route.ts:49-56`, `api/.../video/generate/route.ts:33-35`). That is not a durable queue, and local binaries/files cannot survive across serverless instances. The file endpoint explicitly admits outputs may disappear (`api/.../video/jobs/[jobId]/file/route.ts:21-45`).
2. **False-success orchestration.** Analysis stages catch and log almost every failure (`analysis-pipeline.ts:125-209`, `213-315`, `326-353`, `404-567`); the outer runner then marks the project `ANALYZED` (`research/runner.ts:322-337`).
3. **Schema sprawl.** `BrandProfile` duplicates `Brand`; `CompetitorProfile` duplicates `Competitor`; product truth is split across `Project`, `Brand`, and `CampaignSelection` (`schema.prisma:62-117`, `145-225`, `551-588`).
4. **Unsafe deployment workflow.** The production build runs `prisma db push --accept-data-loss` (`package.json:5-10`), while the sole migration does not contain many current models. Deployment can mutate or destroy schema without reviewed migrations.

## B. Root causes of the five failures

### 1. Bad competitor-ad sourcing

- The short-social branch claims TikTok support but searches only YouTube Shorts and Vimeo (`video-search.ts:51-57`). TikTok campaigns then permit only TikTok/Instagram (`campaign-platform.ts:27-41`), so filtering drops everything found (`video-search.ts:393-407`).
- Retry queries deliberately introduce `review` and `unboxing` (`video-search.ts:344-358`). The relevance scorer gives only a small bonus for ad words and does not reject reviews or organic UGC (`video-relevance.ts:25-72`).
- Selection asks for six items, not configurable Top-5/Top-10 per competitor (`research/runner.ts:129-139`).
- `VideoResult` has no duration, dimensions, aspect ratio, advertiser identity, ad ID, or sponsorship evidence (`video-search.ts:15-29`); vertical/short/paid requirements therefore cannot be enforced.
- TikTok paid discovery is generic region/category “for you,” not brand or competitor scoped (`tiktok-creative-center.ts:31-55`; `research/runner.ts:169-175`).
- Meta searches only the owner’s brand, not each competitor (`research/runner.ts:244-249`). With no `META_ACCESS_TOKEN`, it always skips (`meta-ads.ts:224-228`).
- With no `YOUTUBE_API_KEY`, YouTube falls back to brittle HTML extraction with estimated/zero engagement (`youtube-service.ts:42-58`, `176-215`, `262-275`).
- There is no Google Ads Transparency adapter anywhere in the requested code.

**Bottom line:** production currently has no reliable paid-ad source. The TikTok endpoint may return generic ads; Meta is disabled; Google is absent; YouTube is scraped search results.

### 2. Thin competitor insight

- Competitor intelligence analyzes website copy only (`prompts/competitor-intel.ts:9-28`, `40-54`), not competitor videos.
- Per-video scoring returns one hook, scalar scores, key messages, and a short generic analysis (`prompts/content-scoring.ts:31-71`). That `analysis` string is never persisted in the `ContentAsset` write (`analysis-pipeline.ts:278-312`).
- Non-YouTube assets receive thumbnail-only evidence (`video-signal.ts:72-76`), and thumbnails are merely mentioned in text—no vision request is made (`analysis-pipeline.ts:242-248`).
- Paid TikTok/Meta rows are saved after the search corpus is constructed and are never added to `allVideos`; they bypass scoring and teardown (`research/runner.ts:158-167`, `169-313`, `317-330`).
- Deep analysis aggregates the project’s top eight assets (`analysis-pipeline.ts:520-536`) instead of producing a durable per-ad hook/offer/proof/objection/CTA/conversion record.

### 3. Simplistic scripts and storyboards

- The taxonomy contains only ten broad narrative labels (`schema.prisma:37-48`), not 15–20 production archetypes. No `videoType` exists on `Script` (`schema.prisma:362-383`).
- “Generate scripts” is hard-capped to the top three angles (`scripts-batch/route.ts:88-90`).
- Worse, the batch route’s schema omits scenes, platform, duration, product context, actor/environment, and storyboard timeline, then persists no shots (`scripts-batch/route.ts:10-22`, `91-126`). It is materially weaker than the single-script route.
- Shots include `productAction`, but there is no structured link from a shot to the selling point, proof, objection, or conversion purpose it expresses (`creative/scripts/route.ts:22-38`; `schema.prisma:379-380`).
- Storyboards are explicitly fixed to one frame per **three** seconds (`prompts/storyboard.ts:27-42`; `storyboard-grid.ts:1-24`), capped at ten frames. Frames have no enforced `HOOK|BODY|CTA` phase field (`storyboard-grid.ts:122-133`).

### 4. Studio disconnected from LibTV production

- There is no `libtv` reference or dependency in the repository.
- Studio calls FAL/Veo endpoints directly (`projects/.../studio/page.tsx:179-259`; `studio/video/page.tsx:445-521`).
- The local worker drives Gemini/Flow/Kling and then requires Cloudinary to return an artifact (`worker.mjs:123-191`). With no `BROWSER_WORKER_TOKEN`, it exits (`worker.mjs:219-222`); with no Cloudinary credentials, completion fails (`worker.mjs:127-147`).
- Kling is an explicit throwing stub (`playbooks/kling.mjs:1-35`).
- Assembly also hard-requires Cloudinary (`video-gen/assemble.ts:31-39`) and only reads `FalVideoJob`, excluding browser-worker results.

### 5. Broken logo/CTA and product intake

- Logo and CTA artwork have no schema fields, upload endpoints, or UI. In fact, generation prompts repeatedly forbid logos (`prompts/storyboard.ts:57-59`; `studio/frames/route.ts:94-96`).
- Product “upload” converts files to base64 in the browser and PATCHes them into a Prisma JSON column (`product-definition.tsx:85-106`). There are no byte limits, MIME verification, object storage, upload status, or server-side validation (`product/route.ts:87-113`). Large images can exceed Vercel request/database limits.
- The UI updates local state without checking `res.ok`, making failed uploads appear successful (`product-definition.tsx:99-108`).
- Product URLs are fetched server-side from user input (`product-page-scraper.ts:87-104`) without private-network blocking: an SSRF risk. Static Cheerio parsing cannot handle many JS-rendered DTC/Amazon pages.
- The creation form declares unused product-image state and submits no product files (`project-form.tsx:37`, `60-88`).

## C. Recommended target architecture and phased plan

### Data model

Use typed entities:

- `Advertiser`, `CompetitorSet`, `Product`, `BrandAsset`
- `AdCreative` plus `AdPlacement` per platform/advertiser/country/date
- `MediaArtifact` for source video, transcript, OCR, logo, product image, generated image/video
- `AdAnalysis` with structured hook, problem, promise, proof, offer, objection handling, CTA, shot beats, confidence, and evidence timestamps
- `CreativeConcept` with a 15–20-value `archetype` and required `videoType`
- `Script`, `Shot`, `StoryboardFrame`; each shot links selling points and phase
- Unified `Job`, `JobTask`, `JobEvent`, and `Artifact`, with provider, lease, attempts, idempotency key, progress, and error class

Keep JSON only for immutable raw provider payloads and versioned prompt/output snapshots.

### Execution pattern

Vercel should be the authenticated control plane only. Postgres holds durable queued tasks. A paired local LibTV agent polls outbound HTTPS, leases work, downloads inputs through signed URLs, executes argument-safe commands:

`libtv upload` → `libtv node create -t image|video --run` → `libtv download`

The agent uploads resulting files to durable object storage through presigned URLs and reports artifact IDs/events. The dashboard reads the same job/artifact records. Never store worker-local paths as product state.

### Phases

1. **Safety first:** add authentication and workspace authorization; remove `db push --accept-data-loss`; block SSRF; introduce object storage and environment capability checks.
2. **Corpus rebuild:** implement separate Meta, TikTok, YouTube Shorts, and Google Transparency adapters with explicit provenance. Where credentials/APIs are unavailable, use a compliant local acquisition worker or licensed data provider—do not pretend generic search is equivalent.
3. **Normalize and rank:** enforce advertiser match, paid-ad confidence, duration, 9:16 dimensions, country, recency, and minimum performance. Produce Top-5/Top-10 independently per competitor.
4. **Evidence pipeline:** download permitted media, transcribe, OCR, sample frames, and create per-ad teardown records with timestamps and confidence.
5. **Creative rebuild:** add the archetype catalog, required `videoType`, selling-point-to-shot mappings, and exact two-second `HOOK/BODY/CTA` frames.
6. **LibTV production:** ship one worker/job path, artifact ingestion, retries, cancellation, logs, and dashboard previews; then delete legacy executors.

## D. Dangerous or dead code

- Nearly all project APIs lack authentication/ownership checks; anyone knowing an ID can read, mutate, generate paid media, or delete a project (`api/projects/[projectId]/route.ts:5-62`).
- Arbitrary product URLs, imported videos, remote images, and assembly media create SSRF and resource-exhaustion exposure.
- Kling is dead; crossfade is accepted but silently becomes a hard cut (`assemble.ts:117-160`).
- `FalVideoJob.falRequestId` stores both FAL request IDs and Veo operation IDs because provider/mode fields are missing (`generate-video/route.ts:129-149`).
- Local temp paths are persisted in Postgres despite serverless ephemerality (`video/runner.ts:74-150`).
- Broad catches hide source and AI failures, corrupting confidence and operational observability.
- The claimed cross-project “learning corpus” accumulates discoveries but contains no training, feedback, governance, or retention mechanism (`schema.prisma:609-649`).