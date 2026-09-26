/** Pure usage maths for the /settings/ai page (aggregation of AiUsage rows). */
import type { ProviderPrices } from "@/services/settings/ai-settings-core";

/** One (provider, model, capability) bucket, as the groupBy query returns it. */
export interface UsageGroup {
  provider: string;
  model: string;
  capability: string;
  calls: number;
  /** Calls whose costUsd is known (non-null). */
  pricedCalls: number;
  inputTokens: number;
  outputTokens: number;
  images: number;
  videoSeconds: number;
  costUsd: number | null;
}

export interface EngineUsage {
  provider: string;
  models: string[];
  free: boolean;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  images: number;
  videoMinutes: number;
  costUsd: number;
  unpricedCalls: number;
}

export interface UsageSummary {
  engines: EngineUsage[];
  totals: {
    inputTokens: number;
    outputTokens: number;
    images: number;
    videoMinutes: number;
    paidSpendUsd: number;
    unpricedPaidCalls: number;
    freeCalls: number;
  };
}

const FREE_PROVIDERS = new Set(["glm", "pollinations"]);

export function isFreeProvider(provider: string): boolean {
  return FREE_PROVIDERS.has(provider);
}

export function summarizeUsage(groups: UsageGroup[]): UsageSummary {
  const byProvider = new Map<string, EngineUsage>();
  for (const row of groups) {
    const free = isFreeProvider(row.provider);
    const e =
      byProvider.get(row.provider) ??
      ({
        provider: row.provider,
        models: [],
        free,
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        images: 0,
        videoMinutes: 0,
        costUsd: 0,
        unpricedCalls: 0,
      } satisfies EngineUsage);
    if (!e.models.includes(row.model)) e.models.push(row.model);
    e.calls += row.calls;
    e.inputTokens += row.inputTokens;
    e.outputTokens += row.outputTokens;
    e.images += row.images;
    e.videoMinutes += row.videoSeconds / 60;
    e.costUsd += row.costUsd ?? 0;
    if (!free) e.unpricedCalls += row.calls - row.pricedCalls;
    byProvider.set(row.provider, e);
  }

  const engines = [...byProvider.values()].sort((a, b) => b.calls - a.calls);
  const totals = engines.reduce(
    (t, e) => ({
      inputTokens: t.inputTokens + e.inputTokens,
      outputTokens: t.outputTokens + e.outputTokens,
      images: t.images + e.images,
      videoMinutes: t.videoMinutes + e.videoMinutes,
      paidSpendUsd: t.paidSpendUsd + (e.free ? 0 : e.costUsd),
      unpricedPaidCalls: t.unpricedPaidCalls + e.unpricedCalls,
      freeCalls: t.freeCalls + (e.free ? e.calls : 0),
    }),
    { inputTokens: 0, outputTokens: 0, images: 0, videoMinutes: 0, paidSpendUsd: 0, unpricedPaidCalls: 0, freeCalls: 0 }
  );
  return { engines, totals };
}

/** USD for a completion at per-million-token prices; null when not priced. */
export function costForTokens(
  prices: ProviderPrices | null | undefined,
  inputTokens: number,
  outputTokens: number
): number | null {
  if (!prices || (prices.inputPerMTokUsd == null && prices.outputPerMTokUsd == null)) return null;
  return (inputTokens * (prices.inputPerMTokUsd ?? 0) + outputTokens * (prices.outputPerMTokUsd ?? 0)) / 1_000_000;
}

export function monthStartUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
