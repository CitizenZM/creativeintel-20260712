# Audit 01 — Competitor-video research / scraping pipeline (Claude Opus)

Live-DB cross-check (2026-09-11, production Neon): 241 `ContentAsset` rows — **225 YOUTUBE_VIDEO, 14 YOUTUBE_SHORT, 2 lowercase "youtube"; zero TikTok / Instagram / Meta; zero `isPaidMedia = true`; `DiscoveredVideo` = 0 rows.** Production Vercel env has **no `YOUTUBE_API_KEY` and no `META_ACCESS_TOKEN`** — the YouTube data came from the HTML-scrape fallback; Meta Ad Library has never run in production.

## 1. Actual data flow

`POST /api/projects/[id]/research` (`research/route.ts:49-52`) → `ResearchJob` → `runResearch` via `waitUntil`. Five steps (`runner.ts:26-32`): crawl → brand understanding (keywords + 5 `adSearchQueries`) → video search per target (`searchVerifiedVideos`, `targetCount: 6, maxRounds: 3`, `runner.ts:134-139`) → paid media (TikTok CC, Meta) → `runAnalysisPipeline`.

Sources by `strategy` (`video-search.ts:44-84`):

| strategy | calls | platforms produced |
|---|---|---|
| `short_social` | `searchYouTubeShorts` + `searchVimeoContent` | `youtube_short`, `vimeo` |
| `tvc` | `searchYouTubeLong` + `searchVimeoContent` | `youtube`, `vimeo` |
| `mixed` | all four incl. `searchSocialPlatforms` | + `tiktok`, `instagram` |

- YouTube — API if `YOUTUBE_API_KEY` (`youtube-service.ts:64-71`) else HTML scrape (`176-215`).
- TikTok organic — DuckDuckGo URL guessing → `scrapeTikTokVideo()` (`video-search.ts:238-241, 262-315`); bot-blocked → `null` silently (`tiktok-scraper.ts:34,71`).
- Instagram — DDG URL match only; metrics hardcoded 0 (`video-search.ts:192-206`).
- Vimeo — DDG `site:vimeo.com`, metrics 0 (`video-search.ts:86-115`).
- TikTok Creative Center — `top_ads/v2/list` (`tiktok-creative-center.ts:55`), silent `[]` on failure (`72-83`).
- Meta Ad Library — `ads_archive` with `search_terms` (`meta-ads.ts:175-186`); `SkippedNoCredentialsError` without token (`225-228`).

**Dead / write-only:** `instagram-oembed.ts` (zero callers); `video-corpus.ts` → `DiscoveredVideo` written never read; `content/search-more/route.ts` YouTube-only hardcoded TVC queries (`29-36`); `research/page.tsx:21-27` hardcoded step labels ≠ `STEP_NAMES`.

## 2. Root causes

### (a) Platform mismatch — the single biggest defect
`campaign-platform.ts:27-42` maps TikTok/Instagram → `searchStrategy: "short_social"`, `videoPlatforms: ["tiktok","instagram"]`. But `short_social` **never calls `searchSocialPlatforms`** (`video-search.ts:51-57`) — only under `mixed` (`67-73`). Then `searchVerifiedVideos` drops every candidate not in `allowedPlatforms` (`video-search.ts:406`). **Selecting TikTok/Reels or Instagram produces a pool of YouTube Shorts + Vimeo, then filters 100% of it away.** Also `searchYouTubeShorts` labels every result `youtube_short` regardless of length (`video-search.ts:155`).

### (b) Format mismatch — no duration filter exists
- API path never sets `videoDuration` (`youtube-service.ts:64-71`).
- `spFilter = "EgIQCQ%3D%3D"` (`video-search.ts:154`) only applies on the scrape path (`youtube-service.ts:50`); with an API key it is silently discarded, as are `mustContain`/`mustNotContain` (`:51-53`). Configuring the official key *disables* both the Shorts filter and disambiguation.
- `VideoResult` has no `durationSec` / aspect (`video-search.ts:15-29`). Duration fetched once (`video-signal.ts:88`) only to skip >5 min transcription.

### (c) Quality / UGC-vs-ad
- `isPaidMedia = true` set only at `runner.ts:196` (TikTok CC) and `:266` (Meta). Search path never sets it.
- Ad-intent = one regex worth 0.1 (`video-relevance.ts:70`). No penalty for review/unboxing/haul/vs. `EXCLUDE_HARD` (`:25`) minimal.
- Verifier prompt asks "relevant marketing/ad/brand content" (`video-relevance.ts:156,163`) — a review passes.
- `contentCategory` (AD|REVIEW|UGC|OTHER) produced (`content-scoring.ts:47,67-71`), persisted, badge-only (`content/page.tsx:155,488`); never a filter.
- `minViews: 1000` (`video-relevance.ts:208`), passes on views ≥1000 **or** engagement ≥1% (`:283`); metric-less sources bypass if relevance ≥0.6 (`:284`) with flat 0.35 quality (`:85`). Score = 0.55·relevance + 0.45·quality (`:259`).
- TikTok CC queried with no brand/competitor filter — `{limit:20, industry}`, `for_you` (`runner.ts:172-175`). Random regional ads saved as paid TIKTOK_VIDEO.
- Meta queried for brand only (`runner.ts:246`), never competitors; requested `fields` (`meta-ads.ts:162-173`) lack any video field so `creativeVideoUrl` always undefined; stored as `SOCIAL_POST` → `ad_snapshot_url`.
- Per-competitor Top-N destroyed: `analysis-pipeline.ts:216` `allVideos.slice(0, 10)` brand-first; `ContentAsset` rows only created inside the score loop (`:278`). `videoCompetitorMap` keyed by `videoId` alone (`:116-119`).

