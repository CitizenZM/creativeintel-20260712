# Xark Full Flow → Ad Studio: Integration Plan

**Xark 全流程 → Ad Studio 衔接方案 · 2026-11-07 · lab: `xark-adstudio-lab-20261107`**

## 1. Goal（目标）

Ad Studio currently receives only the Studio storyboard, script, brand kit and project basics. Everything the earlier steps (Setup → Research → Insights → Planning → Creative) worked out is dropped, so Ad Studio re-scrapes the product page and writes hooks without the research. That information includes the confirmed product photos, competitors' winning ads, selling points, audience pain points, angle, cast and setting.

The goal is to carry every step's results into Ad Studio's second pass. That pass covers re-analysis, hook rewrite, scene generation and review. All work happens in a separate lab copy, so the live Xark is not affected.

## 2. Step mapping（逐步对照）

| Xark step | Data it produces (Prisma) | Ad Studio consumer | Status |
|---|---|---|---|
| **Setup** | `Project.productPageImages / userProductImages / productPageText / productBrief / productConfirmedAt`, `Brand` (promise, tone, display rules) | `product.mjs`: Xark photos come first (user uploads → Xark-scraped → Ad Studio-scraped). Script prompt: product brief, confirmed or not, brand tone, display rules | ✅ P1 |
| **Research** | `ContentAsset` + `AdTeardown` (hook type/text/visual, beats, proof, CTA, why it works), `CompetitorRollup` | Script prompt "Winning competitor ad 1-5" (beat it, don't copy). Hook-type votes give `suggestedHookTypes` | ✅ P1 |
| | `ContentAsset.videoUrl` (real reference video) | Pace reference: the best-scored competitor video with real cuts sets cuts/s, hook length, camera craft; the storyboard still sets content | ✅ P2 |
| **Insights** | `SellingPoint`, `Insight`, `NarrativePattern` (picked first, dismissed dropped), `AudienceProfile` (pain points, segments), `DeepAnalysis` (hook formulas, selling-point visuals) | Script prompt: ranked selling points (* = user picked), pain points, insights, narrative patterns, hook formulas, how to show each selling point | ✅ P1 |
| **Planning** | `Project.campaignPlan`, `Project.testPlan`, `Angle` | Script prompt: campaign plan, test plan, angle (audience/emotion) | ✅ P1 (only when present) |
| **Creative** | `Script` (angle, template, videoType, emotion), `CampaignSelection` (actor, environment, selling-point order, platform, duration) | Script prompt: cast and setting are mandatory for every generated scene with a person; selling-point order; placement | ✅ P1 |
| **Studio** | `Storyboard.frames` (already wired) | Frame map and coverage check, nothing dropped | ✅ (earlier) |
| **Deliver / History** | `CreativeVariant`, `ProjectArtifact`, `AdPerformance` | Finished video + review back into Deliver; win rate by hook type → next `suggestedHookTypes` | ⏳ P4 |

## 3. How it works（架构）

```
Xark (lab)                                              Mac worker                  Ad Studio pipeline
Setup ─┐
Research ─┤ loadXarkContext() → shapeContext()      AdStudioRun.input.context  →  job.xark.context
Insights ─┤ (services/video-gen/adstudio-context.ts)   (frozen at batch create)      ├ product.mjs  xarkImages()  photos first
Planning ─┤                                                                          ├ xark.mjs     xarkContext() → script prompt
Creative ─┘                                                                          ├ hooks        picked hook type + winning hooks
Studio storyboard ── buildInput() ───────────────────┘                               └ review       judged against the storyboard
Studio panel: "Carried from Setup → … → Creative" + research-suggested hook types (Use these)
```

- **Frozen snapshot:** the context is captured when the batch is created, so later edits in Xark don't change a running plan.
- **Picked first:** what the user picked comes first. If nothing was picked, the strongest non-dismissed items are used. Every list is capped (5 winning ads, 6 selling points…) to keep the prompt small.
- **Backward compatible:** Ad Studio uses the context only when the job carries `xark.context`. Normal reference-video jobs and older Xark runs behave as before (tests cover both).

## 4. Lab isolation（隔离）

| | Live Xark | Lab |
|---|---|---|
| Code | `creativeintel-20260712` (branch `feat/adstudio-studio`) | `xark-adstudio-lab-20261107` (fresh history, private repo, **no git remote to Xark**) |
| Deploy | Vercel `creativeintel` | **none** (no Vercel project; local only) |
| DB | Neon prod | local Docker `localhost:55432/xark_lab` |
| Test data | — | prod project Mixikskin copied **read-only** (17 ads, 12 teardowns, 10 insights, 6 selling points, 6 scripts, 9 storyboards, audience, deep analysis, selection) |
| Worker | `WORKER_TOKEN` (prod) | `APP_URL=http://localhost:3200 WORKER_TOKEN=lab-token` |

Run the lab:

```bash
cd ~/Projects/xark-adstudio-lab-20261107
AUTH_PROVIDER=none DATABASE_URL=postgresql://postgres:local@localhost:55432/xark_lab APP_DATABASE_URL=$DATABASE_URL WORKER_TOKEN=lab-token NEXT_PUBLIC_ADSTUDIO=1 pnpm exec next dev -p 3200
cd workers/adstudio-worker && APP_URL=http://localhost:3200 WORKER_TOKEN=lab-token node worker.mjs --once
```

## 5. Phases（分期）

| Phase | Content | Effort | Depends on |
|---|---|---|---|
| **P1 ✅** | Context pack: Setup photos, product brief, brand, winning ads, insights, audience, angle, cast/setting, planning → Ad Studio; panel shows the summary and suggested hook types | done | — |
| **P2** | When a winning ad has a `videoUrl`, Ad Studio downloads it as the reference (the storyboard stays the plan, the reference gives the editing rhythm). Review then scores fidelity against the real ad | 0.5–1 day | Research must have video URLs (Mixik: 10/17 ads have one, 5 of them torn down, but none of the top 5 by score; Goli 34, Ridge 23) |
| **P3 ✅** | Start from Creative: a script without a storyboard goes straight to Ad Studio (frames built from `Script.scenes/bodyBeats`) | 0.5 day | P1 |
| **P4 ✅** | Results back: finished video → Deliver (`CreativeVariant`), review scores → Insights; `AdPerformance` win rate by hook type feeds the next suggestion | 1 day | Production deploy + Blob |
| **P5 ✅** | Quality: limit how many times one generated scene is reused (pack-tear shot appeared 6×) | 0.5 day | — |
| **P6** (not done — live Xark untouched) | Move into Xark: merge the lab diff into `feat/adstudio-studio` → production `prisma db push` (adds the `AdStudioRun` table only) → merge to main → deploy → test Blob | 0.5 day | **Barron's OK** |

## 6. Test results（测试结果）

Real Mixikskin data (copied from production read-only), storyboard "MIXIK SKIN — The Instant Glow Mist Routine" (8 frames), hook type `result`, engine `auto`, plan only (stopped at the approval gate):

| Check | Result |
|---|---|
| Panel summary | 6 product photos · 5 winning competitor ads · 6 selling points · 6 insights · 4 audience pain points · angle · cast "Frequent Traveler" · setting "Travel Convenience"; suggested hook types Result first · Pattern interrupt · Curiosity gap; "Use these" → "Plan 3 videos (3 hooks × 1 engine)" |
| Context reaches Ad Studio | `job.json` has `xark.context` (7 parts); product step: "6 from Xark Setup first, then 1 from the product page" |
| Context changed the plan | Hotel setting (from Creative environment, **not** in the storyboard), hook option "No 10-step routine" (from Insights, **not** in the storyboard), chosen hook "Before vs. after" = research's top suggestion |
| Storyboard kept | coverage 8/8 frames, nothing dropped |
| A/B first frames | Same traveler in one hotel room throughout, real MIXIK bottle, travel size at the end (`docs/lab-test-firstframes.jpg`) |
| Run in lab DB | `awaiting_approval`, plan spend $0.48, video estimate $1.30 |
| Tests | lab vitest 11/11 + worker node 3/3 + tsc 0; Ad Studio node 36/36 |

Not done: P3–P6.

## P2 result (2026-11-08)

- Xark carries up to 6 torn-down ads with a video link (`research.rhythmRefs`: direct video, else YouTube/TikTok/IG page), best score first; the panel shows "N competitor videos for pacing".
- Ad Studio (`pipeline/rhythm.mjs`) tries them in order with yt-dlp only, skips anything over 90 s or with fewer than 4 shots / 0.2 cuts/s, caches download + analysis + blueprint in `data/refcache/`, and adds a PACE REFERENCE block to the script prompt. `spec.xark.pace` records our cuts/s against the reference.
- Mixik test: MDNA Rose Mist (score 85) is one continuous take → skipped; an 858 s review → skipped; one video unavailable → skipped; "That Feeling When Skincare Finally Makes Sense" (60 s, 22 shots, 0.37 cuts/s, 4 s hook) used. Script: 8 shots, 0.44 cuts/s (119% of reference), storyboard coverage 8/8.
- All 5 Meta Ad Library video links stored by Xark return 403: they are signed CDN links that expire. Xark should save the file (Blob) when Research captures the ad, or Ad Studio can only use YouTube-style pages.
- Bug found and fixed on the way: the reference cache key dropped the query string, so every YouTube `watch?v=` link shared one cache entry (normal Ad Studio jobs too).

## Review copy online (2026-11-08)

- URL: https://xark-adstudio-lab-20261107-barrons-projects-b6dc5d36.vercel.app (Vercel login required; Mixik project `/projects/cmtt3l572000204jxznfrcrdz/studio`)
- Separate from live Xark: own Vercel project, own Railway Postgres (copy of the lab DB: Mixik only), own Blob store, no scheduled jobs (autopilot / report digest removed), `AUTH_PROVIDER=none` behind Vercel's login.
- The project's default `xark-adstudio-lab-20261107.vercel.app` domain was removed: Vercel's protection does not cover it, and it served data without login for about 3 minutes after the first build.
- P3: Studio panel "Start from" lists Creative scripts with no storyboard; their scenes (or hook → beats → CTA) become 2 s frames. Hosted test: "[P3 test] MIXIK SKIN - 3 Reasons I Switched" (test row added to the copy only) → 5 frames → plan, coverage 5/5, pace 0.52 vs 0.37 cuts/s, waiting for approval ($1.40).
- P4: Deliver lists finished Ad Studio videos with the ad name to upload under (`…_ASResult_EAuto`); the performance import reads it back as hook type; CTR per hook type gets 2 votes in the suggestion; each finished run's review becomes an Insight (`adstudio_review`).
- Mac worker for the copy: `APP_URL=<URL> WORKER_TOKEN=… VERCEL_AUTOMATION_BYPASS_SECRET=… node workers/adstudio-worker/worker.mjs` (secrets in the scratchpad files, not in git).
