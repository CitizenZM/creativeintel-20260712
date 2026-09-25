import { prisma } from "@/lib/db";
import { pMapSettled } from "@/lib/parallel";
import { crawlWebsite, parseHtml as parseCrawlHtml, type CrawlResult } from "./website-crawler";
import { fetchViaWorker } from "./browser-fetch";
import { refreshCompleteness } from "@/services/brand-kit";
import {
  quickBrandUnderstanding,
  extractSearchKeywords,
} from "./keyword-extractor";
import { searchVerifiedVideos } from "./video-search";
import { normalizeCompetitor } from "@/lib/brand-name";
import { classifyAdCandidateGroups, type ClassifyGroup } from "./video-relevance";
import { fetchTikTokForYouFeed } from "./adapters/tiktok-creative-center";
import { getCampaignPlatform } from "@/lib/campaign-platform";
import { rankAndSaveCandidates } from "./persist";
import { TOP_N_PER_COMPETITOR, BRAND_OWNER_KEY, UNOWNED_KEY } from "./ranking";
import { runAnalysisPipeline } from "@/services/ai/analysis-pipeline";
import {
  startStep,
  updateStep,
  completeStep,
  recordStepSources,
  failJob,
  completeJob,
  type JobStep,
  type JobSourceStatus,
} from "./job-progress";
import type { AdCandidate } from "./ad-candidate";
import type { SourceReport } from "./adapters/types";

const CONCURRENCY = Number(process.env.RESEARCH_CONCURRENCY ?? 5);

export const STEP_NAMES = [
  "Crawl websites",
  "Brand understanding",
  "Ad discovery",
  "Rank & save",
  "AI analysis",
] as const;

const AD_DISCOVERY_STEP = STEP_NAMES[2];
const RANK_STEP = STEP_NAMES[3];

function toJobSources(reports: SourceReport[]): JobSourceStatus[] {
  return reports.map((r) => ({
    name: r.name,
    status: r.status,
    count: r.count,
    note: r.note,
  }));
}

