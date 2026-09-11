import OpenAI from "openai";
import { ZodSchema } from "zod";

// Route priority: OpenAI → OpenRouter. OpenAI is preferred while its key works;
// the first 401 from OpenAI permanently (per process) reroutes to OpenRouter so a
// rotated/revoked key degrades to the fallback instead of failing every call.
let _openai: OpenAI | null = null;
let _openrouter: OpenAI | null = null;
let _openaiDisabled = false;

function openaiClient(): OpenAI | null {
  if (_openaiDisabled || !process.env.OPENAI_API_KEY) return null;
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

function openrouterClient(): OpenAI | null {
  if (!process.env.OPENROUTER_API_KEY) return null;
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

interface Route {
  client: OpenAI;
  isOpenRouter: boolean;
}

function resolveRoute(): Route {
  const oa = openaiClient();
  if (oa) return { client: oa, isOpenRouter: false };
  const or = openrouterClient();
  if (or) return { client: or, isOpenRouter: true };
  throw new Error("No AI key configured — set OPENAI_API_KEY or OPENROUTER_API_KEY");
}

function isAuthError(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  return status === 401 || status === 403;
}

/** Translate a bare OpenAI model id into OpenRouter's namespaced form. */
function toOpenRouterModel(model: string): string {
  if (model.includes("/")) return model;
  return `openai/${model}`;
}

function getModel(): string {
  if (!_openaiDisabled && process.env.OPENAI_API_KEY) return process.env.AI_MODEL || "gpt-4o";
  if (process.env.OPENROUTER_API_KEY) {
    if (process.env.AI_FALLBACK_MODEL) return process.env.AI_FALLBACK_MODEL;
    if (process.env.AI_MODEL) return toOpenRouterModel(process.env.AI_MODEL);
    return "meta-llama/llama-3.3-70b-instruct:free";
  }
  return process.env.AI_MODEL || "gpt-4o";
}

/** The model id this deployment actually calls for text analysis — safe to render in the UI. */
export function getConfiguredModelLabel(): string {
  return getModel();
}

/**
 * Model used for calls that carry image parts. Text-only fallback models (the
 * OpenRouter free tier) cannot see images, so vision routes separately.
 */
export function getVisionModel(): string {
  if (process.env.AI_VISION_MODEL) return process.env.AI_VISION_MODEL;
  if ((_openaiDisabled || !process.env.OPENAI_API_KEY) && process.env.OPENROUTER_API_KEY) return "openai/gpt-4o";
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

function parseErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "parse error";
}

export async function analyzeWithClaude<T>(options: {
  systemPrompt: string;
  userPrompt: UserPrompt;
  responseSchema: ZodSchema<T>;
  maxTokens?: number;
  /** Optional per-call model override, e.g. to route heavy tasks to a stronger model. */
  model?: string;
}): Promise<T> {
  const { systemPrompt, userPrompt, responseSchema, maxTokens = 4096, model: modelOverride } = options;

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

  let route = resolveRoute();
  let model = modelOverride || getModel();

  // OpenAI requires "json" in the messages when using json_object format
  const systemWithJson = systemPrompt.toLowerCase().includes("json")
    ? systemPrompt
    : systemPrompt + "\n\nRespond with valid JSON only.";

  async function createOnRoute(messages: OpenAI.Chat.ChatCompletionMessageParam[], modelToUse: string) {
    try {
      return await route.client.chat.completions.create({
        model: modelToUse,
        max_tokens: maxTokens,
        messages,
        response_format: { type: "json_object" },
      });
    } catch (err) {
      if (isAuthError(err)) throw err;
      // Some OpenRouter models reject response_format — retry without it.
      return await route.client.chat.completions.create({
        model: modelToUse,
        max_tokens: maxTokens,
        messages,
      });
    }
  }

  async function callModel(messages: OpenAI.Chat.ChatCompletionMessageParam[], modelToUse: string) {
    try {
      return await createOnRoute(messages, modelToUse);
    } catch (err) {
      if (!isAuthError(err) || route.isOpenRouter || !openrouterClient()) throw err;
      console.warn("[ai] OpenAI rejected the API key — rerouting this process to OpenRouter");
      _openaiDisabled = true;
      route = resolveRoute();
      model = modelOverride ? toOpenRouterModel(modelOverride) : getModel();
      return await createOnRoute(messages, model);
    }
  }

  const userContent = toUserContent(userPrompt);

  const response = await callModel(
    [
      { role: "system", content: systemWithJson },
      { role: "user", content: userContent },
    ],
    model
  );

  const text = response.choices[0]?.message?.content || "";
  const jsonStr = extractJsonCandidate(text);

  try {
    const parsed = JSON.parse(jsonStr);
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
      model
    );

    const retryText = retryResponse.choices[0]?.message?.content || "";
    const retryJsonStr = extractJsonCandidate(retryText);

    try {
      const retryParsed = JSON.parse(retryJsonStr);
      return responseSchema.parse(retryParsed);
    } catch (retryError) {
      throw new AIResponseError(
        `AI response could not be parsed into the expected schema after retry: ${parseErrorMessage(retryError)}`,
        { cause: retryError, rawText: retryText || text }
      );
    }
  }
}
