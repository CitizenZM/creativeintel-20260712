import { prisma } from "@/lib/db";

export interface TraceUsageRow {
  provider: string;
  model: string;
  capability: string;
  stage: string | null;
  runId: string | null;
  latencyMs: number | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  createdAt: Date;
}

export interface TraceJobRow {
  nodeName: string;
  kind: string;
  status: string;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

export function summarizeRunJobs(jobs: TraceJobRow[]) {
  return [...jobs].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map((job) => ({
    nodeName: job.nodeName,
    kind: job.kind,
    status: job.status,
    queuedAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    queueMs: job.startedAt ? Math.max(0, job.startedAt.getTime() - job.createdAt.getTime()) : null,
    executionMs: job.startedAt && job.completedAt ? Math.max(0, job.completedAt.getTime() - job.startedAt.getTime()) : null,
  }));
}

export function summarizeAiTrace(rows: TraceUsageRow[]) {
  const stages = new Map<string, { calls: number; inputTokens: number; outputTokens: number; knownCostUsd: number; unpricedCalls: number; modelLatencyMs: number }>();
  for (const row of rows) {
    const key = row.stage ?? "unclassified";
    const stage = stages.get(key) ?? { calls: 0, inputTokens: 0, outputTokens: 0, knownCostUsd: 0, unpricedCalls: 0, modelLatencyMs: 0 };
    stage.calls++;
    stage.inputTokens += row.inputTokens;
    stage.outputTokens += row.outputTokens;
    stage.knownCostUsd += row.costUsd ?? 0;
    if (row.costUsd === null) stage.unpricedCalls++;
    stage.modelLatencyMs += row.latencyMs ?? 0;
    stages.set(key, stage);
  }
  const timeline = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map((row) => ({
    at: row.createdAt.toISOString(), stage: row.stage ?? "unclassified", runId: row.runId,
    provider: row.provider, model: row.model, capability: row.capability,
    latencyMs: row.latencyMs, inputTokens: row.inputTokens, outputTokens: row.outputTokens, costUsd: row.costUsd,
  }));
  return { totalCalls: rows.length, stages: Object.fromEntries(stages), timeline };
}

/** Project-scoped, read-only call waterfall; bounded to avoid returning an unbounded run history. */
export async function aiTraceReport(projectId: string, traceId: string) {
  const usageQuery = prisma.aiUsage.findMany({
    where: { projectId, OR: [{ traceId }, { runId: traceId }] }, orderBy: { createdAt: "asc" }, take: 500,
    select: { provider: true, model: true, capability: true, stage: true, runId: true, latencyMs: true, inputTokens: true, outputTokens: true, costUsd: true, createdAt: true },
  });
  const [usage, run] = await Promise.all([
    usageQuery.then((rows) => ({ rows, available: true })).catch(() => ({ rows: [] as TraceUsageRow[], available: false })),
    prisma.libtvRun.findFirst({ where: { id: traceId, projectId }, select: {
      status: true, createdAt: true, startedAt: true, completedAt: true,
      jobs: { select: { nodeName: true, kind: true, status: true, createdAt: true, startedAt: true, completedAt: true } },
    } }),
  ]);
  return {
    traceId, projectId, usageAvailable: usage.available, truncated: usage.rows.length === 500,
    ...summarizeAiTrace(usage.rows),
    run: run ? {
      status: run.status, createdAt: run.createdAt.toISOString(), startedAt: run.startedAt?.toISOString() ?? null,
      completedAt: run.completedAt?.toISOString() ?? null, jobs: summarizeRunJobs(run.jobs),
    } : null,
  };
}
