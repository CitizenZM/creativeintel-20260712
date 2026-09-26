/**
 * Zhipu BigModel (bigmodel.cn) — free image and video generation.
 *   CogView-3-Flash   text → image                    free
 *   CogVideoX-Flash   text/image → video (async task)  free, watermarked
 * Docs: https://docs.bigmodel.cn/api-reference/模型-api/视频生成异步.md
 */
import { logAiUsage } from "./usage";

export const ZHIPU_BASE_URL = "https://open.bigmodel.cn/api/paas/v4/";

/** A bring-your-own (paid) Zhipu key; omitted = the free env key. */
export interface ZhipuAuth {
  apiKey: string;
  baseUrl?: string | null;
}

export const ZHIPU_FREE = {
  text: "glm-4.7-flash",
  vision: "glm-4.6v-flash",
  image: "cogview-3-flash",
  video: "cogvideox-flash",
} as const;

export function zhipuKey(): string | undefined {
  return process.env.ZHIPU_API_KEY || process.env.BIGMODEL_API_KEY;
}

export function isZhipuConfigured(): boolean {
  return !!zhipuKey();
}

async function zhipu<T>(path: string, init: { method?: string; body?: unknown; auth?: ZhipuAuth } = {}): Promise<T> {
  const key = init.auth?.apiKey ?? zhipuKey();
  if (!key) throw new Error("ZHIPU_API_KEY is not configured");
  const base = init.auth?.baseUrl || ZHIPU_BASE_URL;
  let lastErr: unknown;
  // Free models are rate-limited per account: back off on 429 instead of failing.
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`${base.endsWith("/") ? base : `${base}/`}${path}`, {
      method: init.method ?? (init.body ? "POST" : "GET"),
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: { code?: string; message?: string } };
    if (res.ok) return data;
    lastErr = new Error(`Zhipu ${path} ${res.status}: ${data.error?.message ?? res.statusText}`);
    if (res.status !== 429 && res.status < 500) throw lastErr;
    await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
  }
  throw lastErr;
}

// ─── Images ─────────────────────────────────────────────────────────────────

/** CogView sizes; the model accepts a fixed set, so map aspect ratios onto it. */
export function cogviewSize(aspectRatio = "9:16"): string {
  if (aspectRatio === "16:9") return "1344x768";
  if (aspectRatio === "1:1") return "1024x1024";
  if (aspectRatio === "4:3") return "1152x864";
  if (aspectRatio === "3:4") return "864x1152";
  return "768x1344"; // 9:16 and anything else vertical
}

export async function generateImage(
  prompt: string,
  opts: { aspectRatio?: string; projectId?: string; model?: string; auth?: ZhipuAuth; costUsd?: number | null; usageProvider?: string } = {}
): Promise<string> {
  const model = opts.model ?? ZHIPU_FREE.image;
  const data = await zhipu<{ data?: { url: string }[] }>("images/generations", {
    body: { model, prompt: prompt.slice(0, 1000), size: cogviewSize(opts.aspectRatio) },
    auth: opts.auth,
  });
  const url = data.data?.[0]?.url;
  if (!url) throw new Error("CogView returned no image");
  logAiUsage({
    provider: opts.auth ? (opts.usageProvider ?? "zhipu-paid") : "glm",
    model,
    capability: "image",
    images: 1,
    costUsd: opts.auth ? (opts.costUsd ?? null) : 0,
    projectId: opts.projectId,
  });
  return url;
}

// ─── Video ──────────────────────────────────────────────────────────────────

export function cogvideoSize(aspectRatio = "9:16"): string {
  if (aspectRatio === "16:9") return "1920x1080";
  if (aspectRatio === "1:1") return "1024x1024";
  return "1080x1920";
}

export interface VideoTask {
  id: string;
  status: "PROCESSING" | "SUCCESS" | "FAIL";
  videoUrl?: string;
  coverUrl?: string;
}

/**
 * Submit an async video task; returns the task id. `model` defaults to the
 * free CogVideoX-Flash; a paid model (cogvideox-3, viduq1-image, …) passes the
 * bring-your-own `auth`. Vidu models take a fixed size, so size/quality/audio
 * are only sent to CogVideoX models.
 */
export async function submitVideo(input: {
  prompt: string;
  imageUrl?: string;
  aspectRatio?: string;
  withAudio?: boolean;
  model?: string;
  auth?: ZhipuAuth;
}): Promise<string> {
  const model = input.model ?? ZHIPU_FREE.video;
  const body: Record<string, unknown> = {
    model,
    // The API caps prompts at 512 characters.
    prompt: input.prompt.slice(0, 500),
  };
  if (model.startsWith("cogvideox")) {
    body.quality = "quality";
    body.with_audio = input.withAudio ?? false;
    body.size = cogvideoSize(input.aspectRatio);
  }
  if (input.imageUrl) body.image_url = input.imageUrl;
  const data = await zhipu<{ id?: string; task_status?: string }>("videos/generations", { body, auth: input.auth });
  if (!data.id) throw new Error("CogVideoX returned no task id");
  return data.id;
}

const _loggedTasks = new Set<string>();

export async function getVideoTask(
  id: string,
  opts: { auth?: ZhipuAuth; usage?: { provider?: string; model?: string; seconds?: number; costUsd?: number | null; projectId?: string } } = {}
): Promise<VideoTask> {
  const data = await zhipu<{
    task_status?: string;
    video_result?: { url?: string; cover_image_url?: string }[];
  }>(`async-result/${encodeURIComponent(id)}`, { auth: opts.auth });
  const status = (data.task_status as VideoTask["status"]) ?? "PROCESSING";
  const first = data.video_result?.[0];
  if (status === "SUCCESS" && first?.url && !_loggedTasks.has(id)) {
    _loggedTasks.add(id);
    logAiUsage({
      provider: opts.auth ? (opts.usage?.provider ?? "zhipu-paid") : "glm",
      model: opts.usage?.model ?? ZHIPU_FREE.video,
      capability: "video",
      // Zhipu doesn't publish CogVideoX-Flash's clip length; the catalogue assumes 5 s.
      videoSeconds: opts.usage?.seconds ?? 5,
      costUsd: opts.auth ? (opts.usage?.costUsd ?? null) : 0,
      projectId: opts.usage?.projectId,
    });
  }
  return { id, status, videoUrl: first?.url, coverUrl: first?.cover_image_url };
}

// ─── Persisting results ─────────────────────────────────────────────────────
// Zhipu's result URLs are temporary; copy anything we keep into our storage.

export async function persistResult(url: string, folder: string, filename: string): Promise<string> {
  const { uploadFromUrl } = await import("@/services/storage");
  try {
    const up = await uploadFromUrl(url, { folder, filename });
    return up.provider === "inline" ? url : up.url;
  } catch {
    return url;
  }
}

/** Free image for a prompt, stored in our asset storage. */
export async function generateImagePersisted(
  prompt: string,
  opts: Parameters<typeof generateImage>[1] & { folder?: string } = {}
): Promise<string> {
  const url = await generateImage(prompt, opts);
  return persistResult(url, opts.folder ?? "glm-images", `cogview-${Date.now()}.png`);
}
