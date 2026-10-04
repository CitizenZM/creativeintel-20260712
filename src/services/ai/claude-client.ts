import OpenAI, { APIConnectionError } from "openai";
import { jsonrepair } from "jsonrepair";
import { ZodSchema } from "zod";
import { isStrictFree, paidFallbackAllowed } from "@/lib/cost-mode";
import { ZHIPU_BASE_URL, ZHIPU_FREE, zhipuKey } from "./zhipu";
import { cachedAiSettings, cachedProvider, loadAiSettings } from "@/services/settings/ai-settings";
import { CUSTOM_PREFIX, routeOrder, visionModelChoice } from "@/services/settings/ai-settings-core";
import { logAiUsage } from "./usage";
import { costForTokens } from "./usage-core";

// Route priority: OpenAI → Gemini → Anthropic → OpenRouter. Each provider is
// tried in order while its key is present and not disabled; the first 401/403
// from a provider permanently disables it for this process (module-level, not
// persisted) so a rotated/revoked key degrades to the next provider instead of
// failing every call. Set AI_PROVIDER=openai|gemini|anthropic|openrouter to
// force a single provider (no fallthrough to the others).
//
// Every call also names a tier — fast (classification, bulk checks),
// standard (writing), deep (teardowns, synthesis) — and each provider maps
// tiers to models, overridable per tier by env. Cheap work stops paying for
// the big model.
//
// Settings → AI engines (/settings/ai) can pick the engine per capability
// (text, vision) — a built-in provider or a bring-your-own "custom:<id>" one.
// The chosen engine is tried first, then today's order as the fallback;
// strict free mode still narrows everything to GLM.

type ProviderName = "openai" | "gemini" | "anthropic" | "openrouter" | "glm";
/** A built-in provider or a bring-your-own one ("custom:<ModelProvider.id>"). */
type Route = ProviderName | `custom:${string}`;
type TextCapability = "text" | "vision";
const BASE_ORDER: ProviderName[] = ["openai", "gemini", "anthropic", "openrouter", "glm"];
export type ModelTier = "fast" | "standard" | "deep";

const ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1/";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";
const GEMINI_DEFAULT_MODEL = "gemini-3.8-flash";
// Gemini 3.x emits long JSON (deep analysis ~15 KB+); the old 8192 cap truncated it.
const GEMINI_MAX_TOKENS = 32768;
const GEMINI_IMAGE_FETCH_TIMEOUT_MS = 10_000;
const GEMINI_IMAGE_MAX_BYTES = 6 * 1024 * 1024;

const _disabledProviders = new Set<Route>();
const _customClients = new Map<string, { apiKey: string; baseUrl: string | null; client: OpenAI }>();

/**
 * Bounded calls. The SDK default is a 10-minute timeout with 2 retries, so one
 * stuck request could eat a whole 300 s serverless invocation ("Run stopped
 * before it finished"). Fail fast and let the fallback ladder take over.
 */
const CALL_OPTS = { timeout: 140_000, maxRetries: 0 } as const;
/** A whole call — every model and provider it falls back through — ends by this. */
const CALL_BUDGET_MS = 150_000;
// Free Zhipu models answer 429 at peak times; moving to the next model beats retrying.
const GLM_OPTS = { timeout: 140_000, maxRetries: 0 } as const;

/**
 * Output tokens per second, measured on production (diagnostics ?bench=1,
 * ~1,600-token JSON): GLM-4.7-Flash ≈ 125, gpt-4o-mini ≈ 120, GLM-4-Flash ≈ 52,
 * GLM-4-Air ≈ 60. A fixed timeout either cut the slow fallbacks off mid-answer
 * (45 s) or let a stuck call eat the run, so each request's timeout follows the
 * model's speed and the answer's size.
 */
const TOKENS_PER_SEC: Record<string, number> = {
  "glm-4.7-flash": 100,
  "gpt-4o-mini": 100,
  "gpt-4o": 60,
  "glm-4-flash-250414": 40,
  "glm-4-air-250414": 45,
};

export function requestTimeoutMs(model: string, maxTokens: number): number {
  const tps = TOKENS_PER_SEC[model] ?? 50;
  return Math.round(Math.min(140_000, Math.max(30_000, 15_000 + (maxTokens / tps) * 1000)));
}

