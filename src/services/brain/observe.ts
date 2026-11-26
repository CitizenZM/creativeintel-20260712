/**
 * Video Brain observation: everything the Mac brain daemon needs from the database in one read-only call
 * (POST /api/worker/brain {action:"observe"}). The daemon does the thinking; this only gathers.
 */
import { prisma } from "@/lib/db";
import { getProjectStages } from "@/services/project-stages";
import { pMap } from "@/lib/parallel";
import { scanHealth } from "@/services/ops/health";
import { getLearnings, getPolicy } from "./store";

const DAY = 86_400_000;
export const OBSERVE_PROJECT_CAP = 40;
export const OBSERVE_WINDOW_DAYS = 30;

/** start of the current Pacific day as a Date (daily caps follow the Pacific day like Ad Studio's AD_STUDIO_DAILY_USD) */
export function pacificDayStart(now: Date): Date {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const sinceMidnightMs = ((g("hour") * 60 + g("minute")) * 60 + g("second")) * 1000 + now.getMilliseconds();
  return new Date(now.getTime() - sinceMidnightMs);
}

export async function observe(now = new Date()) {
  const since = new Date(now.getTime() - OBSERVE_WINDOW_DAYS * DAY);
  const dayStart = pacificDayStart(now);
  const runs = await prisma.adStudioRun.findMany({
    where: { OR: [{ updatedAt: { gte: since } }, { status: { in: ["queued", "planning", "awaiting_approval", "approved", "generating"] } }] },
    orderBy: { updatedAt: "desc" },
    take: 400,
    select: {
      id: true, projectId: true, storyboardId: true, batchId: true, hookType: true, engine: true, status: true, step: true, progress: true,
      estUsd: true, actualUsd: true, finalMp4Url: true, posterUrl: true, error: true, metrics: true, review: true, autofix: true,
      approvedAt: true, heartbeatAt: true, createdAt: true, updatedAt: true, workerId: true, input: true, estimate: true,
    },
  });
  const activeIds = new Set(runs.map((r) => r.projectId));
  const projects = await prisma.project.findMany({
    where: { archivedAt: null, OR: [{ updatedAt: { gte: since } }, { id: { in: [...activeIds] } }] },
    orderBy: { updatedAt: "desc" },
    take: OBSERVE_PROJECT_CAP,
    select: { id: true, name: true, brandName: true, category: true, status: true, updatedAt: true, createdAt: true, productConfirmedAt: true, budgetUsd: true, spentUsd: true, campaignPlanAt: true, testPlanAt: true, nextRoundAt: true },
  });
  const ids = projects.map((p) => p.id);
  const [stages, perf, spendToday, spend7d, heartbeats, autoEvents, health] = await Promise.all([
    // getProjectStages runs ~12 queries; one project at a time keeps the brain inside a 5-connection pool
    pMap(ids, (id) => getProjectStages(id).then((s) => ({ projectId: id, stages: s.stages.map((x) => ({ id: x.id, state: x.state, action: x.action, detail: x.detail, href: x.href })), next: s.next?.id ?? null })).catch((e) => ({ projectId: id, stages: [], next: null, error: String(e?.message || e) })), { concurrency: 1 }),
    prisma.adPerformance.groupBy({ by: ["projectId"], where: { projectId: { in: ids } }, _max: { dateTo: true, updatedAt: true }, _sum: { impressions: true, views3s: true, thruplays: true, clicks: true, spend: true, conversions: true }, _count: true }),
    prisma.spendEntry.aggregate({ where: { createdAt: { gte: dayStart } }, _sum: { estUsd: true, actualUsd: true } }),
    prisma.spendEntry.groupBy({ by: ["projectId"], where: { projectId: { in: ids }, createdAt: { gte: new Date(now.getTime() - 7 * DAY) } }, _sum: { estUsd: true } }),
    prisma.workerHeartbeat.findMany({ orderBy: { lastSeenAt: "desc" }, take: 20 }),
    prisma.opsEvent.findMany({ where: { action: "brain-auto-approve", createdAt: { gte: dayStart } }, select: { detail: true } }),
    scanHealth({ now }).catch((e) => ({ at: now.toISOString(), ok: false, counts: { critical: 0, warning: 0, info: 0 }, issues: [], heartbeats: [], error: String(e?.message || e) })),
  ]);
  const autoApprovedTodayUsd = autoEvents.reduce((s, e) => s + Number((e.detail as { reserveUsd?: number } | null)?.reserveUsd ?? 0), 0);
  return {
    at: now.toISOString(),
    dayStart: dayStart.toISOString(),
    policy: await getPolicy(),
    learnings: await getLearnings(),
    projects,
    stages,
    runs: runs.map(({ input, estimate, ...r }) => ({
      ...r,
      retries: Number((input as { retries?: number } | null)?.retries ?? 0),
      visualMode: (input as { visualMode?: string } | null)?.visualMode ?? "video",
      fallback: (input as { fallback?: string } | null)?.fallback ?? null,
      estimateModel: (estimate as { model?: string } | null)?.model ?? null,
      estimateScenes: Array.isArray((estimate as { scenes?: unknown[] } | null)?.scenes) ? (estimate as { scenes: unknown[] }).scenes.length : null,
    })),
    perf: perf.map((p) => ({ projectId: p.projectId, rows: p._count, lastDateTo: p._max.dateTo, lastUpdatedAt: p._max.updatedAt, ...p._sum })),
    spend: { todayUsd: Number(spendToday._sum.actualUsd ?? 0) || Number(spendToday._sum.estUsd ?? 0), todayEstUsd: Number(spendToday._sum.estUsd ?? 0), autoApprovedTodayUsd, byProject7d: Object.fromEntries(spend7d.map((s) => [s.projectId, Number(s._sum.estUsd ?? 0)])) },
    heartbeats,
    health,
  };
}
export type Observation = Awaited<ReturnType<typeof observe>>;
