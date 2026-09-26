/**
 * Everything /settings/ai renders, in one server-side read. Contains no
 * secrets: env keys are reported as present/absent, provider keys as their
 * last 4 characters.
 */
import OpenAI from "openai";
import { settingsKeyFromEnv } from "@/lib/settings-crypto";
import { getConfiguredModelLabel } from "@/services/ai/claude-client";
import {
  APP_VIDEO_CONCURRENCY,
  ASSUMED_FLASH_CLIP_SECONDS,
  COGVIEW_SECONDS_PER_IMAGE,
  estimateHourlyCeiling,
  FREE_MODEL_FACTS,
  type FreeModelFacts,
} from "@/services/ai/free-allowance";
import { measuredGlmClipSeconds, usageThisMonth } from "@/services/ai/usage";
import type { UsageSummary } from "@/services/ai/usage-core";
import { isZhipuConfigured, ZHIPU_FREE } from "@/services/ai/zhipu";
import {
  CAPABILITIES,
  engineOptions,
  envAvailability,
  resolveStrictFree,
  type AiEngineSettings,
  type Capability,
  type EngineOption,
  type StrictFreeSource,
} from "./ai-settings-core";
import { loadAiSettings, toProviderView, type ProviderView, type ResolvedProvider } from "./ai-settings";

export interface FreeAllowanceView {
  facts: FreeModelFacts[];
  video: {
    concurrency: number;
    clipSeconds: number;
    measuredSecondsPerClip: number | null;
    samples: number;
    clipsPerHour: number | null;
    minutesPerHour: number | null;
  };
  image: { secondsMin: number; secondsMax: number; perSlotPerHourLow: number; perSlotPerHourHigh: number };
}

export interface AiSettingsView {
  settings: AiEngineSettings;
  strictFree: { effective: boolean; source: StrictFreeSource; envValue: string | null };
  capabilities: Record<Capability, EngineOption[]>;
  providers: ProviderView[];
  encryptionReady: boolean;
  zhipuConfigured: boolean;
  activeTextModel: string;
  usage: UsageSummary & { since: string; error?: string };
  allowance: FreeAllowanceView;
  dbError?: string;
}

export async function getAiSettingsView(): Promise<AiSettingsView> {
  const snap = await loadAiSettings();
  const strict = resolveStrictFree(snap.settings.strictFree, process.env.AI_COST_MODE);
  const env = envAvailability(process.env);
  const capabilities = Object.fromEntries(
    CAPABILITIES.map((c) => [c, engineOptions(c, { env, providers: snap.providers, strictFree: strict.effective })])
  ) as Record<Capability, EngineOption[]>;

  const [usage, clip] = await Promise.all([usageThisMonth(), measuredGlmClipSeconds()]);
  const video = estimateHourlyCeiling({
    concurrency: APP_VIDEO_CONCURRENCY,
    secondsPerItem: clip.seconds,
    secondsOfVideoPerItem: ASSUMED_FLASH_CLIP_SECONDS,
  });

  return {
    settings: snap.settings,
    strictFree: { ...strict, envValue: process.env.AI_COST_MODE ?? null },
    capabilities,
    providers: snap.providers.map(toProviderView),
    encryptionReady: !!settingsKeyFromEnv(),
    zhipuConfigured: isZhipuConfigured(),
    activeTextModel: getConfiguredModelLabel(),
    usage,
    allowance: {
      facts: FREE_MODEL_FACTS,
      video: {
        concurrency: APP_VIDEO_CONCURRENCY,
        clipSeconds: ASSUMED_FLASH_CLIP_SECONDS,
        measuredSecondsPerClip: clip.seconds,
        samples: clip.samples,
        clipsPerHour: video.itemsPerHour,
        minutesPerHour: video.videoMinutesPerHour,
      },
      image: {
        secondsMin: COGVIEW_SECONDS_PER_IMAGE.min,
        secondsMax: COGVIEW_SECONDS_PER_IMAGE.max,
        perSlotPerHourLow: estimateHourlyCeiling({ concurrency: 1, secondsPerItem: COGVIEW_SECONDS_PER_IMAGE.max }).itemsPerHour ?? 0,
        perSlotPerHourHigh: estimateHourlyCeiling({ concurrency: 1, secondsPerItem: COGVIEW_SECONDS_PER_IMAGE.min }).itemsPerHour ?? 0,
      },
    },
    dbError: snap.dbError,
  };
}

/** "Test connection": list models, else a 1-token completion. Never echoes the key. */
export async function testProviderConnection(p: ResolvedProvider): Promise<{ ok: boolean; message: string }> {
  if (!p.apiKey) return { ok: false, message: p.keyError ?? "Key unavailable" };

  if (p.type === "fal") {
    try {
      const res = await fetch("https://api.fal.ai/v1/models?limit=1", {
        headers: { Authorization: `Key ${p.apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) return { ok: true, message: "fal.ai accepted the key." };
      if (res.status === 401 || res.status === 403) return { ok: false, message: `fal.ai rejected the key (HTTP ${res.status}).` };
      return { ok: false, message: `Could not verify with fal.ai (HTTP ${res.status}) — try a generation to confirm.` };
    } catch (err) {
      return { ok: false, message: `Could not reach fal.ai: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  const client = new OpenAI({ apiKey: p.apiKey, baseURL: p.baseUrl ?? undefined, timeout: 15_000, maxRetries: 0 });
  const status = (err: unknown) => (err as { status?: number } | null)?.status;
  try {
    const page = await client.models.list();
    const ids = page.data.map((m) => m.id);
    const wanted = Object.values(p.models).filter(Boolean) as string[];
    const missing = ids.length ? wanted.filter((id) => !ids.includes(id)) : [];
    return {
      ok: true,
      message:
        `Connected — the API lists ${ids.length} model${ids.length === 1 ? "" : "s"}.` +
        (missing.length ? ` Not in that list: ${missing.join(", ")} (it may still work).` : ""),
    };
  } catch (err) {
    if (status(err) === 401 || status(err) === 403) {
      return { ok: false, message: `The API rejected the key (HTTP ${status(err)}).` };
    }
  }
  // No /models endpoint: a 1-token completion. On Zhipu, use the free text model.
  const model = p.type === "zhipu-paid" ? ZHIPU_FREE.text : (p.models.text ?? p.models.vision);
  if (!model) return { ok: false, message: "The API has no /models endpoint and no text model is set to test with." };
  try {
    await client.chat.completions.create({ model, max_tokens: 1, messages: [{ role: "user", content: "ping" }] });
    return { ok: true, message: `Connected — a 1-token completion on ${model} succeeded.` };
  } catch (err) {
    const s = status(err);
    // Never echo the key back, even if the provider quotes it in an error.
    const msg = (err instanceof Error ? err.message : String(err)).split(p.apiKey).join("•••");
    return { ok: false, message: `Test completion on ${model} failed${s ? ` (HTTP ${s})` : ""}: ${msg.slice(0, 200)}` };
  }
}