/**
 * Free GLM models allow very little concurrency per account; parallel batches
 * mostly earn 429s. Hold at most this many free-GLM calls in flight per
 * instance — a call that waits too long for a slot moves to the next model.
 */
const GLM_FREE_CONCURRENCY = 2;
const GLM_SLOT_WAIT_MS = 20_000;
let _glmActive = 0;
const _glmWaiting: Array<() => void> = [];

async function acquireGlmSlot(): Promise<(() => void) | null> {
  if (_glmActive >= GLM_FREE_CONCURRENCY) {
    const got = await new Promise<boolean>((resolve) => {
      const wake = () => resolve(true);
      _glmWaiting.push(wake);
      setTimeout(() => {
        const i = _glmWaiting.indexOf(wake);
        if (i >= 0) {
          _glmWaiting.splice(i, 1);
          resolve(false);
        }
      }, GLM_SLOT_WAIT_MS);
    });
    if (!got) return null;
  }
  _glmActive++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    _glmActive--;
    _glmWaiting.shift()?.();
  };
}

let _openai: OpenAI | null = null;
let _gemini: OpenAI | null = null;
let _openrouter: OpenAI | null = null;
let _anthropic: OpenAI | null = null;
let _glm: OpenAI | null = null;

// Zhipu BigModel — OpenAI-compatible. GLM-4.7-Flash / GLM-4.6V-Flash are free.
function glmClient(): OpenAI | null {
  const apiKey = zhipuKey();
  if (_disabledProviders.has("glm") || !apiKey) return null;
  if (!_glm) _glm = new OpenAI({ apiKey, baseURL: ZHIPU_BASE_URL, ...GLM_OPTS });
  return _glm;
}

function anthropicClient(): OpenAI | null {
  if (_disabledProviders.has("anthropic") || !process.env.ANTHROPIC_API_KEY) return null;
  if (!_anthropic) _anthropic = new OpenAI({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: ANTHROPIC_BASE_URL, ...CALL_OPTS });
  return _anthropic;
}

function geminiApiKey(): string | undefined {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
}

function openaiClient(): OpenAI | null {
  if (_disabledProviders.has("openai") || !process.env.OPENAI_API_KEY) return null;
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, ...CALL_OPTS });
  return _openai;
}

function geminiClient(): OpenAI | null {
  const apiKey = geminiApiKey();
  if (_disabledProviders.has("gemini") || !apiKey) return null;
  if (!_gemini) _gemini = new OpenAI({ apiKey, baseURL: GEMINI_BASE_URL, ...CALL_OPTS });
  return _gemini;
}

function openrouterClient(): OpenAI | null {
  if (_disabledProviders.has("openrouter") || !process.env.OPENROUTER_API_KEY) return null;
  if (!_openrouter) {
    _openrouter = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
      ...CALL_OPTS,
      defaultHeaders: {
        "HTTP-Referer": "https://creativeintel.vercel.app",
        "X-Title": "CreativeIntel OS",
      },
    });
  }
  return _openrouter;
}

function customId(route: Route): string | null {
  return route.startsWith(CUSTOM_PREFIX) ? route.slice(CUSTOM_PREFIX.length) : null;
}

/** OpenAI client for a bring-your-own provider (openai-compatible or paid Zhipu). */
function customClient(route: Route): OpenAI | null {
  const id = customId(route);
  const p = id ? cachedProvider(id) : null;
  if (!p || !p.apiKey || p.type === "fal" || _disabledProviders.has(route)) return null;
  const baseUrl = p.baseUrl || (p.type === "zhipu-paid" ? ZHIPU_BASE_URL : null);
  const hit = _customClients.get(p.id);
  if (hit && hit.apiKey === p.apiKey && hit.baseUrl === baseUrl) return hit.client;
  const client = new OpenAI({ apiKey: p.apiKey, baseURL: baseUrl ?? undefined, ...CALL_OPTS });
  _customClients.set(p.id, { apiKey: p.apiKey, baseUrl, client });
  return client;
}

function clientFor(provider: Route): OpenAI | null {
  if (customId(provider)) return customClient(provider);
  if (provider === "openai") return openaiClient();
  if (provider === "gemini") return geminiClient();
  if (provider === "anthropic") return anthropicClient();
  if (provider === "glm") return glmClient();
  return openrouterClient();
}

