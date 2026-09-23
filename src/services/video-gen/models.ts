/**
 * Single source of truth for video generation models used across the
 * studio/* API routes (generate-video, generate-from-script, fal-status,
 * video-status). Replaces three previously-diverging maps:
 *   - studio/generate-video/route.ts FAL_MODELS + VEO_MODELS
 *   - studio/generate-from-script/route.ts FAL_MODELS
 *   - studio/fal-status/[jobId]/route.ts MODEL_ENDPOINTS
 */

export type VideoModelProvider = "fal" | "veo";

export interface VideoModelDef {
  key: string;
  provider: VideoModelProvider;
  /** Endpoint used to submit a generation job (fal.ai queue path, or Veo model id). */
  submitEndpoint: string;
  /**
   * Endpoint used to poll/fetch status & result. For fal.ai, this can differ
   * from submitEndpoint (e.g. Kling requires the /text-to-video suffix on
   * both submit AND status, but some models only need the base path for status).
   */
  statusEndpoint: string;
  /** Realistic max prompt length accepted by the provider/model, in characters. */
  maxPromptChars: number;
  supportsNegativePrompt: boolean;
  supportsAudio: boolean;
  costPerSecond: number;
  /**
   * fal.ai queue path for image-conditioned (image-to-video) generation, when
   * the provider/model supports it. Undefined means no i2v path is known yet
   * (e.g. Veo) — callers should fall back to the text-to-video submitEndpoint.
   */
  i2vEndpoint?: string;
  /** Payload field name the i2v endpoint expects for the conditioning image URL. */
  imageParamName?: string;
  /**
   * Request-body param keys this model actually accepts, from the candidate
   * set { duration, aspect_ratio, resolution }. prompt-compiler.ts filters its
   * generated params object down to only these keys before returning a
   * per-shot payload — passing an unsupported field to a provider can cause
   * a 422 or be silently ignored, so the allowlist is explicit per model.
   */
  supportedParams: string[];
}

export const VIDEO_MODELS: Record<string, VideoModelDef> = {
  "grok-imagine-video": {
    key: "grok-imagine-video",
    provider: "fal",
    submitEndpoint: "xai/grok-imagine-video/text-to-video",
    statusEndpoint: "xai/grok-imagine-video",
    maxPromptChars: 4000,
    supportsNegativePrompt: false,
    supportsAudio: true,
    costPerSecond: 0.07,
    i2vEndpoint: "xai/grok-imagine-video/image-to-video",
    imageParamName: "image_url",
    supportedParams: ["duration", "aspect_ratio", "resolution"],
  },
  "wan-2.6": {
    key: "wan-2.6",
    provider: "fal",
    submitEndpoint: "wan/v2.6/text-to-video",
    statusEndpoint: "wan/v2.6",
    maxPromptChars: 4000,
    supportsNegativePrompt: true,
    supportsAudio: true,
    costPerSecond: 0.10,
    i2vEndpoint: "wan/v2.6/image-to-video",
    imageParamName: "image_url",
    supportedParams: ["duration", "aspect_ratio", "resolution"],
  },
  "kling-v3-pro": {
    key: "kling-v3-pro",
    provider: "fal",
    submitEndpoint: "fal-ai/kling-video/v3/pro/text-to-video",
    statusEndpoint: "fal-ai/kling-video/v3/pro/text-to-video",
    maxPromptChars: 2500,
    supportsNegativePrompt: true,
    supportsAudio: false,
    costPerSecond: 0.112,
    i2vEndpoint: "fal-ai/kling-video/v3/pro/image-to-video",
    imageParamName: "image_url",
    supportedParams: ["duration", "aspect_ratio"],
  },
  "wan-2.5": {
    key: "wan-2.5",
    provider: "fal",
    submitEndpoint: "fal-ai/wan-25-preview/text-to-video",
    statusEndpoint: "fal-ai/wan-25-preview",
    maxPromptChars: 4000,
    supportsNegativePrompt: true,
    supportsAudio: false,
    costPerSecond: 0.05,
    i2vEndpoint: "fal-ai/wan-25-preview/image-to-video",
    imageParamName: "image_url",
    supportedParams: ["duration", "aspect_ratio", "resolution"],
  },
  "kling-v3-standard": {
    key: "kling-v3-standard",
    provider: "fal",
    submitEndpoint: "fal-ai/kling-video/v3/standard/text-to-video",
    statusEndpoint: "fal-ai/kling-video/v3/standard/text-to-video",
    maxPromptChars: 2500,
    supportsNegativePrompt: true,
    supportsAudio: false,
    costPerSecond: 0.07,
    i2vEndpoint: "fal-ai/kling-video/v3/standard/image-to-video",
    imageParamName: "image_url",
    supportedParams: ["duration", "aspect_ratio"],
  },
  "veo-3.1-fast": {
    key: "veo-3.1-fast",
    provider: "veo",
    submitEndpoint: "veo-3.1-fast-generate-preview",
    statusEndpoint: "veo-3.1-fast-generate-preview",
    maxPromptChars: 4000,
    supportsNegativePrompt: false,
    supportsAudio: false,
    costPerSecond: 0.15,
    supportedParams: ["aspect_ratio"],
  },
  "veo-3.1-standard": {
    key: "veo-3.1-standard",
    provider: "veo",
    submitEndpoint: "veo-3.1-generate-preview",
    statusEndpoint: "veo-3.1-generate-preview",
    maxPromptChars: 4000,
    supportsNegativePrompt: false,
    supportsAudio: false,
    costPerSecond: 0.30,
    supportedParams: ["aspect_ratio"],
  },
};