export async function runResearch(projectId: string, jobId: string): Promise<void> {
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      // Competitors the user removed are not researched again.
      include: { brand: true, competitors: { where: { excluded: false } } },
    });
    if (!project) throw new Error("Project not found");
    // Older rows may hold a pasted domain as the name; search by the brand.
    project.competitors = project.competitors.map((c) => {
      const n = normalizeCompetitor(c.name, c.url);
      return { ...c, name: n.name, url: n.url };
    });

    // Step 1: parallel website crawls
    await startStep(jobId, "Crawl websites");
    const crawlTargets: { id: string; url: string }[] = [];
    if (project.brandUrl) crawlTargets.push({ id: "brand", url: project.brandUrl });
    for (const comp of project.competitors) {
      if (comp.url) crawlTargets.push({ id: comp.id, url: comp.url });
    }

    const crawlResults = await pMapSettled(
      crawlTargets,
      async (t, i) => {
        let result: CrawlResult;
        try {
          result = await crawlWebsite(t.url);
        } catch (err) {
          // Storefronts that 403 this server's IP still render for a browser —
          // retry through the local worker before giving up on the site.
          const page = await fetchViaWorker(t.url, { projectId }).catch(() => null);
          if (!page?.html) throw err;
          result = parseCrawlHtml(t.url, page.html);
        }
        await updateStep(
          jobId,
          "Crawl websites",
          Math.round(((i + 1) / Math.max(crawlTargets.length, 1)) * 100),
          `Crawled ${t.url}`
        );
        return { id: t.id, result };
      },
      { concurrency: CONCURRENCY }
    );

    // The product page is scraped once at project creation; if that was blocked
    // there is no product truth at all, so retry it here through the worker.
    if (project.productUrl && !project.productPageText) {
      const page = await fetchViaWorker(project.productUrl, { projectId }).catch(() => null);
      if (page?.text) {
        const crawled = parseCrawlHtml(project.productUrl, page.html);
        await prisma.project.update({
          where: { id: projectId },
          data: {
            productPageTitle: project.productPageTitle || crawled.title || null,
            productPageText:
              [crawled.metaDescription, ...crawled.productFeatures].filter(Boolean).join("\n\n") ||
              crawled.bodyText.slice(0, 4000) ||
              null,
            productPageImages:
              (project.productPageImages as unknown[] | null)?.length
                ? (project.productPageImages as never)
                : (crawled.images.slice(0, 8).map((im) => ({ url: im.src, alt: im.alt })) as never),
          },
        });
        // The Brand Kit seeds its summary at project creation from the scrape;
        // if that was blocked the field is still empty, so fill it now that we
        // finally have the copy.
        const summary =
          [crawled.metaDescription, ...crawled.productFeatures].filter(Boolean).join("\n\n") ||
          crawled.bodyText.slice(0, 1800);
        if (summary) {
          await prisma.brandKit
            .updateMany({
              where: { projectId, OR: [{ productSummary: null }, { productSummary: "" }] },
              data: { productSummary: summary.slice(0, 1800) },
            })
            .catch(() => null);
          await refreshCompleteness(projectId).catch(() => null);
        }
        await updateStep(jobId, "Crawl websites", 100, `Recovered product page via local browser`);
      }
    }

    let brandCrawl: CrawlResult | null = null;
    crawlResults.forEach((r, i) => {
      if (r.status !== "fulfilled") return;
      if (r.value.id === "brand") brandCrawl = r.value.result;
      else void crawlTargets[i];
    });
    await completeStep(jobId, "Crawl websites");

    // Step 2: brand understanding + keywords (sequential, cheap)
    await startStep(jobId, "Brand understanding");
    const briefing = [project.briefingText, project.briefingParsed]
      .filter(Boolean)
      .join("\n\n") || undefined;
    const brandContext = await quickBrandUnderstanding(project.brandName, brandCrawl);
    const keywords = await extractSearchKeywords(
      project.brandName,
      brandCrawl,
      project.competitors.map((c) => c.name),
      briefing,
      brandContext
    );
    await completeStep(jobId, "Brand understanding");

    // Step 3: ad discovery — adapters chosen by the campaign platform.
    await startStep(jobId, AD_DISCOVERY_STEP);

    const campaignSelection = await prisma.campaignSelection
      .findUnique({ where: { projectId }, select: { platform: true } })
      .catch(() => null);
    const campaign = getCampaignPlatform(campaignSelection?.platform);

    const brandProductName =
      project.productPageTitle || project.productName || undefined;
    const owners = [
      {
        name: project.brandName,
        competitorId: null as string | null,
        productName: brandProductName,
      },
      ...project.competitors.map((c) => ({
        name: c.name,
        competitorId: c.id as string | null,
        productName: undefined as string | undefined,
      })),
    ];

    // Fetch every owner's candidates first, then classify them together —
    // one shared batch per ~40 candidates instead of one LLM call per owner.
    const perOwner = await pMapSettled(
      owners,
      async (owner, i) => {
        const { candidates, reports } = await searchVerifiedVideos(owner.name, keywords, {
          projectId,
          competitorId: owner.competitorId,
          productName: owner.productName,
          campaign,
          countries: ["US"],
          limit: 20,
          skipClassifier: true,
        });
        await recordStepSources(jobId, AD_DISCOVERY_STEP, toJobSources(reports));
        await updateStep(
          jobId,
          AD_DISCOVERY_STEP,
          Math.round(((i + 1) / Math.max(owners.length, 1)) * 90),
          `${candidates.length} candidates found for ${owner.name}`
        );
        return candidates;
      },
      { concurrency: Math.min(CONCURRENCY, 3) }
    );

    const groups: ClassifyGroup[] = owners.flatMap((owner, i) => {
      const r = perOwner[i];
      return r.status === "fulfilled"
        ? [
            {
              key: String(i),
              candidates: r.value,
              ctx: { brandName: owner.name, productName: owner.productName, keywords },
            },
          ]
        : [];
    });
    const shared = await classifyAdCandidateGroups(groups);
    await recordStepSources(jobId, AD_DISCOVERY_STEP, toJobSources([
      shared.degraded
        ? {
            name: "ad_classifier",
            status: "failed",
            count: 0,
            note: "LLM unavailable for some candidates — fell back to deterministic ad-intent scoring",
          }
        : {
            name: "ad_classifier",
            status: "ran",
            count: shared.classifiedCount,
            note: `${shared.classifiedCount} candidates across ${groups.length} brands in ${shared.calls} shared call${shared.calls === 1 ? "" : "s"}`,
          },
    ]));

    const allCandidates: AdCandidate[] = [];
    const summary: string[] = [];
    for (const g of groups) {
      const classified = shared.byKey.get(g.key) ?? [];
      allCandidates.push(...classified);
      summary.push(`${g.ctx.brandName} ${classified.filter((c) => c.isPaidAd).length}/${classified.length}`);
    }
    await updateStep(jobId, AD_DISCOVERY_STEP, 95, `Paid candidates: ${summary.join(" · ")}`);

    // Brand-agnostic TikTok top-ads feed: stored as unowned corpus, never
    // allowed to occupy a competitor's Top-N slot.
    const forYou = await fetchTikTokForYouFeed({
      industry: project.category ?? undefined,
      region: "US",
      limit: 20,
      advertiserNames: [project.brandName, ...project.competitors.map((c) => c.name)],
    });
    allCandidates.push(...forYou.candidates);
    await recordStepSources(jobId, AD_DISCOVERY_STEP, toJobSources([forYou.report]));

    await completeStep(jobId, AD_DISCOVERY_STEP);

    // Step 4: gate, rank per owner, write ContentAsset rows.
    await startStep(jobId, RANK_STEP);
    const knownOwnerIds = new Set(project.competitors.map((c) => c.id));
    const { saved, failed, perOwner: ownerCounts } = await rankAndSaveCandidates({
      projectId,
      candidates: allCandidates,
      knownOwnerIds,
      topN: TOP_N_PER_COMPETITOR,
    });

    const nameByOwner = new Map<string, string>([
      [BRAND_OWNER_KEY, project.brandName],
      [UNOWNED_KEY, "unattributed feed"],
      ...project.competitors.map((c) => [c.id, c.name] as [string, string]),
    ]);
    await updateStep(
      jobId,
      RANK_STEP,
      100,
      `${saved} assets saved (Top ${TOP_N_PER_COMPETITOR}/owner): ` +
        ownerCounts
          .map((o) => `${nameByOwner.get(o.ownerKey) ?? o.ownerKey} ${o.count}`)
          .join(", ") +
        (failed > 0 ? ` — ${failed} write(s) failed` : "")
    );
    await completeStep(jobId, RANK_STEP);

    // Step 5: AI analysis. The pipeline now reads assets back from the DB;
    // it is no longer handed a video list.
    await startStep(jobId, "AI analysis");
    await runAnalysisPipeline(projectId, {
      jobId,
      onProgress: (step: string, pct: number) => {
        void updateStep(jobId, "AI analysis", pct, step);
      },
    });
    await completeStep(jobId, "AI analysis");

    await prisma.project.update({
      where: { id: projectId },
      data: { status: "ANALYZED" },
    });
    await completeJob(jobId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Research failed";
    await failJob(jobId, msg).catch(() => {});
    await prisma.project
      .update({ where: { id: projectId }, data: { status: "ERROR" } })
      .catch(() => {});
  }
}

export type { JobStep };
