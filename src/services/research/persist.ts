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
  scoreCandidate,
  TOP_N_PER_COMPETITOR,
  type RankedCandidate,
} from "./ranking";
import type { AdCandidate, AdAspect, AdSource } from "./ad-candidate";

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

// ─── Re-rank one owner from what is already stored ───────────────────────────

const SCORED_COLUMNS = {
  id: true,
  adSource: true,
  adEvidence: true,
  adConfidence: true,
  viewCount: true,
  likeCount: true,
  commentCount: true,
  metricsSource: true,
  adSpendEstimate: true,
  durationSec: true,
  aspectRatio: true,
  firstSeenAt: true,
  lastSeenAt: true,
  publishedAt: true,
  rankInOwner: true,
} as const;

type ScoredRow = {
  id: string;
  adSource: string | null;
  adConfidence: number | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  metricsSource: string;
  adSpendEstimate: unknown;
  durationSec: number | null;
  aspectRatio: string | null;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  publishedAt: Date | null;
  rankInOwner: number | null;
};

const ASPECTS = new Set(["9:16", "1:1", "16:9", "4:5"]);

/**
 * Enough of `toContentAssetData`'s inverse to re-score a stored row with the
 * same `scoreCandidate` the research run used — so a worker result is ranked on
 * identical terms to the rows already in the table rather than by a second,
 * divergent scoring rule.
 */
function scoreStoredRow(row: ScoredRow, goalType?: string | null): number {
  const spend = (row.adSpendEstimate ?? {}) as Record<string, unknown>;
  const impressionsLower =
    typeof spend.impressionsLower === "number" ? spend.impressionsLower : undefined;
  const aspect =
    row.aspectRatio && ASPECTS.has(row.aspectRatio)
      ? (row.aspectRatio as AdAspect)
      : undefined;

  const shim = {
    source: (row.adSource ?? "youtube") as AdSource,
    adConfidence: row.adConfidence ?? undefined,
    durationSec: row.durationSec ?? undefined,
    aspect,
    metricsEstimated: row.metricsSource === "AI_INFERRED",
    metrics: {
      views: row.viewCount ?? undefined,
      likes: row.likeCount ?? undefined,
      comments: row.commentCount ?? undefined,
      impressionsLower,
    },
    firstSeen: row.firstSeenAt?.toISOString(),
    lastSeen: row.lastSeenAt?.toISOString(),
    publishedAt: row.publishedAt?.toISOString(),
  } as unknown as AdCandidate;

  return scoreCandidate(shim, goalType).score;
}

async function projectGoalType(projectId: string): Promise<string | null> {
  const p = await prisma.project.findUnique({ where: { id: projectId }, select: { goalType: true } });
  return p?.goalType ?? null;
}

/**
 * Recompute `rankInOwner` for one owner across everything currently stored for
 * it. Used after a worker result lands: the new ad-library rows have to compete
 * with the rows the research run already saved, instead of the owner's Top-N
 * being cleared and replaced by whatever the single task returned.
 */
export async function rerankOwner(
  projectId: string,
  competitorId: string | null,
  topN: number = TOP_N_PER_COMPETITOR
): Promise<{ ranked: number }> {
  const rows = (await prisma.contentAsset.findMany({
    where: { projectId, competitorId },
    select: SCORED_COLUMNS,
  })) as unknown as ScoredRow[];
  if (rows.length === 0) return { ranked: 0 };

  const goalType = await projectGoalType(projectId);
  const ordered = rows
    .map((row) => ({ row, score: scoreStoredRow(row, goalType) }))
    .sort((a, b) => b.score - a.score);

  const nextRank = new Map<string, number | null>();
  ordered.forEach(({ row }, i) => {
    nextRank.set(row.id, i < topN ? i + 1 : null);
  });

  const changed = rows.filter((r) => (nextRank.get(r.id) ?? null) !== r.rankInOwner);
  await pMap(
    changed,
    async (r) => {
      await prisma.contentAsset
        .update({
          where: { id: r.id },
          data: { rankInOwner: nextRank.get(r.id) ?? null },
        })
        .catch(() => undefined);
    },
    { concurrency: 5 }
  );

  return { ranked: Math.min(rows.length, topN) };
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
    goalType: await projectGoalType(params.projectId),
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
