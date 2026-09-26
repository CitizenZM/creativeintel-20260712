/**
 * AiUsage logging and the month's summary for /settings/ai.
 *
 * logAiUsage() is fire-and-forget: it returns immediately, never throws and
 * never rejects into a caller — a missing table or a DB hiccup costs one
 * console warning, not an AI call.
 */
import { monthStartUtc, summarizeUsage, type UsageGroup, type UsageSummary } from "./usage-core";

export interface AiUsageEntry {
  provider: string;
  model: string;
  capability: "text" | "vision" | "image" | "video";
  inputTokens?: number;
  outputTokens?: number;
  images?: number;
  videoSeconds?: number;
  /** null/undefined = price not known. Free engines log 0. */
  costUsd?: number | null;
  projectId?: string | null;
}

let _warned = false;

export function logAiUsage(entry: AiUsageEntry): void {
  if (process.env.VITEST) return;
  try {
    void (async () => {
      const { prisma } = await import("@/lib/db");
      await prisma.aiUsage.create({
        data: {
          provider: entry.provider.slice(0, 80),
          model: entry.model.slice(0, 120),
          capability: entry.capability,
          inputTokens: Math.max(0, Math.round(entry.inputTokens ?? 0)),
          outputTokens: Math.max(0, Math.round(entry.outputTokens ?? 0)),
          images: Math.max(0, Math.round(entry.images ?? 0)),
          videoSeconds: Math.max(0, entry.videoSeconds ?? 0),
          costUsd: entry.costUsd ?? null,
          projectId: entry.projectId ?? null,
        },
      });
    })().catch((err) => {
      if (_warned) return;
      _warned = true;
      console.warn("[ai-usage] could not record usage:", err instanceof Error ? err.message.slice(0, 200) : err);
    });
  } catch {
    // never let bookkeeping break a caller
  }
}

/** This calendar month (UTC) rolled up per engine. */
export async function usageThisMonth(now = new Date()): Promise<UsageSummary & { since: string; error?: string }> {
  const since = monthStartUtc(now);
  try {
    const { prisma } = await import("@/lib/db");
    const rows = await prisma.aiUsage.groupBy({
      by: ["provider", "model", "capability"],
      where: { createdAt: { gte: since } },
      _count: { _all: true, costUsd: true },
      _sum: { inputTokens: true, outputTokens: true, images: true, videoSeconds: true, costUsd: true },
    });
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
    return { ...summarizeUsage(groups), since: since.toISOString() };
  } catch (err) {
    return { ...summarizeUsage([]), since: since.toISOString(), error: err instanceof Error ? err.message : String(err) };
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
      FROM "LibtvJob" j JOIN "LibtvRun" r ON r.id = j."runId"
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