export function getVideoModel(model: string): VideoModelDef | undefined {
  return VIDEO_MODELS[model];
}

/** Trims text to maxChars at the last sentence boundary (. ! ? or newline) at or before the limit. */
function trimAtSentenceBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars);
  const boundary = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("! "),
    slice.lastIndexOf("? "),
    slice.lastIndexOf(".\n"),
    slice.lastIndexOf("\n")
  );
  if (boundary > maxChars * 0.5) {
    return slice.slice(0, boundary + 1).trim();
  }
  // No good sentence boundary found — hard trim as last resort.
  return slice.trim();
}

export interface FitPromptResult {
  /** The (possibly trimmed) positive prompt text to send as the main `prompt` field. */
  prompt: string;
  /**
   * The negative text, when the model supports a dedicated negative_prompt
   * field. Undefined when the model does NOT support one — in that case the
   * negative block is already appended to `prompt` instead.
   */
  negativePrompt?: string;
}

/**
 * Budgets a prompt + negative-prompt pair against a model's maxChars limit.
 *
 * - If `supportsNegativePrompt`, the negative text is returned separately
 *   (send via payload.negative_prompt) and only the positive prompt is
 *   trimmed (at a sentence boundary) to fit maxChars.
 * - If not, space for the negative block is reserved at the end of the
 *   combined string, and the positive part is trimmed at a sentence
 *   boundary so the negative block is never cut off.
 */
export function fitPrompt(
  prompt: string,
  negative: string,
  maxChars: number,
  supportsNegativePrompt: boolean
): FitPromptResult {
  if (!negative) {
    return { prompt: trimAtSentenceBoundary(prompt, maxChars) };
  }

  if (supportsNegativePrompt) {
    // Negative goes in its own field — full budget available for positive.
    return {
      prompt: trimAtSentenceBoundary(prompt, maxChars),
      negativePrompt: negative,
    };
  }

  // No dedicated field: negative block must be appended and never cut.
  const negativeBlock = `\n\nnegative: ${negative}`;
  const reserved = maxChars - negativeBlock.length;
  const trimmedPositive = trimAtSentenceBoundary(prompt, Math.max(reserved, 0));
  return { prompt: `${trimmedPositive}${negativeBlock}` };
}

/** Convenience wrapper that pulls maxChars/supportsNegativePrompt from a model def. */
export function fitPromptForModel(
  prompt: string,
  negative: string,
  model: VideoModelDef
): FitPromptResult {
  return fitPrompt(prompt, negative, model.maxPromptChars, model.supportsNegativePrompt);
}
