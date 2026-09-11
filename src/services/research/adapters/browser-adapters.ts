/**
 * Browser-only ad sources (Meta Ad Library media, TikTok Ad Library, Google Ads
 * Transparency Center). These block server-side fetches from Vercel, so the
 * adapter does not fetch — it enqueues a `WorkerTask` of kind
 * `ad_library_fetch` for the operator's local research worker.
 *
 * A completed task with the same payload hash inside the last 7 days is reused
 * immediately, so a re-run of research does not re-queue work the worker has
 * already done.
 */
import {
  enqueueWorkerTask,
  findRecentCompletedTask,
  payloadHash,
  type AdLibraryFetchPayload,
} from "@/services/worker-tasks";
import { parseAdCandidates, type AdCandidate } from "../ad-candidate";
import type { AdapterContext, AdapterResult } from "./types";

export type BrowserSource = "meta" | "tiktok" | "google";

const SOURCE_NAMES: Record<BrowserSource, string> = {
  meta: "meta_ad_library_browser",
  tiktok: "tiktok_ad_library_browser",
  google: "google_ads_transparency_browser",
};

function buildPayload(
  source: BrowserSource,
  ctx: AdapterContext
): AdLibraryFetchPayload {
  return {
    source,
    advertiser: ctx.ownerName,
    competitorId: ctx.competitorId,
    countries: ctx.countries ?? ["US"],
    mediaType: "video",
    limit: ctx.limit ?? 20,
  };
}

/**
 * Returns cached candidates when a recent completed task exists, otherwise
 * enqueues and reports `pending_worker`.
 */
export async function runBrowserAdapter(
  source: BrowserSource,
  ctx: AdapterContext
): Promise<AdapterResult> {
  const name = SOURCE_NAMES[source];
  const payload = buildPayload(source, ctx);
  const hash = payloadHash(payload);

  try {
    const recent = await findRecentCompletedTask("ad_library_fetch", hash);
    if (recent?.result) {
      const raw = (recent.result as { candidates?: unknown }).candidates;
      const candidates: AdCandidate[] = parseAdCandidates(raw).map((c) => ({
        ...c,
        competitorId: ctx.competitorId,
      }));
      return {
        candidates,
        report: {
          name,
          status: "ran",
          count: candidates.length,
          note: `reused worker result from ${recent.completedAt?.toISOString().slice(0, 10)}`,
        },
      };
    }

    const { taskId, deduped } = await enqueueWorkerTask({
      projectId: ctx.projectId,
      kind: "ad_library_fetch",
      payload,
      priority: ctx.competitorId ? 0 : 1,
    });

    return {
      candidates: [],
      report: {
        name,
        status: "pending_worker",
        count: 0,
        note: deduped
          ? `already queued for "${ctx.ownerName}" (task ${taskId})`
          : `queued for local worker: "${ctx.ownerName}" (task ${taskId})`,
      },
    };
  } catch (err) {
    return {
      candidates: [],
      report: {
        name,
        status: "failed",
        count: 0,
        note: err instanceof Error ? err.message : "could not enqueue worker task",
      },
    };
  }
}

export const browserMetaAdapter = (ctx: AdapterContext) => runBrowserAdapter("meta", ctx);
export const browserTikTokAdapter = (ctx: AdapterContext) => runBrowserAdapter("tiktok", ctx);
export const browserGoogleAdapter = (ctx: AdapterContext) => runBrowserAdapter("google", ctx);