function forcedProvider(): ProviderName | null {
  const v = process.env.AI_PROVIDER;
  return v === "openai" || v === "gemini" || v === "anthropic" || v === "openrouter" || v === "glm" ? v : null;
}

/**
 * Ordered list of providers to try: the engine chosen in settings first, then
 * today's order (AI_PROVIDER, if set, forces a single fallback entry). Strict
 * free mode: Zhipu's free models only — never fall through to a paid provider.
 */
function providerOrder(capability: TextCapability = "text"): Route[] {
  const choice = cachedAiSettings().settings[capability];
  const order = routeOrder(choice, BASE_ORDER, {
    strictFree: isStrictFree(),
    freeIds: ["glm"],
    forced: forcedProvider(),
  }) as Route[];
  // Strict free with paid fallback: free GLM first, then the paid providers,
  // reached only when every free model is busy or times out.
  if (isStrictFree() && paidFallbackAllowed() && !forcedProvider()) {
    for (const p of BASE_ORDER) if (!order.includes(p)) order.push(p);
  }
  return order;
}

/**
 * Zhipu models to try on the glm route, in order. Each free model has its own
 * rate limit, so a second free model often answers when the first is busy;
 * the cheap stable paid tier (GLM-4-Air ≈ ¥0.5 per million tokens, GLM-4.6V-
 * FlashX for vision) only when paid calls are allowed.
 */
export function glmModelLadder(first: string, capability: TextCapability, allowPaid: boolean): string[] {
  const ladder =
    capability === "vision"
      ? [first, ...(allowPaid ? ["glm-4.6v-flashx"] : [])]
      : [first, ZHIPU_FREE_TEXT_ALT, ...(allowPaid ? ["glm-4-air-250414"] : [])];
  return [...new Set(ladder.filter(Boolean))];
}

const ZHIPU_FREE_TEXT_ALT = "glm-4-flash-250414";
const ZHIPU_FREE_MODELS = new Set<string>([ZHIPU_FREE.text, ZHIPU_FREE.vision, ZHIPU_FREE_TEXT_ALT]);

/** Best-guess active provider for label/vision-model resolution. Never throws. */
function activeProvider(capability: TextCapability = "text"): Route {
  const order = providerOrder(capability);
  for (const provider of order) {
    if (clientFor(provider)) return provider;
  }
  return order[0] ?? "openai";
}

function isAuthError(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  return status === 401 || status === 403;
}

/** Free-tier quota exhausted or too many requests — the next provider can likely serve this call. */
function isRateLimitError(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  return status === 429;
}

/**
 * Worth trying the next model/provider: rate limits, provider outages (5xx) and
 * timeouts / dropped connections. A 4xx about the request itself is not.
 */
export function isTransientError(err: unknown): boolean {
  // Class names are minified in the production bundle, so check the SDK class
  // itself (timeouts are APIConnectionTimeoutError, a subclass) and the message.
  if (err instanceof APIConnectionError) return true;
  const e = err as { status?: number; name?: string; message?: string } | null;
  const status = e?.status;
  if (status === 429 || (typeof status === "number" && status >= 500)) return true;
  const text = `${e?.name ?? ""} ${e?.message ?? ""}`;
  return status === undefined && /timed? ?out|timeout|connection|ECONNRESET|socket hang up|fetch failed|aborted/i.test(text);
}

/** Translate a bare OpenAI model id into OpenRouter's namespaced form. */
function toOpenRouterModel(model: string): string {
  if (model.includes("/")) return model;
  return `openai/${model}`;
}

function adaptModelForProvider(model: string, provider: Route): string {
  return provider === "openrouter" ? toOpenRouterModel(model) : model;
}

