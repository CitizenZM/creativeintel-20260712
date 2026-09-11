# Audit 06 — Dashboard UI/UX & agent-drivability (Claude Sonnet)

## 1. Navigation model & stage gating

Two parallel nav systems, both static, no gating anywhere:
- Desktop: `sidebar.tsx` (Home/Projects/New/Brand library) + `tab-nav.tsx:19-26` 6 tabs: Overview, Content, Insights, Create, Studio, **Video** (`studio/video`, a separate top-level tab).
- Mobile: `bottom-nav.tsx:14-20` Home/Projects/Create/Studio/Library — Content, Insights, Research, Video have no mobile entry.

No tab ever disabled. `page.tsx:15-21` redirects DRAFT → `/research`, else `/overview`; `research/page.tsx:109-132` auto-starts on DRAFT. Per-stage completion inferred client-side from array lengths (`creative/page.tsx:130-135`), never persisted.

## 2. UX defects

**Studio vs Studio/Video duplication.** `studio/page.tsx` ("Preview Studio", :378) = VEO prompts + `generate-video` with 5 s×60 poll (:221-253). `studio/video/page.tsx` ("Video Studio", :547) = fal.ai model picker with 15 s poll (:417-442) + embeds `VideoLibraryPanel` (:799) — a third pipeline. `creative/page.tsx:290-293` `goToStudio()` → `/studio?scripts=…`; `studio/video/page.tsx:399-407` ignores the param. CTA copy varies: "Send to Studio" / "Open in Studio" / "Open Studio" (`creative/page.tsx:528-532,552-560,633-636,733-741`).

**Research vs Content overlap.** Research triggered from three places: auto on DRAFT (`research/page.tsx:113-115`), Retry (:243-250), and "Run research/Regenerate" inside Content's Video-mode card (`content-platform-controls.tsx:47-70`).

**Silent failures.** `creative/page.tsx:248-279` `generateAll()` returns silently on empty arrays. `studio/video/page.tsx:513-522` no per-shot failure isolation. `storyboard-frame-card.tsx`, `lofi-frame.tsx` bare `catch {}`.

**Dead/misleading.** Sidebar footer hardcodes "OpenAI GPT-4o · Active" (`sidebar.tsx:72-78`). `library/brands/page.tsx:68-82` competitor cards non-interactive divs.

**Dark mode not implemented.** `globals.css:5` declares `@custom-variant dark` but zero `.dark {}` block; no ThemeProvider.

**Mobile:** BottomNav + sticky TabNav (`tab-nav.tsx:32`) overlap, no shared active state.

## 3. Agent-drivability

- Setup: `POST /api/projects` synchronous, **no idempotency** → retries duplicate projects.
- Research: best stage — `withIdempotency`, job-based 202 `{jobId}`, `GET /research/status?jobId=`.
- Content: `GET /content`, `POST /content/search-more` fine.
- Insights: `GET /insights`; `POST /insights/reanalyze` synchronous, no job id.
- Creative: angles/scripts/scripts-batch/storyboards/storyboards-batch/test-matrix **all synchronous, non-idempotent LLM calls in 60 s functions**; each `POST /scripts` unconditionally creates → retry duplicates.
- Studio: `generate-video`/`generate-from-script` return job ids pollable via `fal-status`/`video-status`; `GET fal-jobs` lists. `storyboard-keyframes` (8 sequential image calls, `:39-84`) no job id, no upsert.
- LibTV handoff: `grep libtv` → zero matches. Only bridge is `BrowserGenJob` + `POST /api/worker/browser-jobs`.
- Export: `GET /export` zips scripts.json + storyboards.json + HTML — never includes finished MP4s.
- Auth: no `middleware.ts`; all project routes unauthenticated except worker endpoint.

## 4. Target IA

Six-stage left rail **Setup → Research → Insights → Creative → Studio → Deliver** with server-derived completion rings. Merge Content into Research (browse tab). Merge `/studio` + `/studio/video` + VideoLibraryPanel into one Studio (Brief, Render Queue, Reference Library). Persistent Brand Kit completeness chip in header (reuse amber/emerald pattern from `product-definition.tsx:137-156`, `campaign-selection.tsx:328-364`). One fixed "Next: <stage>" button per page. Studio timeline: `Storyboard.frames` as horizontal 2 s cells colored by segment (consolidate `SEGMENT_COLORS` duplicated in `insights/page.tsx:77-86` and `campaign-selection.tsx:156-169`), keyframe thumb + clip status by `shotIndex`, "Open in LibTV" + "Download MP4".

## 5. Top 10 UI changes

1. Merge `/studio` + `/studio/video`; remove duplicate tab (`tab-nav.tsx:25`); fix `goToStudio()`.
2. Idempotency/job pattern for creative/* , `insights/reanalyze`, `storyboard-keyframes`.
3. Persist stage completion server-side.
4. Dark-mode palette or remove variant.
5. Mobile bottom-nav entries.
6. Surface errors in `creative/page.tsx:248-279`, `storyboard-frame-card.tsx:184-186`, `lofi-frame.tsx:41-43`.
7. Sidebar model footer → real config.
8. Real video assets in `/export`.
9. Build LibTV bridge (worker route + docs).
10. Idempotency on `POST /api/projects`.