Silent-failure amplifier: DDG (`duckduckgo.ts:50`), TikTok scrape (`tiktok-scraper.ts:71`), TikTok CC (`:81`), Vimeo (`vimeo-service.ts:39`) all return `[]`/`null`.

## 3. Missing capabilities

| Required | Status |
|---|---|
| Google Ads Transparency Center | Absent |
| TikTok Ad Library | Absent (only CC top ads) |
| TikTok CC per-brand search | Absent |
| Instagram Reels real source | Absent |
| Meta Ad Library per competitor | Absent |
| Meta Ad Library video extraction | Absent (needs browser render of snapshot) |
| Ad-vs-UGC classifier as filter | Absent |
| Duration / aspect capture + filter | Absent |
| Per-competitor Top-5/10 | Absent |
| Longevity (firstSeen→lastSeen) as ranking signal | Buried in `adSpendEstimate` JSON |

## 4. Rebuild recommendation

```ts
interface AdCandidate {
  sourceId: string; // `${source}:${nativeId}`
  source: "meta_ad_library"|"tiktok_ad_library"|"tiktok_cc"|"google_ats"|"youtube"|"ig_reels";
  platform: "facebook"|"instagram"|"tiktok"|"youtube"|"youtube_short";
  format: "vertical_short"|"square"|"horizontal"|"unknown";
  durationSec?: number; aspect?: "9:16"|"1:1"|"16:9";
  isPaidAd: boolean; adEvidence: "ad_library"|"paid_label"|"classifier"|"none";
  advertiserName?: string; advertiserId?: string; adLibraryId?: string;
  competitorId?: string|null;
  metrics: { views?; likes?; comments?; impressionsLower?; impressionsUpper?; spendLower?; spendUpper?; ctr?; cvr? };
  firstSeen?: string; lastSeen?: string;
  landingUrl?: string; videoUrl?: string; thumbnailUrl: string; permalink: string;
}
```

Adapters: `meta-ad-library-api` (per advertiser page_id, request delivery times + publisher_platforms + snapshot; surface access-tier errors), `meta-ad-library-browser` (local worker renders snapshot, intercepts `video_hd_url`), `tiktok-ad-library-browser`, `tiktok-creative-center` (keyword/advertiser search), `google-ats-browser`, `youtube-shorts` (`videoDuration=short` + `videos.list contentDetails`), `ig-reels` (worker). Extend the existing token-authenticated local worker rather than build a second.

Hard gates in order: (1) `isPaidAd` or classifier ≥0.75; (2) UGC lexicon reject unless ad-library evidence; (3) format gate from campaign (short: ≤60 s & 9:16; TVC ≥15 s); (4) platform gate at adapter dispatch; (5) per-platform performance floor (ad-library sources exempt → longevity).

```
score = 0.30·norm(log10(views ?? impressionsLower)) + 0.25·longevity(days/90)
      + 0.20·engagementRate(cap .10) + 0.15·recency + 0.10·creativeScore/100
```
Rank partitioned by `competitorId`, Top-N per competitor.

## 5. Top 10 changes

1. `video-search.ts:51-57` — `short_social` must call `searchSocialPlatforms`.
2. `video-search.ts:379-422` — platform-driven adapter dispatch instead of post-filter.
3. `analysis-pipeline.ts:216` — per-owner Top-N; key map by `platform:videoId`.
4. `youtube-service.ts:44-48` — apply duration + quality filters on API path; `videos.list contentDetails`.
5. `video-search.ts:15-29` + `ContentAsset` — add durationSec/aspect/isPaidAd/advertiser/adLibraryId/firstSeen/lastSeen/landingUrl.
6. `video-relevance.ts:25,70,276-286` — UGC lexicon hard reject; verifier asks "brand-paid ad, not creator review?" → `isAd` + `adConfidence`.
7. `runner.ts:245-249` — Meta per competitor; add delivery/platform fields; propagate access errors.
8. `runner.ts:172-175` — pass competitor keywords to TikTok CC or tag as non-competitor.
9. New worker playbook `ad-library` — Meta/Google ATC/TikTok AL scraping with video URL + duration.
10. `video-corpus.ts` / `content/page.tsx:157` — read corpus back or delete; default Content page to `isPaidMedia`/`AD`.

Unverified: validity of `sp=EgIQCQ%3D%3D`; TikTok CC endpoint without auth; `ads_archive` access tier. No tests exist.
