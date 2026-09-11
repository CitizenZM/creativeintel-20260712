/**
 * Persistence for ranked AdCandidates. Shared by the research runner and by
 * /api/worker/tasks (worker results land in the same ranking + upsert path).
 *
 * Upserts on (projectId, url) and never deletes: a re-run refreshes metrics and
 * rank in place, so manual annotations and downstream Insight rows survive.
 */
import { prisma } from "@/lib/db";
import { pMap } from "@/lib/parallel";
import { toContentAssetData } from "./ad-candidate";
import {
  BRAND_OWNER_KEY,
  UNOWNED_KEY,
  rankByOwner,
  type RankedCandidate,
} from "./ranking";
import type { AdCandidate } from "./ad-candidate";

export interface SaveResult {
  saved: number;
  failed: number;
  perOwner: { ownerKey: string; count: number }[];
}

async function upsertAll(
  projectId: string,
  rows: { candidate: AdCandidate; rankInOwner: number | null; isBrandOwned: boolean }[]
): Promise<{ saved: number; failed: number }> {
  const results = await pMap(
    rows,
    async ({ candidate: c, rankInOwner, isBrandOwned }) => {
      const data = toContentAssetData(c, { rankInOwner, isBrandOwned });
      const { url, ...rest } = data;
      try {
        await prisma.contentAsset.upsert({
          where: { projectId_url: { projectId, url } },
          create: { projectId, url, ...rest } as never,
          update: {
            title: rest.title,
            thumbnailUrl: rest.thumbnailUrl,
            description: rest.description,
            publishedAt: rest.publishedAt,
            platform: rest.platform,
            competitorId: rest.competitorId,
            type: rest.type,
            viewCount: rest.viewCount,
            likeCount: rest.likeCount,
            commentCount: rest.commentCount,
            engagementRate: rest.engagementRate,
            metricsSource: rest.metricsSource,
            isPaidMedia: rest.isPaidMedia,
            isBrandOwned: rest.isBrandOwned,
            adSpendEstimate: rest.adSpendEstimate,
            adSource: rest.adSource,
            adEvidence: rest.adEvidence,
            adConfidence: rest.adConfidence,
            advertiserName: rest.advertiserName,
            advertiserId: rest.advertiserId,
            adLibraryId: rest.adLibraryId,
            durationSec: rest.durationSec,
            aspectRatio: rest.aspectRatio,
            format: rest.format,
            videoUrl: rest.videoUrl,
            landingUrl: rest.landingUrl,
            firstSeenAt: rest.firstSeenAt,
            lastSeenAt: rest.lastSeenAt,
            rankInOwner: rest.rankInOwner,
            dataSource: rest.dataSource,
          } as never,
        });
        return true;
      } catch {
        return false;
      }
    },
    { concurrency: 5 }
  );

  return {
    saved: results.filter(Boolean).length,
    failed: results.filter((r) => !r).length,
  };
}

/** Writes one owner's Top-N, clearing stale ranks for that owner first. */
async function saveOwner(
  projectId: string,
  ownerKey: string,
  ranked: RankedCandidate[]
): Promise<{ saved: number; failed: number }> {
  const competitorId =
    ownerKey === BRAND_OWNER_KEY || ownerKey === UNOWNED_KEY ? null : ownerKey;
  const isBrandOwned = ownerKey === BRAND_OWNER_KEY;

  await prisma.contentAsset
    .updateMany({
      where: { projectId, competitorId, rankInOwner: { not: null } },
      data: { rankInOwner: null },
    })
    .catch(() => undefined);

  return upsertAll(
    projectId,
    ranked.map((c) => ({
      candidate: c,
      // A brand-agnostic feed row is stored but carries no per-owner rank.
      rankInOwner: ownerKey === UNOWNED_KEY ? null : c.rankInOwner,
      isBrandOwned,
    }))
  );
}

/**
 * Append candidates without touching existing ranks — used by "search more",
 * which adds to the pool rather than re-deciding the Top-N.
 */
export async function saveUnrankedCandidates(
  projectId: string,
  candidates: AdCandidate[]
): Promise<{ saved: number; failed: number }> {
  return upsertAll(
    projectId,
    candidates.map((c) => ({
      candidate: c,
      rankInOwner: null,
      isBrandOwned: c.competitorId == null,
    }))
  );
}

/** Rank the candidates per owner and persist each owner's Top-N. */
export async function rankAndSaveCandidates(params: {
  projectId: string;
  candidates: AdCandidate[];
  knownOwnerIds: Set<string>;
  topN?: number;
}): Promise<SaveResult & { ranked: Map<string, RankedCandidate[]> }> {
  const ranked = rankByOwner(params.candidates, {
    topN: params.topN,
    knownOwnerIds: params.knownOwnerIds,
  });

  let saved = 0;
  let failed = 0;
  const perOwner: { ownerKey: string; count: number }[] = [];

  for (const [ownerKey, list] of ranked) {
    const r = await saveOwner(params.projectId, ownerKey, list);
    saved += r.saved;
    failed += r.failed;
    perOwner.push({ ownerKey, count: r.saved });
  }

  return { saved, failed, perOwner, ranked };
}
