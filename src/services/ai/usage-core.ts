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
  /** Part of costUsd that is a list-price estimate rather than a logged cost. */
  estimatedUsd: number;
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

const FREE_PROVIDERS = new Set(["glm", "pollinations", "comfyui", "animatic"]);

/**
 * Public list prices (USD) for the built-in env providers, whose calls are
 * logged without a cost. Used only to estimate spend on the settings page —
 * per 1M tokens in / out, or per image (gpt-image-1 at medium, 1024px).
 * Sources: openai.com/api/pricing, anthropic.com/pricing, ai.google.dev/pricing.
 */
export const LIST_PRICES: Record<string, { inPerM?: number; outPerM?: number; perImage?: number }> = {
  "gpt-4o": { inPerM: 2.5, outPerM: 10 },
  "gpt-4o-mini": { inPerM: 0.15, outPerM: 0.6 },
  "gpt-4.1": { inPerM: 2, outPerM: 8 },
  "gpt-4.1-mini": { inPerM: 0.4, outPerM: 1.6 },
  "gpt-image-1": { perImage: 0.042 },
  "claude-sonnet-4-5": { inPerM: 3, outPerM: 15 },
  "claude-haiku-4-5": { inPerM: 1, outPerM: 5 },
  "gemini-2.5-flash": { inPerM: 0.3, outPerM: 2.5 },
  "gemini-2.5-pro": { inPerM: 1.25, outPerM: 10 },
};

/** List-price estimate for a usage bucket, or null when the model isn't listed. */
export function estimateListCost(row: Pick<UsageGroup, "model" | "inputTokens" | "outputTokens" | "images">): number | null {
  const p = LIST_PRICES[row.model];
  if (!p) return null;
  return (
    (row.inputTokens / 1e6) * (p.inPerM ?? 0) + (row.outputTokens / 1e6) * (p.outPerM ?? 0) + row.images * (p.perImage ?? 0)
  );
}

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
        estimatedUsd: 0,
      } satisfies EngineUsage);
    if (!e.models.includes(row.model)) e.models.push(row.model);
    e.calls += row.calls;
    e.inputTokens += row.inputTokens;
    e.outputTokens += row.outputTokens;
    e.images += row.images;
    e.videoMinutes += row.videoSeconds / 60;
    e.costUsd += row.costUsd ?? 0;
    const unpriced = row.calls - row.pricedCalls;
    // Env providers log no cost; estimate a wholly unpriced bucket at list price.
    const estimate = !free && unpriced > 0 && row.pricedCalls === 0 ? estimateListCost(row) : null;
    if (estimate !== null) {
      e.costUsd += estimate;
      e.estimatedUsd += estimate;
    } else if (!free) e.unpricedCalls += unpriced;
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
