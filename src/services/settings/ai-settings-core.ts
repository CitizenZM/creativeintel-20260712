/**
 * Pure pieces of the AI engine settings: the settings shape, precedence
 * (DB > env > default), engine ordering and the options the /settings/ai page
 * renders. No database or network access here — see ai-settings.ts.
 */
import { z } from "zod";
import {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_VIDEO_MODEL,
  GLM_IMAGE_MODEL,
  GLM_VIDEO_MODEL,
} from "@/services/video-gen/libtv-pricing";

export const CAPABILITIES = ["text", "vision", "image", "video"] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const PROVIDER_TYPES = ["openai-compatible", "zhipu-paid", "fal"] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

/** Which capabilities each bring-your-own provider type can serve. */
export const PROVIDER_CAPABILITIES: Record<ProviderType, Capability[]> = {
  "openai-compatible": ["text", "vision", "image"],
  "zhipu-paid": ["text", "vision", "image", "video"],
  fal: ["image"],
};

/** Built-in engines per capability, in the order the page lists them. */
export const BUILTIN_ENGINES: Record<Capability, string[]> = {
  text: ["glm", "openai", "gemini", "anthropic", "openrouter"],
  vision: ["glm", "openai", "gemini", "anthropic", "openrouter"],
  image: ["glm", "openai", "fal", "pollinations"],
  video: ["glm", "libtv"],
};

/** Engines that never cost money. */
export const FREE_ENGINES = new Set(["glm", "pollinations"]);

const ENGINE_LABELS: Record<Capability, Record<string, string>> = {
  text: {
    glm: "Zhipu GLM-4.7-Flash (free)",
    openai: "OpenAI",
    gemini: "Google Gemini",
    anthropic: "Anthropic Claude",
    openrouter: "OpenRouter",
  },
  vision: {
    glm: "Zhipu GLM-4.6V-Flash (free)",
    openai: "OpenAI",
    gemini: "Google Gemini",
    anthropic: "Anthropic Claude",
    openrouter: "OpenRouter",
  },
  image: {
    glm: "Zhipu CogView-3-Flash (free)",
    openai: "OpenAI gpt-image-1",
    fal: "fal.ai Flux Schnell",
    pollinations: "Pollinations (free, no key)",
  },
  video: {
    glm: "Zhipu CogVideoX-Flash (free, server-side)",
    libtv: "LibTV (credits, local worker)",
  },
};

/** Env var(s) that "connect" each built-in engine. */
const ENGINE_ENV: Record<string, string[]> = {
  glm: ["ZHIPU_API_KEY", "BIGMODEL_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  fal: ["FAL_KEY"],
};

export interface AiEngineSettings {
  text: string;
  vision: string;
  image: string;
  video: string;
  /** null = follow env AI_COST_MODE. */
  strictFree: boolean | null;
}

export const DEFAULT_AI_SETTINGS: AiEngineSettings = {
  text: "auto",
  vision: "auto",
  image: "auto",
  video: "auto",
  strictFree: null,
};

export const CUSTOM_PREFIX = "custom:";

export function isValidChoice(capability: Capability, value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value === "auto") return true;
  if (/^custom:[A-Za-z0-9_-]{1,64}$/.test(value)) return true;
  return BUILTIN_ENGINES[capability].includes(value);
}

/** Tolerant read of the stored JSON: anything invalid becomes the default. */
export function normalizeSettings(raw: unknown): AiEngineSettings {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: AiEngineSettings = { ...DEFAULT_AI_SETTINGS };
  for (const cap of CAPABILITIES) {
    if (isValidChoice(cap, src[cap])) out[cap] = src[cap] as string;
  }
  if (typeof src.strictFree === "boolean") out.strictFree = src.strictFree;
  return out;
}

/** Zod schema for PUT /api/settings/ai — every field optional (partial update). */
export const settingsPatchSchema = z
  .object({
    text: z.string().refine((v) => isValidChoice("text", v), "Unknown text engine"),
    vision: z.string().refine((v) => isValidChoice("vision", v), "Unknown vision engine"),
    image: z.string().refine((v) => isValidChoice("image", v), "Unknown image engine"),
    video: z.string().refine((v) => isValidChoice("video", v), "Unknown video engine"),
    strictFree: z.boolean().nullable(),
  })
  .partial()
  .strict();

export type StrictFreeSource = "db" | "env" | "default";

/** Precedence: the saved toggle, else env AI_COST_MODE, else off. */
export function resolveStrictFree(
  db: boolean | null | undefined,
  envCostMode: string | undefined
): { effective: boolean; source: StrictFreeSource } {
  if (typeof db === "boolean") return { effective: db, source: "db" };
  if (envCostMode) return { effective: envCostMode === "free", source: "env" };
  return { effective: false, source: "default" };
}

/**
 * The order to try engines in: the chosen one first, then today's order
 * (AI_PROVIDER forcing a single provider still applies to the fallback). In
 * strict free mode only free engines are kept, whatever was chosen.
 */
