/**
 * Server side of the AI engine settings: the saved choices (AppSetting
 * "ai.engines") and bring-your-own providers (ModelProvider), read through a
 * ~30 s in-memory cache that save/delete invalidate.
 *
 * Loading also pushes the saved strict-free toggle into cost-mode's sync
 * accessor and registers paid Zhipu video models with the Studio catalogue,
 * so `await loadAiSettings()` at the top of a route or AI call is all a
 * caller needs. It never throws: without a database (or before `prisma db
 * push` created the tables) it falls back to the defaults, i.e. env behaviour.
 *
 * Decrypted keys stay in this process's memory; nothing here returns them to
 * a client — use toProviderView() for anything that leaves the server.
 */
import { setStrictFreeOverride } from "@/lib/cost-mode";
import { assertSafeUrl } from "@/lib/safe-fetch";
import { decryptSecret, encryptSecret, last4, settingsKeyFromEnv } from "@/lib/settings-crypto";
import { setExtraVideoModels, zhipuPaidVideoModel } from "@/services/video-gen/libtv-pricing";
import {
  customVideoModelName,
  DEFAULT_AI_SETTINGS,
  normalizeSettings,
  PROVIDER_CAPABILITIES,
  providerServes,
  type AiEngineSettings,
  type Capability,
  type CustomProviderInfo,
  type ProviderModels,
  type ProviderPrices,
  type ProviderType,
} from "./ai-settings-core";

export const AI_SETTINGS_KEY = "ai.engines";
const TTL_MS = 30_000;

export interface ResolvedProvider extends CustomProviderInfo {
  baseUrl: string | null;
  keyLast4: string;
  /** Decrypted key — server memory only. Null when it can't be decrypted. */
  apiKey: string | null;
  keyError?: string;
  createdAt: string;
}

export interface AiSettingsSnapshot {
  settings: AiEngineSettings;
  providers: ResolvedProvider[];
  loadedAt: number;
  dbError?: string;
}

let _snap: AiSettingsSnapshot | null = null;
let _inflight: Promise<AiSettingsSnapshot> | null = null;
let _warned = false;

async function db() {
  return (await import("@/lib/db")).prisma;
}

type ProviderRow = {
  id: string;
  name: string;
  type: string;
  baseUrl: string | null;
  apiKeyEnc: string;
  keyLast4: string;
  models: unknown;
  prices: unknown;
  createdAt: Date;
};

function resolveRow(row: ProviderRow, key: Buffer | null): ResolvedProvider {
  let apiKey: string | null = null;
  let keyError: string | undefined;
  if (!key) keyError = "SETTINGS_ENCRYPTION_KEY is not set — the stored key can't be decrypted";
  else {
    try {
      apiKey = decryptSecret(row.apiKeyEnc, key);
    } catch (err) {
      keyError = err instanceof Error ? err.message : String(err);
    }
  }
  return {
    id: row.id,
    name: row.name,
    type: (["openai-compatible", "zhipu-paid", "fal"].includes(row.type) ? row.type : "openai-compatible") as ProviderType,
    baseUrl: row.baseUrl,
    keyLast4: row.keyLast4,
    models: (row.models ?? {}) as ProviderModels,
    prices: (row.prices ?? null) as ProviderPrices | null,
    apiKey,
    keyError,
    createdAt: row.createdAt.toISOString(),
  };
}

function apply(snap: AiSettingsSnapshot): AiSettingsSnapshot {
  _snap = snap;
  setStrictFreeOverride(snap.settings.strictFree);
  setExtraVideoModels(
    snap.providers
      .filter((p) => p.type === "zhipu-paid" && providerServes(p, "video"))
      .map((p) =>
        zhipuPaidVideoModel({
          name: customVideoModelName(p),
          zhipuModel: p.models.video!,
          providerId: p.id,
          usdPerClip: p.prices?.perClipUsd ?? 0,
        })
      )
  );
  return snap;
}

/** Cached settings + providers. Safe to call on every request. */
export async function loadAiSettings(opts: { fresh?: boolean } = {}): Promise<AiSettingsSnapshot> {
  if (!opts.fresh && _snap && Date.now() - _snap.loadedAt < TTL_MS) return _snap;
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const prisma = await db();
      const [row, rows] = await Promise.all([
        prisma.appSetting.findUnique({ where: { key: AI_SETTINGS_KEY } }),
        prisma.modelProvider.findMany({ orderBy: { createdAt: "asc" } }),
      ]);
      const key = settingsKeyFromEnv();
      _warned = false;
      return apply({
        settings: normalizeSettings(row?.value),
        providers: rows.map((r) => resolveRow(r, key)),
        loadedAt: Date.now(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!_warned) console.warn(`[ai-settings] could not read settings, using env defaults: ${msg.slice(0, 200)}`);
      _warned = true;
      return apply({ settings: { ...DEFAULT_AI_SETTINGS }, providers: [], loadedAt: Date.now(), dbError: msg });
    }
  })().finally(() => {
    _inflight = null;
  });
  return _inflight;
}

/** Last loaded snapshot (defaults before the first load). Sync, for hot paths. */
export function cachedAiSettings(): AiSettingsSnapshot {
  return _snap ?? { settings: { ...DEFAULT_AI_SETTINGS }, providers: [], loadedAt: 0 };
}

export function invalidateAiSettings(): void {
  _snap = null;
}

export function cachedProvider(id: string): ResolvedProvider | null {
  return cachedAiSettings().providers.find((p) => p.id === id) ?? null;
}

