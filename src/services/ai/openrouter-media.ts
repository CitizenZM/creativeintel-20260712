/**
 * OpenRouter media — one key for cheap production stills and image-to-video.
 *
 *   images  POST /api/v1/images   (Seedream 5 Flash, Qwen-Image 3 …); reference
 *           images go in `input_references`, which is how the cast lock edits one
 *           actor into every shot
 *   video   POST /api/v1/videos   async job (Veo 3.1 Lite, Wan 3.0, Kling 3.0 …);
 *           the keyframe is the clip's `first_frame`
 *
 * Text (DeepSeek, GLM) goes through the OpenAI-compatible client in claude-client.ts.
 * OpenRouter has no Zhipu video model, so free CogVideoX clips stay on the GLM engine.
 */
import { logAiUsage } from "@/services/ai/usage";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export function openrouterKey(): string | undefined {
  return process.env.OPENROUTER_API_KEY || undefined;
}

export function isOpenRouterConfigured(): boolean {
  return !!openrouterKey();
}

async function call<T>(path: string, init: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  const key = openrouterKey();
  if (!key) throw new Error("OPENROUTER_API_KEY is not configured");
  const res = await fetch(`${OPENROUTER_BASE_URL}${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(init.timeoutMs ?? 60_000),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // non-JSON error page
  }
  if (!res.ok) {
    const j = json as { error?: { message?: string } | string; message?: string } | null;
    const msg = (typeof j?.error === "object" ? j.error?.message : j?.error) || j?.message || text.slice(0, 200);
    throw new Error(`OpenRouter ${res.status}: ${msg}`);
  }
  return json as T;
}

/** The image API takes the ratio as-is; anything unusual falls back to vertical. */
export function openrouterAspect(aspectRatio: string): string {
  return ["9:16", "16:9", "1:1", "3:4", "4:3", "4:5", "5:4"].includes(aspectRatio) ? aspectRatio : "9:16";
}

interface ImageResponse {
  data?: { b64_json?: string; url?: string }[];
  usage?: { cost?: number };
}

/**
 * One still. With `referenceUrls` the model edits them into the new shot (the
 * person or product keeps its identity); several references compose in order.
 */
export async function generateOpenRouterImage(
  prompt: string,
  opts: { model: string; aspectRatio: string; referenceUrls?: string[]; projectId?: string | null }
): Promise<{ buffer: Buffer; contentType: string }> {
  const refs = (opts.referenceUrls ?? []).filter((u) => /^https?:\/\//.test(u));
  const out = await call<ImageResponse>("/images", {
    body: {
      model: opts.model,
      prompt,
      aspect_ratio: openrouterAspect(opts.aspectRatio),
      ...(refs.length ? { input_references: refs.map((url) => ({ type: "image_url", image_url: { url } })) } : {}),
    },
    timeoutMs: 170_000,
  });
  const item = out.data?.[0];
  let buffer: Buffer | null = null;
  let contentType = "image/jpeg";
  if (item?.b64_json) buffer = Buffer.from(item.b64_json, "base64");
  else if (item?.url && /^https?:\/\//.test(item.url)) {
    const res = await fetch(item.url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`OpenRouter image download ${res.status}`);
    contentType = res.headers.get("content-type")?.split(";")[0] || contentType;
    buffer = Buffer.from(await res.arrayBuffer());
  }
  if (!buffer?.length) throw new Error("OpenRouter returned no image");
  if (buffer[0] === 0x89) contentType = "image/png";
  logAiUsage({
    provider: "openrouter",
    model: opts.model,
    capability: "image",
    images: 1,
    costUsd: out.usage?.cost,
    projectId: opts.projectId ?? undefined,
  });
  return { buffer, contentType };
}

export interface OpenRouterVideoInput {
  model: string;
  prompt: string;
  /** The keyframe — becomes the clip's first frame. */
  imageUrl?: string;
  aspectRatio: string;
  durationSec: number;
  /** "720p" / "480p" … (case-insensitive). */
  resolution?: string;
  /** Sent through the provider's own negative-prompt field (Kling, Veo). */
  negativePrompt?: string;
  /** The segment's end keyframe — the clip's last frame, on models that support it. */
  lastImageUrl?: string;
  /** Reproducible takes on models with seed support. */
  seed?: number;
  /** Talking-head clips: keep the model's native audio (Veo speaks the prompt's quoted line, lip-synced). */
  nativeAudio?: boolean;
}

/** Models that honour a last_frame anchor (OpenRouter catalog, 2026-10-06; Wan 3.0 rejects it). */
export const LAST_FRAME_MODEL = /^(google\/veo-3\.1|kwaivgi\/kling-(v3|video-o1)|bytedance\/seedance|alibaba\/wan-2\.7|minimax\/hailuo-3|black-forest-labs\/flux-3-video)/;
const SEED_MODEL = /^(google\/veo|bytedance\/seedance|alibaba\/wan|runway\/gen-4)/;
export const supportsLastFrame = (model: string) => LAST_FRAME_MODEL.test(model);

/**
 * Provider passthrough for the negative prompt: `provider.options.<slug>.parameters.<key>` — unknown
 * slugs or keys are silently dropped. Kling and Wan 2.6/2.7 are served by atlas-cloud.
 */
export function negativeOptions(model: string, negative?: string): Record<string, unknown> | null {
  if (!negative) return null;
  if (/^kwaivgi\//.test(model) || /^alibaba\/wan-2\.[67]/.test(model)) return { options: { "atlas-cloud": { parameters: { negative_prompt: negative } } } };
  if (/^google\/veo/.test(model)) return { options: { "google-vertex": { parameters: { negativePrompt: negative } } } };
  return null;
}

export function openrouterVideoBody(input: OpenRouterVideoInput, withAudioFlag = true, withProvider = true): Record<string, unknown> {
  const provider = withProvider ? negativeOptions(input.model, input.negativePrompt) : null;
  return {
    ...(provider ? { provider } : {}),
    model: input.model,
    prompt: input.prompt,
    aspect_ratio: openrouterAspect(input.aspectRatio),
    duration: Math.round(input.durationSec),
    ...(input.resolution ? { resolution: input.resolution.toLowerCase() } : {}),
    // Our edit lays its own voiceover and music over the clips; silent clips are cheaper. Talking-head
    // clips are the exception: their dialogue is the clip's own audio.
    ...(withAudioFlag ? { generate_audio: !!input.nativeAudio } : {}),
    ...(input.seed !== undefined && SEED_MODEL.test(input.model) ? { seed: input.seed } : {}),
    ...(input.imageUrl || input.lastImageUrl
      ? {
          frame_images: [
            ...(input.imageUrl ? [{ type: "image_url", image_url: { url: input.imageUrl }, frame_type: "first_frame" }] : []),
            ...(input.lastImageUrl && supportsLastFrame(input.model) ? [{ type: "image_url", image_url: { url: input.lastImageUrl }, frame_type: "last_frame" }] : []),
          ],
        }
      : {}),
  };
}

/** Submit a clip; returns the job id to poll. */
export async function submitOpenRouterVideo(input: OpenRouterVideoInput): Promise<string> {
  const send = (withAudioFlag: boolean, withProvider = true) => call<{ id?: string }>("/videos", { body: openrouterVideoBody(input, withAudioFlag, withProvider) });
  const out = await send(true).catch((err) => {
    const msg = String(err instanceof Error ? err.message : err);
    // A model without an audio option rejects the flag; a refused passthrough option is dropped.
    if (/generate_audio|audio/i.test(msg)) return send(false);
    // A model that refuses the end anchor still gets the start anchor (the clip is then trimmed in the edit).
    if (input.lastImageUrl && /last_frame|frame_images/i.test(msg))
      return call<{ id?: string }>("/videos", { body: openrouterVideoBody({ ...input, lastImageUrl: undefined }, true, true) });
    if (/provider|option|negative/i.test(msg)) return send(true, false);
    throw err;
  });
  if (!out.id) throw new Error("OpenRouter accepted the clip but returned no job id");
  return out.id;
}

export interface OpenRouterVideoTask {
  status: "PROCESSING" | "SUCCESS" | "FAIL";
  error?: string;
  costUsd?: number;
}

/** OpenRouter job statuses: pending | in_progress | completed | failed | cancelled | expired. */
export function parseVideoTask(raw: { status?: string; error?: string | { message?: string }; usage?: { cost?: number } }): OpenRouterVideoTask {
  const s = (raw.status ?? "").toLowerCase();
  if (s === "completed") return { status: "SUCCESS", costUsd: raw.usage?.cost };
  if (["failed", "cancelled", "expired"].includes(s)) {
    const e = typeof raw.error === "object" ? raw.error?.message : raw.error;
    return { status: "FAIL", error: e || `OpenRouter video job ${s}` };
  }
  return { status: "PROCESSING" };
}

export async function getOpenRouterVideoTask(jobId: string): Promise<OpenRouterVideoTask> {
  return parseVideoTask(await call(`/videos/${encodeURIComponent(jobId)}`));
}

/** The finished clip's bytes (the content URL needs the key). */
export async function downloadOpenRouterVideo(jobId: string): Promise<Buffer> {
  const key = openrouterKey();
  if (!key) throw new Error("OPENROUTER_API_KEY is not configured");
  const res = await fetch(`${OPENROUTER_BASE_URL}/videos/${encodeURIComponent(jobId)}/content?index=0`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`OpenRouter video download ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new Error("OpenRouter returned an empty clip");
  return buffer;
}
