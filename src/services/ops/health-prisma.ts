/**
 * Production data source and side effects for the ops health monitor (health.ts): reads LibtvRun /
 * LibtvJob / SpendEntry / Project / CronHeartbeat, and performs the recovery actions through the same
 * paths the app already uses (driveServerRun, the spend ledger, a conditional job update).
 */
import { prisma } from "@/lib/db";
import { HEALTH_THRESHOLDS, type HealthJob, type HealthSnapshot, type HealthSource, type ProviderStatus, type RecoveryDeps } from "./health";

const ACTIVE = ["approved", "claimed", "running", "assembling"];

type JobRow = {
  id: string;
  runId: string;
  projectId: string;
  kind: string;
  nodeName: string;
  status: string;
  nodeId: string | null;
  modelName: string | null;
  attempts: number;
  startedAt: Date | null;
  updatedAt: Date;
  error: string | null;
  run: { executor: string; status: string };
};
const jobSelect = {
  id: true,
  runId: true,
  projectId: true,
  kind: true,
  nodeName: true,
  status: true,
  nodeId: true,
  modelName: true,
  attempts: true,
  startedAt: true,
  updatedAt: true,
  error: true,
  run: { select: { executor: true, status: true } },
} as const;
const toJob = (j: JobRow): HealthJob => ({ ...j, executor: j.run.executor, runStatus: j.run.status });

export const prismaHealthSource: HealthSource = {
  async snapshot(now: Date): Promise<HealthSnapshot> {
    const t = HEALTH_THRESHOLDS;
    const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
    const [activeRuns, runningJobs, recentJobs, renders, openReservations, settledSpend, budgetProjects, heartbeats] = await Promise.all([
      prisma.libtvRun.findMany({
        where: { status: { in: ACTIVE } },
        select: { id: true, projectId: true, status: true, executor: true, approvedAt: true, startedAt: true, updatedAt: true },
        take: 200,
      }),
      prisma.libtvJob.findMany({ where: { status: "running" }, select: jobSelect, take: 500 }),
      prisma.libtvJob.findMany({
        where: { status: { in: ["completed", "failed"] }, kind: { in: ["image", "video"] }, updatedAt: { gte: hoursAgo(t.failureRate.windowH) } },
        select: jobSelect,
        take: 5000,
      }),
      prisma.libtvRun.findMany({
        where: { status: "completed", completedAt: { gte: hoursAgo(t.renderWindowH) } },
        select: { id: true, projectId: true, executor: true, masterMp4Url: true, qcReport: true, completedAt: true },
        orderBy: { completedAt: "desc" },
        take: 100,
      }),
      prisma.spendEntry.findMany({ where: { actualUsd: null, createdAt: { lt: new Date(now.getTime() - t.reservationMaxAgeMin * 60_000) } }, orderBy: { createdAt: "asc" }, take: 500 }),
      prisma.spendEntry.findMany({
        where: { actualUsd: { gt: 0 }, createdAt: { gte: hoursAgo(24 * t.ratio.windowD) } },
        select: { id: true, projectId: true, runId: true, jobId: true, kind: true, model: true, estUsd: true, actualUsd: true, createdAt: true },
        take: 5000,
      }),
      prisma.project.findMany({ where: { budgetUsd: { not: null } }, select: { id: true, name: true, budgetUsd: true, spentUsd: true }, take: 500 }),
      prisma.cronHeartbeat.findMany(),
    ]);
    const runIds = activeRuns.map((r) => r.id);
    const lastJob = runIds.length ? await prisma.libtvJob.groupBy({ by: ["runId"], where: { runId: { in: runIds } }, _max: { updatedAt: true } }) : [];
    const lastByRun = new Map(lastJob.map((g) => [g.runId, g._max.updatedAt]));
    const jobIds = [...new Set(openReservations.map((e) => e.jobId).filter((x): x is string => !!x))];
    const jobs = jobIds.length ? await prisma.libtvJob.findMany({ where: { id: { in: jobIds } }, select: { id: true, status: true, error: true } }) : [];
    const jobById = new Map(jobs.map((j) => [j.id, j]));
    return {
      now,
      activeRuns: activeRuns.map((r) => ({ ...r, lastJobUpdateAt: lastByRun.get(r.id) ?? null })),
      runningJobs: (runningJobs as JobRow[]).map(toJob),
      recentJobs: (recentJobs as JobRow[]).map(toJob),
      renders,
      openReservations: openReservations.map((e) => ({ ...e, jobStatus: e.jobId ? (jobById.get(e.jobId)?.status ?? null) : null, jobError: e.jobId ? (jobById.get(e.jobId)?.error ?? null) : null })),
      settledSpend,
      budgetProjects,
      heartbeats,
    };
  },
};

/** Read-only provider task status. Engines without a pure status call report "unknown" (never re-queued). */
export async function providerTaskStatus(job: { executor: string; kind: string; nodeId: string }): Promise<ProviderStatus> {
  if (job.kind !== "video") return { status: "unknown" };
  if (job.executor === "matrix") {
    const { getSeedanceTask } = await import("@/services/ai/matrix");
    const t = await getSeedanceTask(job.nodeId);
    return { status: t.status === "SUCCESS" || t.status === "FAIL" ? t.status : "PROCESSING", ...("error" in t && t.error ? { error: t.error } : {}) };
  }
  if (job.executor === "openrouter") {
    const { getOpenRouterVideoTask } = await import("@/services/ai/openrouter-media");
    const t = await getOpenRouterVideoTask(job.nodeId);
    return { status: t.status === "SUCCESS" || t.status === "FAIL" ? t.status : "PROCESSING", ...(t.error ? { error: t.error } : {}) };
  }
  // GLM's status call logs usage on success, ComfyUI's downloads the output, animatic is synchronous,
  // LibTV runs on the Mac worker: none has a side-effect-free probe here.
  return { status: "unknown" };
}

export const prismaRecoveryDeps: RecoveryDeps = {
  async driveRun(executor, runId) {
    const { loadAiSettings } = await import("@/services/settings/ai-settings");
    await loadAiSettings();
    const { driveServerRun } = await import("@/services/video-gen/server-engines");
    return driveServerRun(executor, runId, 90_000);
  },
  async settleReservation(entryId, usd) {
    const { spendLedger } = await import("./budget-guard");
    await (await spendLedger()).settle(entryId, usd);
  },
  providerTaskStatus,
  async requeueJob(job, note) {
    const { count } = await prisma.libtvJob.updateMany({ where: { id: job.id, status: "running", nodeId: job.nodeId }, data: { status: "queued", nodeId: null, error: null } });
    if (count === 1) console.warn(`[ops-health] ${note}`);
    return count === 1;
  },
  async logEvent(e) {
    await prisma.opsEvent.create({ data: { action: e.action, issueCode: e.issueCode, targetType: e.targetType, targetId: e.targetId, projectId: e.projectId, ok: e.ok, detail: e.detail as never } });
  },
};

/** Newest recovery actions, for /status. */
export function recentOpsEvents(take = 15) {
  return prisma.opsEvent.findMany({ orderBy: { createdAt: "desc" }, take });
}