export function routeOrder(
  choice: string,
  base: string[],
  opts: { strictFree: boolean; freeIds: string[]; forced?: string | null }
): string[] {
  if (opts.strictFree) {
    const free = base.filter((id) => opts.freeIds.includes(id));
    return opts.freeIds.includes(choice) ? [choice, ...free.filter((id) => id !== choice)] : free;
  }
  const today = opts.forced ? [opts.forced] : base;
  if (!choice || choice === "auto") return today;
  return [choice, ...today.filter((id) => id !== choice)];
}

// ─── Custom providers ───────────────────────────────────────────────────────

export interface ProviderModels {
  text?: string;
  vision?: string;
  image?: string;
  video?: string;
}

export interface ProviderPrices {
  inputPerMTokUsd?: number;
  outputPerMTokUsd?: number;
  perImageUsd?: number;
  perClipUsd?: number;
}

/** A provider as the pure code sees it — never includes the key. */
export interface CustomProviderInfo {
  id: string;
  name: string;
  type: ProviderType;
  models: ProviderModels;
  prices: ProviderPrices | null;
}

export function providerServes(p: CustomProviderInfo, capability: Capability): boolean {
  return PROVIDER_CAPABILITIES[p.type].includes(capability) && !!p.models[capability];
}

/** The Studio catalogue name of a bring-your-own video model. */
export function customVideoModelName(p: Pick<CustomProviderInfo, "name" | "models">): string {
  return `${p.name} · ${p.models.video}`;
}

/** Compile defaults (keyframe + clip model) for the chosen render engine. */
export function videoDefaults(
  choice: string,
  strictFree: boolean,
  providers: CustomProviderInfo[]
): { imageModel: string; videoModel: string } {
  const glm = { imageModel: GLM_IMAGE_MODEL, videoModel: GLM_VIDEO_MODEL };
  if (strictFree || choice === "glm") return glm;
  if (choice.startsWith(CUSTOM_PREFIX)) {
    const p = providers.find((x) => x.id === choice.slice(CUSTOM_PREFIX.length));
    if (p && providerServes(p, "video")) return { imageModel: GLM_IMAGE_MODEL, videoModel: customVideoModelName(p) };
  }
  return { imageModel: DEFAULT_IMAGE_MODEL, videoModel: DEFAULT_VIDEO_MODEL };
}

// ─── Options for the settings page ──────────────────────────────────────────

export type EnvAvailability = Record<string, { connected: boolean; envVars: string[] }>;

/** Which built-in engines have their env key. Reports presence only, never values. */
export function envAvailability(env: Record<string, string | undefined>): EnvAvailability {
  const out: EnvAvailability = {};
  for (const [engine, vars] of Object.entries(ENGINE_ENV)) {
    out[engine] = { connected: vars.some((v) => !!env[v]), envVars: vars };
  }
  out.pollinations = { connected: true, envVars: [] };
  out.libtv = { connected: true, envVars: [] };
  return out;
}

export interface EngineOption {
  value: string;
  label: string;
  connected: boolean;
  paid: boolean;
  disabledReason?: string;
}

export function engineOptions(
  capability: Capability,
  ctx: { env: EnvAvailability; providers: CustomProviderInfo[]; strictFree: boolean }
): EngineOption[] {
  const strictReason = "Strict free mode is on — this engine spends money";
  const options: EngineOption[] = [
    { value: "auto", label: "Automatic (today's fallback order)", connected: true, paid: false },
  ];
  for (const id of BUILTIN_ENGINES[capability]) {
    const avail = ctx.env[id] ?? { connected: false, envVars: [] };
    const paid = !FREE_ENGINES.has(id);
    let disabledReason: string | undefined;
    if (!avail.connected) disabledReason = `Not connected — set ${avail.envVars.join(" or ")}`;
    else if (paid && ctx.strictFree) disabledReason = strictReason;
    options.push({ value: id, label: ENGINE_LABELS[capability][id] ?? id, connected: avail.connected, paid, disabledReason });
  }
  for (const p of ctx.providers) {
    if (!providerServes(p, capability)) continue;
    options.push({
      value: `${CUSTOM_PREFIX}${p.id}`,
      label: `${p.name} — ${p.models[capability]}`,
      connected: true,
      paid: true,
      disabledReason: ctx.strictFree ? strictReason : undefined,
    });
  }
  return options;
}

// ─── Bring-your-own provider input (POST /api/settings/ai/providers) ────────

const modelId = z.string().trim().max(120).optional();
const usd = z.number().nonnegative().max(10_000).optional();

export const providerInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Name is required")
      .max(60)
      .refine((v) => !v.includes("·"), "Name can't contain “·”"),
    type: z.enum(PROVIDER_TYPES),
    baseUrl: z.string().trim().max(500).nullable().optional(),
    apiKey: z.string().trim().min(8, "API key looks too short").max(1000),
    models: z.object({ text: modelId, vision: modelId, image: modelId, video: modelId }).strict(),
    prices: z
      .object({ inputPerMTokUsd: usd, outputPerMTokUsd: usd, perImageUsd: usd, perClipUsd: usd })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();

export type ProviderInputBody = z.infer<typeof providerInputSchema>;
