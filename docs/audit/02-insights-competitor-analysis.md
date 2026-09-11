# Audit 02 — Insights / Competitor Analysis (Claude Opus)

## 1. What actually runs

`runAnalysisPipeline` (`src/services/ai/analysis-pipeline.ts:101`) fires six LLM calls, all through `analyzeWithClaude`.

**The name is a lie.** `src/services/ai/claude-client.ts:43` returns `"gpt-4o"` when `OPENAI_API_KEY` is set; `:46` falls back to `meta-llama/llama-3.3-70b-instruct:free` on OpenRouter. `@anthropic-ai/sdk` is a dependency but is not used on this path. The Insights page label (`insights/page.tsx:166`) prints `"gpt-4o-mini"` as the default — wrong on both branches.

| Call | Input it actually sees | Stored in |
|---|---|---|
| Brand analysis (`:136`) | website crawl text + product page text | `Brand` |
| Strategic insights (`:163-176`) | only the brand analysis output — no videos | `Insight` |
| Competitor intel (`:194`) | **competitor website crawl text only — zero video data** | `Competitor`, `Insight(category:"gap")` |
| Content scoring (`:249`) | top-10 videos: title/desc/views + transcript or a text note saying "thumbnail available" | `ContentAsset` |
| Pattern mining (`:330`) | title, narrativeType, score, hookText, keyMessages | `NarrativePattern`, `SellingPoint` |
| Deep analysis (`:505`) | top-8 assets' scores and hook strings — no transcripts, no images | `DeepAnalysis` (one row per project) |

**Vision: none, anywhere.** `analysis-pipeline.ts:242-248` states no vision call is made; thumbnails are passed as prose (`content-scoring.ts:86-87`). Every "first 3 seconds visual", "camera angle", "environment lighting" field in `deep-analysis.ts:74-126` is model invention from titles and numeric scores.

**Transcription on Vercel:** `video-signal.ts:73-77` returns thumbnail-only for anything not YouTube — TikTok, Instagram, Vimeo, Meta ads get no transcript ever (`cloud-downloader.ts:30-36` throws for non-YouTube). YouTube: `@distube/ytdl-core` into memory (30 MB cap) → Groq Whisper. Limits: 5-min videos skipped (`video-signal.ts:25,95`), 45 s budget per video, 10 videos total (`analysis-pipeline.ts:19`). Unverified: whether `waitUntil(runResearch(...))` (`research/route.ts:52`) survives past `maxDuration = 60`.

## 2. Evidence: analysis is not competitor-centric

1. The competitor prompt never sees a single ad — `prompts/competitor-intel.ts:40-54` is fed only `competitorCrawl`.
2. `competitorId` is written once (`analysis-pipeline.ts:281`) and read nowhere. No per-competitor query, no competitors page.
3. Top-N per competitor does not exist — `analysis-pipeline.ts:114-120` puts brand videos first, `:216` slices `allVideos.slice(0, 10)`. A brand with 10+ videos gets zero competitor ads scored.
4. Rollups are project-global — `DeepAnalysis.projectId @unique`, `NarrativePattern @@unique([projectId,type])`, `SellingPoint` only has `projectId`.
5. Competitor insights are unlinked strings — `analysis-pipeline.ts:203-208` writes `"Opportunity vs ${comp.name}"` with `importance: 70` hardcoded; `Insight` has no `competitorId`.
6. No per-ad decomposition stored — `ContentAsset` holds six scores, one `hookText`, `keyMessages`, `transcript`. No hook type, CTA text, beats, offer, proof devices.

**Data-integrity bug:** `api/projects/[projectId]/content/[assetId]/script/route.ts:31-66` asks the model to "reconstruct what the video's script likely contains" and writes it to `contentAsset.transcript` (`:63-66`) — overwrites real Whisper transcripts with fabricated text.

**Secondary:** `insights/reanalyze/route.ts:9-118` omits `videoTimeline` and `platform`/`targetDurationSec` — "Re-analyze" silently degrades. `insights/route.ts:10-25` returns no competitor or asset data.

## 3. Gaps vs. requirement

| Required | Present? |
|---|---|
| Per-ad hook type / text / first-3s visual | `hookText` only |
| Structure beats | Absent per-ad |
| Selling points shown in that ad | Only project-level |
| Proof devices | Absent |
| CTA text + placement + offer | Absent per-ad |
| Landing page | Absent |
| Longevity (first/last seen) | Absent |
| Why it works | scoring `analysis` string discarded (`analysis-pipeline.ts:276`) |
| Per-competitor Top-5/10 | Absent |
| Competitor rollup | Absent |
| Cross-competitor gap | Only website-copy opportunity strings |
| Insights → scripts | No competitor teardown reachable from `script-writing.ts` |

## 4. Recommended data model + prompt architecture

```prisma
model AdTeardown {              // 1:1 with ContentAsset, deep tier only
  contentAssetId String @unique
  competitorId   String?
  rank           Int?
  hookType       String
  hookText       String
  hookVisual     String
  beats          Json           // [{startSec,endSec,role,visual,vo,onScreenText}]
  sellingPoints  Json
  proofDevices   Json
  ctaText        String?
  ctaPlacement   String?
  offer          String?
  landingUrl     String?
  whyItWorks     String
  evidenceLevel  String         // vision_transcript | transcript | thumbnail | metadata
  confidence     String
  firstSeenAt    DateTime?
  lastSeenAt     DateTime?
}
model CompetitorRollup { competitorId @unique; topAssetIds; dominantHooks; dominantFormats; offerLadder; ctaPatterns; cadence; summary }
// + Insight.competitorId, ContentAsset.frameUrls
```

Three prompt tiers replacing the blended deep-analysis: (1) per-ad multimodal teardown (4–6 keyframes + timestamped transcript), (2) per-competitor rollup, (3) cross-competitor gap → competitor-linked Insights. Deep tier only for TOP_N_PER_COMPETITOR (default 5). Cache by `(videoId, promptVersion)`. Run in a queued job, not inside the 60 s request.

## 5. Top 10 prioritized changes

1. `content/[assetId]/script/route.ts:63` — stop overwriting `transcript` with hallucinated text.
2. `analysis-pipeline.ts:114-120,216` — Top-N per owner instead of `allVideos.slice(0,10)`.
3. `schema.prisma` — add `AdTeardown`, `CompetitorRollup`, `Insight.competitorId`, `ContentAsset.frameUrls`.
4. New `src/services/video/frames.ts` — keyframe extraction.
5. `claude-client.ts:82` — accept multimodal content parts.
6. New `prompts/ad-teardown.ts` + per-ad pipeline stage.
7. New `prompts/competitor-rollup.ts` + `prompts/competitive-gap.ts`.
8. `video-signal.ts:73-77` — non-YouTube transcript path via worker.
9. New `projects/[projectId]/competitors/[competitorId]` page; fix model label at `insights/page.tsx:166`.
10. `insights/reanalyze/route.ts` — reuse pipeline schema; persist scoring `analysis`; wire teardowns into `script-writing.ts`.