function modelFor(provider: Route, tier: ModelTier = "standard", capability: TextCapability = "text"): string {
  const id = customId(provider);
  if (id) {
    const models = cachedProvider(id)?.models ?? {};
    return (capability === "vision" ? models.vision : undefined) ?? models.text ?? models.vision ?? "";
  }
  if (capability === "vision") return visionModelFor(provider);
  const env = process.env;
  if (provider === "openai") {
    const standard = env.AI_MODEL || "gpt-4o";
    if (tier === "fast") return env.AI_MODEL_FAST || "gpt-4o-mini";
    if (tier === "deep") return env.AI_MODEL_DEEP || standard;
    return standard;
  }
  if (provider === "gemini") {
    const standard = env.AI_GEMINI_MODEL || GEMINI_DEFAULT_MODEL;
    if (tier === "fast") return env.AI_GEMINI_MODEL_FAST || standard;
    if (tier === "deep") return env.AI_GEMINI_MODEL_DEEP || standard;
    return standard;
  }
  if (provider === "anthropic") {
    if (tier === "fast") return env.ANTHROPIC_MODEL_FAST || "claude-haiku-4-5-20251001";
    if (tier === "deep") return env.ANTHROPIC_MODEL_DEEP || "claude-opus-5-5";
    return env.ANTHROPIC_MODEL || "claude-sonnet-5";
  }
  if (provider === "glm") {
    const standard = env.AI_GLM_MODEL || ZHIPU_FREE.text;
    if (tier === "fast") return env.AI_GLM_MODEL_FAST || standard;
    if (tier === "deep") return env.AI_GLM_MODEL_DEEP || standard;
    return standard;
  }
  // openrouter — DeepSeek by default: strong JSON output at a fraction of GPT-4o's price.
  if (process.env.AI_FALLBACK_MODEL) return process.env.AI_FALLBACK_MODEL;
  if (tier === "fast") return env.AI_OPENROUTER_MODEL_FAST || "deepseek/deepseek-v4-flash";
  if (env.AI_OPENROUTER_MODEL) return env.AI_OPENROUTER_MODEL;
  return "deepseek/deepseek-v4-pro";
}

function routeLabel(route: Route): string {
  const id = customId(route);
  return id ? (cachedProvider(id)?.name ?? route) : route;
}

/** The model id this deployment actually calls for text analysis — safe to render in the UI. */
export function getConfiguredModelLabel(): string {
  const provider = activeProvider();
  return `${modelFor(provider)} (${routeLabel(provider)})`;
}

/**
 * Model used for calls that carry image parts. Text-only fallback models (the
 * OpenRouter free tier) cannot see images, so vision routes separately.
 */
export function getVisionModel(): string {
  return modelFor(activeProvider("vision"), "standard", "vision");
}

function visionModelFor(provider: Route): string {
  // The model picked before an analysis wins on its own engine (never a paid one in strict free mode).
  const picked = visionModelChoice(cachedAiSettings().settings.visionModel);
  if (picked && picked.engine === provider && !(picked.paid && isStrictFree())) return picked.model;
  if (provider === "gemini") {
    return process.env.AI_GEMINI_VISION_MODEL || process.env.AI_GEMINI_MODEL || GEMINI_DEFAULT_MODEL;
  }
  if (provider === "glm") return process.env.AI_GLM_VISION_MODEL || ZHIPU_FREE.vision;
  if (process.env.AI_VISION_MODEL) return process.env.AI_VISION_MODEL;
  if (provider === "anthropic") return process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
  if (provider === "openrouter") return "openai/gpt-4o";
  return "gpt-4o";
}

export type PromptPart =
  | { type: "text"; text: string }
  | { type: "image_url"; url: string };

/** A user prompt is either plain text or an ordered list of OpenAI chat content parts. */
export type UserPrompt = string | PromptPart[];

function toUserContent(prompt: UserPrompt): OpenAI.Chat.ChatCompletionUserMessageParam["content"] {
  if (typeof prompt === "string") return prompt;
  return prompt.map((part) =>
    part.type === "text"
      ? ({ type: "text", text: part.text } as const)
      : ({ type: "image_url", image_url: { url: part.url } } as const)
  );
}

/**
 * Fetches a remote image and returns it as a `data:` URL, for providers (Gemini)
 * whose vision endpoint rejects remote https image URLs. Bounded by a timeout and
 * a size cap; returns null on any failure so the caller can drop the image and
 * keep the rest of the prompt intact rather than failing the whole call.
 */