export async function saveAiSettings(patch: Partial<AiEngineSettings>): Promise<AiEngineSettings> {
  const prisma = await db();
  const row = await prisma.appSetting.findUnique({ where: { key: AI_SETTINGS_KEY } });
  const next = normalizeSettings({ ...normalizeSettings(row?.value), ...patch });
  await prisma.appSetting.upsert({
    where: { key: AI_SETTINGS_KEY },
    create: { key: AI_SETTINGS_KEY, value: { ...next } },
    update: { value: { ...next } },
  });
  invalidateAiSettings();
  await loadAiSettings({ fresh: true });
  return next;
}

// ─── Providers ──────────────────────────────────────────────────────────────

export class ProviderInputError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
    this.name = "ProviderInputError";
  }
}

export const ZHIPU_PAID_BASE_URL = "https://open.bigmodel.cn/api/paas/v4/";
export const FAL_BASE_URL = "https://fal.run/";

export interface ProviderInput {
  name: string;
  type: ProviderType;
  baseUrl?: string | null;
  apiKey: string;
  models: ProviderModels;
  prices?: ProviderPrices | null;
}

/** What the browser may see of a provider: no key, only its last 4 chars. */
export interface ProviderView {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string | null;
  keyLast4: string;
  keyError?: string;
  models: ProviderModels;
  prices: ProviderPrices | null;
  capabilities: Capability[];
  createdAt: string;
}

export function toProviderView(p: ResolvedProvider): ProviderView {
  return {
    id: p.id,
    name: p.name,
    type: p.type,
    baseUrl: p.baseUrl,
    keyLast4: p.keyLast4,
    keyError: p.keyError,
    models: p.models,
    prices: p.prices,
    capabilities: PROVIDER_CAPABILITIES[p.type].filter((c) => !!p.models[c]),
    createdAt: p.createdAt,
  };
}

export function defaultBaseUrl(type: ProviderType): string | null {
  if (type === "zhipu-paid") return ZHIPU_PAID_BASE_URL;
  if (type === "fal") return FAL_BASE_URL;
  return null;
}

export async function createProvider(input: ProviderInput): Promise<ProviderView> {
  const key = settingsKeyFromEnv();
  if (!key) {
    throw new ProviderInputError(
      "SETTINGS_ENCRYPTION_KEY is not set (or is not 32 bytes of base64/hex). API keys are only stored encrypted, so nothing was saved — set it in the environment and redeploy.",
      503
    );
  }
  const models: ProviderModels = {};
  for (const cap of PROVIDER_CAPABILITIES[input.type]) {
    const id = input.models[cap]?.trim();
    if (id) models[cap] = id;
  }
  if (!Object.keys(models).length) {
    throw new ProviderInputError(`Give at least one model id for a ${input.type} provider.`);
  }
  if (models.video && !(input.prices?.perClipUsd && input.prices.perClipUsd > 0)) {
    throw new ProviderInputError("A paid video model needs its price per clip (USD) so runs show their real cost.");
  }
  const baseUrl = input.baseUrl?.trim() || defaultBaseUrl(input.type);
  if (!baseUrl) throw new ProviderInputError("An OpenAI-compatible provider needs its base URL.");
  let url: URL;
  try {
    url = await assertSafeUrl(baseUrl);
  } catch (err) {
    throw new ProviderInputError(`Base URL rejected: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (url.protocol !== "https:") throw new ProviderInputError("Base URL must use https.");

  const prisma = await db();
  const existing = await prisma.modelProvider.findUnique({ where: { name: input.name } });
  if (existing) throw new ProviderInputError(`A provider named "${input.name}" already exists.`, 409);
  const row = await prisma.modelProvider.create({
    data: {
      name: input.name,
      type: input.type,
      baseUrl: url.toString(),
      apiKeyEnc: encryptSecret(input.apiKey, key),
      keyLast4: last4(input.apiKey),
      models: { ...models },
      prices: input.prices ? { ...input.prices } : undefined,
    },
  });
  invalidateAiSettings();
  await loadAiSettings({ fresh: true });
  return toProviderView(resolveRow(row, key));
}

/** Deletes a provider and resets any engine choice that pointed at it. */
export async function deleteProvider(id: string): Promise<boolean> {
  const prisma = await db();
  const { count } = await prisma.modelProvider.deleteMany({ where: { id } });
  const snap = await loadAiSettings({ fresh: true });
  const choice = `custom:${id}`;
  const patch: Partial<AiEngineSettings> = {};
  for (const cap of ["text", "vision", "image", "video"] as const) {
    if (snap.settings[cap] === choice) patch[cap] = "auto";
  }
  if (Object.keys(patch).length) await saveAiSettings(patch);
  invalidateAiSettings();
  await loadAiSettings({ fresh: true });
  return count > 0;
}

/**
 * Key for a bring-your-own Zhipu provider (paid video in the GLM executor).
 * undefined = no provider → the free env key. Throws when the provider is
 * gone or its key can't be decrypted, so the job fails with a clear reason.
 */
export async function zhipuAuthFor(
  providerId: string | undefined | null
): Promise<{ apiKey: string; baseUrl: string | null } | undefined> {
  if (!providerId) return undefined;
  await loadAiSettings();
  const p = cachedProvider(providerId);
  if (!p) throw new Error("The paid model's provider was deleted in Settings → AI engines");
  if (!p.apiKey) throw new Error(`Provider "${p.name}": ${p.keyError ?? "key unavailable"}`);
  return { apiKey: p.apiKey, baseUrl: p.baseUrl };
}
