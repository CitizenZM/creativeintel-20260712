/**
 * AiUsage logging and the month's summary for /settings/ai.
 *
 * logAiUsage() returns a promise so financially important call sites can wait
 * for persistence. Callers that do not await it still get a caught warning.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { monthStartUtc, summarizeUsage, type UsageGroup, type UsageSummary } from "./usage-core";
import { currentAiTrace } from "./usage-context";
import { sqlTable } from "@/lib/sql-table";

export interface AiUsageEntry {
  provider: string;
  model: string;
  capability: "text" | "vision" | "image" | "video";
  requestId?: string;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  images?: number;
  videoSeconds?: number;
  /** null/undefined = price not known. Free engines log 0. */
  costUsd?: number | null;
  projectId?: string | null;
  traceId?: string;
  stage?: string;
  runId?: string;
}

let _warned = false;

/** Calls logged inside captureAiUsage(fn) are also handed to that caller (the spend guard reconciles with them). */
const _sink = new AsyncLocalStorage<AiUsageEntry[]>();

export function captureAiUsage<T>(entries: AiUsageEntry[], fn: () => Promise<T>): Promise<T> {
  return _sink.run(entries, fn);
}

export async function logAiUsage(entry: AiUsageEntry): Promise<void> {
  const trace = currentAiTrace();
  const traced = { ...trace, ...entry };
  _sink.getStore()?.push(traced);
  if (process.env.VITEST) return;
  try {
    const { prisma } = await import("@/lib/db");
    const legacyData = {
      provider: traced.provider.slice(0, 80),
      model: traced.model.slice(0, 120),
      capability: traced.capability,
      requestId: traced.requestId?.slice(0, 160) ?? null,
      latencyMs: traced.latencyMs == null ? null : Math.max(0, Math.round(traced.latencyMs)),
      inputTokens: Math.max(0, Math.round(traced.inputTokens ?? 0)),
      outputTokens: Math.max(0, Math.round(traced.outputTokens ?? 0)),
      images: Math.max(0, Math.round(traced.images ?? 0)),
      videoSeconds: Math.max(0, traced.videoSeconds ?? 0),
      costUsd: traced.costUsd ?? null,
      projectId: traced.projectId ?? null,
    };
    try {
      await prisma.aiUsage.create({ data: {
        ...legacyData,
        traceId: traced.traceId?.slice(0, 120) ?? null,
        stage: traced.stage?.slice(0, 80) ?? null,
        runId: traced.runId?.slice(0, 120) ?? null,
      }, select: { id: true } });
    } catch (err) {
      // Preview deployments can run before the additive trace migration.
      if ((err as { code?: string }).code !== "P2022") throw err;
      await prisma.aiUsage.create({ data: legacyData, select: { id: true } });
    }
  } catch (err) {
    if (_warned) return;
    _warned = true;
    console.warn("[ai-usage] could not record usage:", err instanceof Error ? err.message.slice(0, 200) : err);
  }
}

export interface UsageLatency {
  provider: string;
  model: string;
  samples: number;
  p50Ms: number;
  p95Ms: number;
}

/** This calendar month (UTC) rolled up per engine, with a bounded recent latency sample. */
export async function usageThisMonth(now = new Date()): Promise<UsageSummary & { since: string; latency: UsageLatency[]; error?: string }> {
  const since = monthStartUtc(now);
  try {
    const { prisma } = await import("@/lib/db");
    const [rows, timings] = await Promise.all([prisma.aiUsage.groupBy({
      by: ["provider", "model", "capability"],
      where: { createdAt: { gte: since } },
      _count: { _all: true, costUsd: true },
      _sum: { inputTokens: true, outputTokens: true, images: true, videoSeconds: true, costUsd: true },
    }), prisma.aiUsage.findMany({
      where: { createdAt: { gte: since }, latencyMs: { not: null } },
      orderBy: { createdAt: "desc" }, take: 1000,
      select: { provider: true, model: true, latencyMs: true },
    })]);
    const groups: UsageGroup[] = rows.map((r) => ({
      provider: r.provider,
      model: r.model,
      capability: r.capability,
      calls: r._count._all,
      pricedCalls: r._count.costUsd,
      inputTokens: r._sum.inputTokens ?? 0,
      outputTokens: r._sum.outputTokens ?? 0,
      images: r._sum.images ?? 0,
      videoSeconds: r._sum.videoSeconds ?? 0,
      costUsd: r._sum.costUsd ?? null,
    }));
    const byModel = new Map<string, number[]>();
    for (const row of timings) {
      const key = `${row.provider}\0${row.model}`;
      const values = byModel.get(key) ?? [];
      if (row.latencyMs !== null) values.push(row.latencyMs);
      byModel.set(key, values);
    }
    const latency: UsageLatency[] = [...byModel].map(([key, values]) => {
      values.sort((a, b) => a - b);
      const [provider, model] = key.split("\0");
      return { provider, model, samples: values.length, p50Ms: values[Math.ceil(values.length * 0.5) - 1], p95Ms: values[Math.ceil(values.length * 0.95) - 1] };
    }).sort((a, b) => b.samples - a.samples);
    return { ...summarizeUsage(groups), latency, since: since.toISOString() };
  } catch (err) {
    return { ...summarizeUsage([]), latency: [], since: since.toISOString(), error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Measured end-to-end seconds per free CogVideoX-Flash clip (claim → done,
 * including the executor's polling interval), from completed GLM runs.
 */
export async function measuredGlmClipSeconds(): Promise<{ seconds: number | null; samples: number }> {
  try {
    const { prisma } = await import("@/lib/db");
    const rows = await prisma.$queryRaw<{ avg: number | null; n: bigint }[]>`
      SELECT avg(extract(epoch FROM j."completedAt" - j."startedAt"))::float AS avg, count(*) AS n
      FROM ${sqlTable("LibtvJob")} j JOIN ${sqlTable("LibtvRun")} r ON r.id = j."runId"
      WHERE r.executor = 'glm' AND j.kind = 'video' AND j.status = 'completed'
        AND j."startedAt" IS NOT NULL AND j."completedAt" IS NOT NULL
        AND (j.settings->>'zhipuModel') IS NULL
    `;
    const n = Number(rows[0]?.n ?? 0);
    return { seconds: n ? Math.round(rows[0]?.avg ?? 0) || null : null, samples: n };
  } catch {
    return { seconds: null, samples: 0 };
  }
}