async function fetchAsDataUrl(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEMINI_IMAGE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const contentLengthHeader = res.headers.get("content-length");
    if (contentLengthHeader && Number(contentLengthHeader) > GEMINI_IMAGE_MAX_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > GEMINI_IMAGE_MAX_BYTES) return null;
    const contentType = res.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
    return `data:${contentType};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Gemini's OpenAI-compatible vision endpoint only accepts `data:` image URLs, and
 * Zhipu often can't fetch the remote host. Converts every http(s) image_url part to a data URL; on
 * fetch failure the image part is dropped (text is preserved). data: URLs and
 * other content parts pass through untouched.
 */
async function toGeminiContent(
  content: OpenAI.Chat.ChatCompletionUserMessageParam["content"]
): Promise<OpenAI.Chat.ChatCompletionUserMessageParam["content"]> {
  if (typeof content === "string") return content;

  const parts: OpenAI.Chat.ChatCompletionContentPart[] = [];
  for (const part of content) {
    if (part.type === "image_url" && /^https?:\/\//i.test(part.image_url.url)) {
      const dataUrl = await fetchAsDataUrl(part.image_url.url);
      if (dataUrl) {
        parts.push({ type: "image_url", image_url: { url: dataUrl } });
      } else {
        console.warn(`[ai] dropping image part, could not fetch ${part.image_url.url}`);
      }
      continue;
    }
    parts.push(part);
  }
  return parts;
}

async function prepareMessagesForRoute(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  provider: Route
): Promise<OpenAI.Chat.ChatCompletionMessageParam[]> {
  // Gemini only takes data: URLs; Zhipu (GLM) can't reach many overseas image
  // hosts (YouTube, Meta, Wikimedia CDNs) and answers "图片输入格式/解析错误".
  if (provider !== "gemini" && provider !== "glm") return messages;
  const prepared: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  for (const msg of messages) {
    if (msg.role === "user" && Array.isArray(msg.content)) {
      prepared.push({ ...msg, content: await toGeminiContent(msg.content) });
    } else {
      prepared.push(msg);
    }
  }
  return prepared;
}

/** Thrown when the AI response could not be parsed into the expected schema, even after retry. */
export class AIResponseError extends Error {
  readonly rawText: string;

  constructor(message: string, options: { cause?: unknown; rawText: string }) {
    super(message, { cause: options.cause });
    this.name = "AIResponseError";
    this.rawText = options.rawText.slice(0, 500);
  }
}

/** Extract JSON text from a model response: prefer the LAST fenced code block, else the outermost {...}. */
function extractJsonCandidate(text: string): string {
  const fenceMatches = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  if (fenceMatches.length > 0) {
    return fenceMatches[fenceMatches.length - 1][1].trim();
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1).trim();
  }

  return text.trim();
}

/** Strict parse first; on failure repair common LLM slips (missing commas, trailing commas, truncated arrays, unescaped newlines). */
function parseJsonLenient(jsonStr: string): unknown {
  try {
    return JSON.parse(jsonStr);
  } catch (strictErr) {
    try {
      return JSON.parse(jsonrepair(jsonStr));
    } catch {
      throw strictErr;
    }
  }
}

function parseErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "parse error";
}

async function createOnRoute(
  client: OpenAI,
  provider: Route,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  modelToUse: string,
  maxTokens: number
) {
  const effectiveMaxTokens = provider === "gemini" ? Math.min(maxTokens, GEMINI_MAX_TOKENS) : maxTokens;
  const preparedMessages = await prepareMessagesForRoute(messages, provider);
  // GLM-4.7-Flash is a hybrid reasoning model; these calls want the JSON
  // answer, not a thinking trace, so switch thinking off.
  const zhipuFamily = provider === "glm" || (customId(provider) && cachedProvider(customId(provider)!)?.type === "zhipu-paid");
  // DeepSeek on OpenRouter reasons by default: the hidden trace burns max_tokens (empty
  // answers) and costs ~5× the time — OpenRouter's unified switch turns it off.
  const extra = zhipuFamily
    ? ({ thinking: { type: "disabled" } } as Record<string, unknown>)
    : provider === "openrouter"
      ? ({ reasoning: { enabled: false } } as Record<string, unknown>)
      : {};
  const reqOpts = { timeout: requestTimeoutMs(modelToUse, effectiveMaxTokens), maxRetries: 0 };
  try {
    return await client.chat.completions.create(
      {
        model: modelToUse,
        max_tokens: effectiveMaxTokens,
        messages: preparedMessages,
        response_format: { type: "json_object" },
        ...extra,
      },
      reqOpts
    );
  } catch (err) {
    const status = (err as { status?: number } | null)?.status;
    // Only a request the model rejects (400/422) is worth retrying without
    // response_format; a 429 or timeout would just wait twice.
    if (status !== 400 && status !== 422) throw err;
    // Some models/providers reject response_format — retry without it.
    return await client.chat.completions.create(
      {
        model: modelToUse,
        max_tokens: effectiveMaxTokens,
        messages: preparedMessages,
        ...extra,
      },
      reqOpts
    );
  }
}

/**
 * Tries each provider in providerOrder() until one succeeds. A 401/403 disables
 * that provider for the rest of the process and falls through to the next one.
 * A 429 (free-tier quota exhausted) falls through for this call only — it's
 * usually transient, so the provider stays eligible for the next call. Any
 * other error is thrown immediately (it won't be fixed by switching providers).
 */
/** Fire-and-forget usage row for a completed call. */
function recordUsage(provider: Route, model: string, capability: TextCapability, usage: OpenAI.CompletionUsage | undefined) {
  const inputTokens = usage?.prompt_tokens ?? 0;
  const outputTokens = usage?.completion_tokens ?? 0;
  const id = customId(provider);
  const costUsd =
    provider === "glm"
      ? ZHIPU_FREE_MODELS.has(model)
        ? 0
        : null
      : id
        ? costForTokens(cachedProvider(id)?.prices, inputTokens, outputTokens)
        : null;
  logAiUsage({ provider, model, capability, inputTokens, outputTokens, costUsd });
}

function describeErr(err: unknown): string {
  const e = err as { status?: number; name?: string; message?: string } | null;
  return e?.status ? `${e.status}` : (e?.name || String(e?.message ?? err)).slice(0, 60);
}

/** Try each model of a route in turn, moving on when one is busy, down or slow. */
async function tryModels(
  client: OpenAI,
  provider: Route,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  models: string[],
  maxTokens: number,
  capability: TextCapability,
  deadlineAt = Date.now() + CALL_BUDGET_MS
) {
  let lastErr: unknown;
  for (const [i, model] of models.entries()) {
    if (i > 0 && Date.now() > deadlineAt) break; // out of time for this call — let the caller fall back
    const release = provider === "glm" && ZHIPU_FREE_MODELS.has(model) ? await acquireGlmSlot() : () => {};
    if (!release) {
      lastErr = Object.assign(new Error(`${model}: no free slot (free-tier concurrency)`), { status: 429 });
      console.warn(`[ai] ${provider} ${model} busy locally — trying ${models[i + 1] ?? "the next provider"}`);
      continue;
    }
    try {
      const response = await createOnRoute(client, provider, messages, model, maxTokens);
      recordUsage(provider, model, capability, response.usage);
      if (i > 0) console.warn(`[ai] ${provider}: answered by fallback model ${model}`);
      return response;
    } catch (err) {
      lastErr = err;
      if (i < models.length - 1 && (isRateLimitError(err) || isTransientError(err))) {
        console.warn(`[ai] ${provider} ${model} unavailable (${describeErr(err)}) — trying ${models[i + 1]}`);
        continue;
      }
      throw err;
    } finally {
      release();
    }
  }
  throw lastErr;
}

async function callModel(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  maxTokens: number,
  modelOverride?: string,
  tier: ModelTier = "standard",
  capability: TextCapability = "text"
) {
  const order = providerOrder(capability);
  let lastErr: unknown;
  let tried = false;
  const deadlineAt = Date.now() + CALL_BUDGET_MS;

  for (const provider of order) {
    const client = clientFor(provider);
    if (!client) continue;
    if (tried && Date.now() > deadlineAt) break;
    tried = true;
    // A bring-your-own provider always uses its own configured model ids.
    const modelToUse =
      modelOverride && !customId(provider)
        ? adaptModelForProvider(modelOverride, provider)
        : modelFor(provider, tier, capability);
    const models = provider === "glm" ? glmModelLadder(modelToUse, capability, !isStrictFree() || paidFallbackAllowed()) : [modelToUse];
    try {
      const response = await tryModels(client, provider, messages, models, maxTokens, capability, deadlineAt);
      return response;
    } catch (err) {
      if (isAuthError(err)) {
        // 401 = bad key; 403 can also mean "this project can't use this
        // model" — log which, so the fix is obvious from the runtime logs.
        const e = err as { status?: number; code?: string; message?: string };
        console.warn(
          `[ai] ${provider} rejected the request (${e.status}${e.code ? ` ${e.code}` : ""}, model ${modelToUse}): ${String(e.message ?? "").slice(0, 200)} — disabling it for this process`
        );
        _disabledProviders.add(provider);
        lastErr = err;
        continue;
      }
      if (isRateLimitError(err) || isTransientError(err)) {
        console.warn(`[ai] ${provider} unavailable (${describeErr(err)}) — trying the next provider`);
        lastErr = err;
        continue;
      }
      throw err;
    }
  }

  if (!tried) {
    throw new Error(
      isStrictFree()
        ? "Strict free mode is on but ZHIPU_API_KEY is not configured — set it, or turn strict free mode off in Settings → AI engines"
        : "No AI key configured — set OPENAI_API_KEY, GEMINI_API_KEY/GOOGLE_API_KEY, ANTHROPIC_API_KEY, OPENROUTER_API_KEY or ZHIPU_API_KEY, or connect a model API in Settings → AI engines"
    );
  }
  throw lastErr;
}

export async function analyzeWithClaude<T>(options: {
  systemPrompt: string;
  userPrompt: UserPrompt;
  responseSchema: ZodSchema<T>;
  maxTokens?: number;
  /** Optional per-call model override, e.g. to route heavy tasks to a stronger model. */
  model?: string;
  /** Which model class this task needs; default "standard". Ignored when `model` is set. */
  tier?: ModelTier;
}): Promise<T> {
  const { systemPrompt, userPrompt, responseSchema, maxTokens = 4096, model: modelOverride, tier } = options;

  if (process.env.MOCK_AI === "true") {
    try {
      return responseSchema.parse({});
    } catch (err) {
      throw new Error(
        `MOCK_AI enabled but schema has required fields for this call (systemPrompt: "${systemPrompt.slice(0, 80)}..."). ` +
          `Provide mock data at the call site instead of relying on MOCK_AI. Underlying error: ${parseErrorMessage(err)}`
      );
    }
  }

  // Warm the engine settings (cached ~30 s): chosen engines + strict free mode.
  await loadAiSettings();
  const capability: TextCapability =
    typeof userPrompt !== "string" && userPrompt.some((part) => part.type === "image_url") ? "vision" : "text";

  // OpenAI requires "json" in the messages when using json_object format
  const systemWithJson = systemPrompt.toLowerCase().includes("json")
    ? systemPrompt
    : systemPrompt + "\n\nRespond with valid JSON only.";

  const userContent = toUserContent(userPrompt);

  const response = await callModel(
    [
      { role: "system", content: systemWithJson },
      { role: "user", content: userContent },
    ],
    maxTokens,
    modelOverride,
    tier,
    capability
  );

  const text = response.choices[0]?.message?.content || "";
  const jsonStr = extractJsonCandidate(text);

  try {
    const parsed = parseJsonLenient(jsonStr);
    return responseSchema.parse(parsed);
  } catch (parseError) {
    // Retry with the full original context (not the failed output verbatim) plus a
    // trimmed excerpt of what went wrong, so the model has enough to self-correct
    // without re-spending tokens on the whole failed response.
    const failedExcerpt = text.slice(0, 500);
    const retryResponse = await callModel(
      [
        { role: "system", content: systemWithJson },
        { role: "user", content: userContent },
        {
          role: "assistant",
          content: failedExcerpt,
        },
        {
          role: "user",
          content: `Your previous response could not be parsed as valid JSON matching the required schema. Error: ${parseErrorMessage(
            parseError
          )}\n\nRespond again with ONLY valid JSON, no markdown fences, no explanation.`,
        },
      ],
      maxTokens,
      modelOverride,
      tier,
      capability
    );

    const retryText = retryResponse.choices[0]?.message?.content || "";
    const retryJsonStr = extractJsonCandidate(retryText);

    try {
      const retryParsed = parseJsonLenient(retryJsonStr);
      return responseSchema.parse(retryParsed);
    } catch (retryError) {
      throw new AIResponseError(
        `AI response could not be parsed into the expected schema after retry: ${parseErrorMessage(retryError)}`,
        { cause: retryError, rawText: retryText || text }
      );
    }
  }
}
