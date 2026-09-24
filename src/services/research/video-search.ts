/**
 * Adapter dispatch.
 *
 * The campaign platform decides WHICH adapters run (campaign-platform.ts
 * `adapters`). The old code searched YouTube+Vimeo under `short_social` and
 * then filtered every non-TikTok candidate away, emptying the pool (audit §2a,
 * video-search.ts:51-57 / :406). There is no post-hoc `allowedPlatforms` filter
 * here any more — the platform gate lives in ranking.ts and only sees
 * candidates the dispatcher actually asked for.
 */
import type { SearchKeywords } from "./keyword-extractor";
import { dedupeCandidates, type AdCandidate } from "./ad-candidate";
import {
  adaptersFor,
  BROWSER_ADAPTERS,
  type AdapterId,
  type CampaignPlatform,
} from "@/lib/campaign-platform";
import { pMapSettled } from "@/lib/parallel";
import { youtubeShortsAdapter, youtubeLongAdapter } from "./adapters/youtube-shorts";
import { metaAdLibraryAdapter } from "./adapters/meta-ad-library";
import { tiktokCreativeCenterAdapter } from "./adapters/tiktok-creative-center";
import { tiktokOrganicAdapter } from "./adapters/tiktok-organic";
import { instagramAdapter } from "./adapters/instagram";
import {
  browserMetaAdapter,
  browserTikTokAdapter,
  browserGoogleAdapter,
} from "./adapters/browser-adapters";
import type { Adapter, AdapterContext, SourceReport } from "./adapters/types";
import { classifyAdCandidates, type RelevanceContext } from "./video-relevance";

/**
 * Legacy row shape. Retained only so modules still mid-migration
 * (analysis-pipeline.ts) keep compiling; nothing in the research pipeline
 * produces or consumes it any more.
 */
export interface VideoResult {
  platform: "youtube" | "youtube_short" | "tiktok" | "vimeo" | "instagram";
  videoId: string;
  title: string;
  description: string;
  url: string;
  thumbnailUrl: string;
  channelTitle: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  publishedAt: string;
  metricsEstimated?: boolean;
}

const REGISTRY: Record<AdapterId, Adapter> = {
  youtube_shorts: youtubeShortsAdapter,
  youtube_long: youtubeLongAdapter,
  meta_ad_library: metaAdLibraryAdapter,
  tiktok_cc: tiktokCreativeCenterAdapter,
  tiktok_organic: tiktokOrganicAdapter,
  instagram: instagramAdapter,
  browser_meta: browserMetaAdapter,
  browser_tiktok: browserTikTokAdapter,
  browser_google: browserGoogleAdapter,
};

export interface DispatchResult {
  candidates: AdCandidate[];
  reports: SourceReport[];
}

/**
 * Adapter ids this campaign dispatches, split into API-now vs worker-later.
 *
 * When the project has no saved CampaignSelection yet, `adaptersFor` falls back
 * to DEFAULT_ADAPTERS, which carries NO `browser_*` entries. Research can start
 * before the campaign step is saved (the runner resolves the selection inside
 * the background job), so that fallback silently skipped every ad-library
 * worker enqueue: no WorkerTask rows, no `pending_worker` source, and nothing
 * for the local worker to claim — while the Content page still advertised the
 * worker sources from the campaign config saved moments later.
 *
 * The browser sources are owner-scoped (brand + each competitor), not
 * platform-scoped, and enqueue is hash-deduped, so an unknown campaign gets the
 * full browser set rather than none. A campaign that deliberately lists no
 * browser adapters (e.g. `amazon`) still gets none.
 */
export function dispatchPlan(campaign: CampaignPlatform | null): {
  api: AdapterId[];
  browser: AdapterId[];
} {
  const all = adaptersFor(campaign);
  const api = all.filter((a) => !BROWSER_ADAPTERS.has(a));
  const browser = all.filter((a) => BROWSER_ADAPTERS.has(a));
  if (!campaign) return { api, browser: [...BROWSER_ADAPTERS] };
  return { api, browser };
}

/** Run every adapter for one owner (brand or a single competitor). */
// One slow source must never stall the whole run past the function limit —
// a source that overruns is reported as failed and the others still count.
const ADAPTER_DEADLINE_MS = 60_000;

function withDeadline<T>(work: Promise<T>, ms: number, name: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${name} timed out after ${Math.round(ms / 1000)}s`)),
      ms
    );
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

export async function runAdapters(
  adapterIds: AdapterId[],
  ctx: AdapterContext
): Promise<DispatchResult> {
  const settled = await pMapSettled(
    adapterIds,
    (id) => withDeadline(REGISTRY[id](ctx), ADAPTER_DEADLINE_MS, id),
    { concurrency: 3 }
  );

  const candidates: AdCandidate[] = [];
  const reports: SourceReport[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") {
      candidates.push(...r.value.candidates);
      reports.push(r.value.report);
    } else {
      reports.push({
        name: adapterIds[i],
        status: "failed",
        count: 0,
        note: r.reason instanceof Error ? r.reason.message : String(r.reason),
      });
    }
  });

  return { candidates: dedupeCandidates(candidates), reports };
}

export interface VerifiedSearchOptions {
  projectId: string;
  competitorId?: string | null;
  productName?: string;
  campaign: CampaignPlatform | null;
  countries?: string[];
  limit?: number;
  /** Skip the LLM ad classifier (search-more runs its own scoring pass). */
  skipClassifier?: boolean;
}

/**
 * Search every adapter the campaign dispatches for one owner, then annotate the
 * non-ad-library candidates with the ad classifier. Export name kept for
 * compatibility with the previous pipeline; the implementation is now
 * adapter-driven and returns AdCandidates.
 */
export async function searchVerifiedVideos(
  ownerName: string,
  keywords: SearchKeywords,
  opts: VerifiedSearchOptions
): Promise<DispatchResult> {
  const { api, browser } = dispatchPlan(opts.campaign);
  const ctx: AdapterContext = {
    ownerName,
    competitorId: opts.competitorId ?? null,
    projectId: opts.projectId,
    productName: opts.productName,
    keywords,
    countries: opts.countries,
    limit: opts.limit,
  };

  const { candidates, reports } = await runAdapters([...api, ...browser], ctx);

  if (opts.skipClassifier) return { candidates, reports };

  const relevanceCtx: RelevanceContext = {
    brandName: ownerName,
    productName: opts.productName,
    keywords,
  };
  const classified = await classifyAdCandidates(candidates, relevanceCtx);

  if (classified.degraded) {
    reports.push({
      name: "ad_classifier",
      status: "failed",
      count: 0,
      note: "LLM unavailable — fell back to deterministic ad-intent scoring",
    });
  } else {
    reports.push({
      name: "ad_classifier",
      status: "ran",
      count: classified.classifiedCount,
      note: `${classified.classifiedCount} non-ad-library candidates classified`,
    });
  }

  return { candidates: classified.candidates, reports };
}
