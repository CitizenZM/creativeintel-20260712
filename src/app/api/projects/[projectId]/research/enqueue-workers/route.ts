/**
 * Idempotent backfill for the browser-only ad-library sources.
 *
 * Research enqueues these inside its background job (video-search.ts
 * `dispatchPlan` -> browser-adapters.ts). This route runs the identical enqueue
 * path on demand, for every owner (brand + each competitor), without re-running
 * crawls, keyword extraction, the API adapters, or the AI analysis — so a
 * project whose run predated a fix can be topped up, and the enqueue path can
 * be exercised directly.
 *
 * Idempotent by construction: `enqueueWorkerTask` dedups on the payload hash
 * against any queued/claimed/running task, and a completed task inside the
 * 7-day reuse window is reported as `reused` instead of being re-queued.
 *
 * POST -> { projectId, campaign, adapters, created[], deduped[], reused[], failed[] }
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCampaignPlatform } from "@/lib/campaign-platform";
import { dispatchPlan } from "@/services/research/video-search";
import {
  BROWSER_SOURCE_BY_ADAPTER,
  runBrowserAdapter,
} from "@/services/research/adapters/browser-adapters";
import type { AdapterContext } from "@/services/research/adapters/types";
import type { SearchKeywords } from "@/services/research/keyword-extractor";

export const maxDuration = 60;

/** The browser playbooks search by advertiser name, never by keyword. */
const NO_KEYWORDS: SearchKeywords = {
  brandKeywords: [],
  productKeywords: [],
  categoryKeywords: [],
  adSearchQueries: [],
};

interface TaskOutcome {
  adapter: string;
  source: string;
  advertiser: string;
  competitorId: string | null;
  taskId: string | null;
  note?: string;
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { competitors: true },
  });
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const selection = await prisma.campaignSelection
    .findUnique({ where: { projectId }, select: { platform: true } })
    .catch(() => null);
  const campaign = getCampaignPlatform(selection?.platform);
  const { browser } = dispatchPlan(campaign);

  const owners: { name: string; competitorId: string | null }[] = [
    { name: project.brandName, competitorId: null },
    ...project.competitors.map((c) => ({ name: c.name, competitorId: c.id })),
  ];

  const created: TaskOutcome[] = [];
  const deduped: TaskOutcome[] = [];
  const reused: TaskOutcome[] = [];
  const failed: TaskOutcome[] = [];

  for (const owner of owners) {
    for (const adapterId of browser) {
      const source = BROWSER_SOURCE_BY_ADAPTER[adapterId];
      if (!source) continue;

      const ctx: AdapterContext = {
        ownerName: owner.name,
        competitorId: owner.competitorId,
        projectId,
        keywords: NO_KEYWORDS,
        countries: ["US"],
        limit: 20,
      };

      const { report } = await runBrowserAdapter(source, ctx);
      const outcome: TaskOutcome = {
        adapter: adapterId,
        source,
        advertiser: owner.name,
        competitorId: owner.competitorId,
        taskId: report.taskId ?? null,
        note: report.note,
      };

      if (report.status === "failed") failed.push(outcome);
      else if (report.status === "ran") reused.push(outcome);
      else if (report.note?.startsWith("already queued")) deduped.push(outcome);
      else created.push(outcome);
    }
  }

  return NextResponse.json({
    projectId,
    campaign: campaign?.id ?? null,
    adapters: browser,
    owners: owners.length,
    created,
    deduped,
    reused,
    failed,
  });
}
