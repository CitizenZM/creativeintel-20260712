import OpenAI from "openai";
import { jsonrepair } from "jsonrepair";
import { ZodSchema } from "zod";

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

type ProviderName = "openai" | "gemini" | "anthropic" | "openrouter";
export type ModelTier = "fast" | "standard" | "deep";

const ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1/";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";
const GEMINI_DEFAULT_MODEL = "gemini-3.8-flash";
// Gemini 3.x emits long JSON (deep analysis ~15 KB+); the old 8192 cap truncated it.
const GEMINI_MAX_TOKENS = 32768;
const GEMINI_IMAGE_FETCH_TIMEOUT_MS = 10_000;
const GEMINI_IMAGE_MAX_BYTES = 6 * 1024 * 1024;

const _disabledProviders = new Set<ProviderName>();

let _openai: OpenAI | null = null;
let _gemini: OpenAI | null = null;
let _openrouter: OpenAI | null = null;
let _anthropic: OpenAI | null = null;

function anthropicClient(): OpenAI | null {
  if (_disabledProviders.has("anthropic") || !process.env.ANTHROPIC_API_KEY) return null;
  if (!_anthropic) _anthropic = new OpenAI({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: ANTHROPIC_BASE_URL });
  return _anthropic;
}

function geminiApiKey(): string | undefined {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
}

function openaiClient(): OpenAI | null {
  if (_disabledProviders.has("openai") || !process.env.OPENAI_API_KEY) return null;
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

function geminiClient(): OpenAI | null {
  const apiKey = geminiApiKey();
  if (_disabledProviders.has("gemini") || !apiKey) return null;
  if (!_gemini) _gemini = new OpenAI({ apiKey, baseURL: GEMINI_BASE_URL });
  return _gemini;
}

function openrouterClient(): OpenAI | null {
  if (_disabledProviders.has("openrouter") || !process.env.OPENROUTER_API_KEY) return null;
  if (!_openrouter) {
    _openrouter = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": "https://creativeintel.vercel.app",
        "X-Title": "CreativeIntel OS",
      },
    });
  }
  return _openrouter;
}

function clientFor(provider: ProviderName): OpenAI | null {
  if (provider === "openai") return openaiClient();
  if (provider === "gemini") return geminiClient();
  if (provider === "anthropic") return anthropicClient();
  return openrouterClient();
}

function forcedProvider(): ProviderName | null {
  const v = process.env.AI_PROVIDER;
  return v === "openai" || v === "gemini" || v === "anthropic" || v === "openrouter" ? v : null;
}

/** Ordered list of providers to try. AI_PROVIDER, if set, forces a single entry. */
function providerOrder(): ProviderName[] {
  const forced = forcedProvider();
  if (forced) return [forced];
  return ["openai", "gemini", "anthropic", "openrouter"];
}

/** Best-guess active provider for label/vision-model resolution. Never throws. */
function activeProvider(): ProviderName {
  for (const provider of providerOrder()) {
    if (clientFor(provider)) return provider;
  }
  return providerOrder()[0] ?? "openai";
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

/** Translate a bare OpenAI model id into OpenRouter's namespaced form. */
function toOpenRouterModel(model: string): string {
  if (model.includes("/")) return model;
  return `openai/${model}`;
}

function adaptModelForProvider(model: string, provider: ProviderName): string {
  return provider === "openrouter" ? toOpenRouterModel(model) : model;
}

function modelFor(provider: ProviderName, tier: ModelTier = "standard"): string {
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
  // openrouter
  if (process.env.AI_FALLBACK_MODEL) return process.env.AI_FALLBACK_MODEL;
  if (process.env.AI_MODEL) return toOpenRouterModel(process.env.AI_MODEL);
  return "meta-llama/llama-3.3-70b-instruct:free";
}

/** The model id this deployment actually calls for text analysis — safe to render in the UI. */
export function getConfiguredModelLabel(): string {
  const provider = activeProvider();
  return `${modelFor(provider)} (${provider})`;
}

/**
 * Model used for calls that carry image parts. Text-only fallback models (the
 * OpenRouter free tier) cannot see images, so vision routes separately.
 */
export function getVisionModel(): string {
  const provider = activeProvider();
  if (provider === "gemini") {
    return process.env.AI_GEMINI_VISION_MODEL || process.env.AI_GEMINI_MODEL || GEMINI_DEFAULT_MODEL;
  }
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
 * Gemini's OpenAI-compatible vision endpoint only accepts `data:` image URLs, not
 * remote https URLs. Converts every http(s) image_url part to a data URL; on
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
        console.warn(`[ai] gemini: dropping image part, could not fetch ${part.image_url.url}`);
      }
      continue;
    }
    parts.push(part);
  }
  return parts;
}

async function prepareMessagesForRoute(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  provider: ProviderName
): Promise<OpenAI.Chat.ChatCompletionMessageParam[]> {
  if (provider !== "gemini") return messages;
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
  provider: ProviderName,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  modelToUse: string,
  maxTokens: number
) {
  const effectiveMaxTokens = provider === "gemini" ? Math.min(maxTokens, GEMINI_MAX_TOKENS) : maxTokens;
  const preparedMessages = await prepareMessagesForRoute(messages, provider);
  try {
    return await client.chat.completions.create({
      model: modelToUse,
      max_tokens: effectiveMaxTokens,
      messages: preparedMessages,
      response_format: { type: "json_object" },
    });
  } catch (err) {
    if (isAuthError(err)) throw err;
    // Some models/providers reject response_format — retry without it.
    return await client.chat.completions.create({
      model: modelToUse,
      max_tokens: effectiveMaxTokens,
      messages: preparedMessages,
    });
  }
}

/**
 * Tries each provider in providerOrder() until one succeeds. A 401/403 disables
 * that provider for the rest of the process and falls through to the next one.
 * A 429 (free-tier quota exhausted) falls through for this call only — it's
 * usually transient, so the provider stays eligible for the next call. Any
 * other error is thrown immediately (it won't be fixed by switching providers).
 */
async function callModel(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  maxTokens: number,
  modelOverride?: string,
  tier: ModelTier = "standard"
) {
  const order = providerOrder();
  let lastErr: unknown;
  let tried = false;

  for (const provider of order) {
    const client = clientFor(provider);
    if (!client) continue;
    tried = true;
    const modelToUse = modelOverride ? adaptModelForProvider(modelOverride, provider) : modelFor(provider, tier);
    try {
      return await createOnRoute(client, provider, messages, modelToUse, maxTokens);
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
      if (isRateLimitError(err)) {
        console.warn(`[ai] ${provider} rate-limited (429) — trying the next provider`);
        lastErr = err;
        continue;
      }
      throw err;
    }
  }

  if (!tried) {
    throw new Error(
      "No AI key configured — set OPENAI_API_KEY, GEMINI_API_KEY/GOOGLE_API_KEY, ANTHROPIC_API_KEY, or OPENROUTER_API_KEY"
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
    tier
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
      tier
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
