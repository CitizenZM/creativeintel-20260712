import { remainingRequestMs } from "./request-budget";
/**
 * Image generation across engines, in the order Settings → AI engines picks:
 * the chosen engine first, then the calling route's usual order. Strict free
 * mode keeps only the free engines (Zhipu CogView-3-Flash, Pollinations).
 *
 * Engines: glm (CogView-3-Flash, free) · openai (gpt-image-1) · fal (Flux
 * Schnell) · pollinations (free, no key) · custom:<id> (bring-your-own
 * openai-compatible / paid Zhipu / fal provider). An engine without its key is
 * skipped; a failing one falls through to the next.
 */
import OpenAI from "openai";
import { isStrictFree, paidFallbackAllowed } from "@/lib/cost-mode";
import { DEFAULT_PRICES, imageCostUsd } from "@/services/ops/cost-model";
import { cachedAiSettings, cachedProvider, loadAiSettings } from "@/services/settings/ai-settings";
import { CUSTOM_PREFIX, routeOrder } from "@/services/settings/ai-settings-core";
import { generateImagePersisted, isZhipuConfigured } from "./zhipu";
import { logAiUsage } from "./usage";
import { fluxSchnellCost } from "./usage-core";
import { uploadBuffer } from "@/services/storage";
import { assertAccountAllowance } from "@/services/ops/account-allowance";
import { generateBachImage } from "@/services/video-gen/bach";
import { safeFetchBuffer } from "@/lib/safe-fetch";

export type ImageEngineId = "glm" | "openai" | "fal" | "pollinations" | "bach" | `custom:${string}`;

export interface ImageRequest {
  prompt: string;
  /** Source packshots for engines that support image-guided editing. */
  referenceImageUrls?: string[];
  /** Whole generation plus fallback/persistence budget; default 150 seconds. */
  budgetMs?: number;
  shape: "landscape" | "square" | "portrait";
  openaiQuality: "low" | "medium";
  pollinations: { width: number; height: number; as: "url" | "dataUrl" };
  /** Storage folder for persisted results. */
  folder: string;
  projectId?: string;
  /** The route's usual order when no engine is chosen (free = strict free mode). */
  defaults: { free: ImageEngineId[]; paid: ImageEngineId[] };
}

// fal.ai caps the account at 10 concurrent requests and answers the eleventh
// with a 429 — 23 frame generations were lost that way. Hold a slot instead of
// relying on their limiter to say no.
const FAL_MAX_CONCURRENT = 9;
let falActive = 0;
const falWaiting: Array<() => void> = [];

async function acquireFalSlot(deadlineAt: number): Promise<() => void> {
  if (falActive >= FAL_MAX_CONCURRENT) {
    await new Promise<void>((resolve, reject) => {
      const wake = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => {
        const index = falWaiting.indexOf(wake);
        if (index >= 0) falWaiting.splice(index, 1);
        reject(new Error("Image request deadline exceeded while queued"));
      }, remainingRequestMs(deadlineAt));
      falWaiting.push(wake);
    });
  }
  falActive++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    falActive--;
    falWaiting.shift()?.();
  };
}

async function falGenerate(key: string, model: string, req: ImageRequest, deadlineAt: number): Promise<{ url: string; costUsd: number | null }> {
  const release = await acquireFalSlot(deadlineAt);
  try {
    const res = await fetch(`https://fal.run/${model}`, {
      method: "POST",
      headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: req.prompt,
        image_size: req.shape === "square" ? "square" : req.shape === "portrait" ? "portrait_9_16" : "landscape_16_9",
        num_inference_steps: 4,
        num_images: 1,
        enable_safety_checker: false,
      }),
      signal: AbortSignal.timeout(remainingRequestMs(deadlineAt, 25_000)),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`fal.ai ${model} error ${res.status}: ${err.slice(0, 100)}`);
    }
    const data = await res.json();
    const url = data?.images?.[0]?.url;
    if (!url) throw new Error("fal.ai returned no image URL");
    const image = data.images[0];
    return { url, costUsd: model === "fal-ai/flux/schnell" ? fluxSchnellCost(image.width, image.height) : null };
  } finally {
    release();
  }
}

async function openaiImage(client: OpenAI, model: string, req: ImageRequest, withQuality: boolean, deadlineAt: number): Promise<string> {
  const size = req.shape === "landscape" ? "1536x1024" : req.shape === "portrait" ? "1024x1536" : "1024x1024";
  const response = await client.images.generate({
    model,
    prompt: req.prompt,
    n: 1,
    size: size as "1024x1024" | "1536x1024" | "1024x1536",
    ...(withQuality ? { quality: req.openaiQuality } : {}),
  }, { timeout: remainingRequestMs(deadlineAt, 90_000), signal: AbortSignal.timeout(remainingRequestMs(deadlineAt)), maxRetries: 0 });
  const b64 = response.data?.[0]?.b64_json;
  if (b64) return `data:image/png;base64,${b64}`;
  const url = response.data?.[0]?.url;
  if (url) return url;
  throw new Error(`${model} returned no image data`);
}

async function pollinations(req: ImageRequest, deadlineAt: number): Promise<string> {
  const encoded = encodeURIComponent(req.prompt);
  const seed = Math.floor(Math.random() * 999999);
  const { width, height } = req.pollinations;
  const url = `https://image.pollinations.ai/prompt/${encoded}?width=${width}&height=${height}&seed=${seed}&nologo=true&model=flux&nofeed=true`;
  const res = await fetch(url, { signal: AbortSignal.timeout(remainingRequestMs(deadlineAt, 25_000)) });
  if (!res.ok) throw new Error(`Pollinations error: ${res.status}`);
  if (req.pollinations.as === "url") return url;
  const b64 = Buffer.from(await res.arrayBuffer()).toString("base64");
  return `data:${res.headers.get("content-type") || "image/jpeg"};base64,${b64}`;
}

/** One engine's attempt; null = not configured (skip). */
async function runEngine(engine: ImageEngineId, req: ImageRequest, deadlineAt: number): Promise<string | null> {
  const aspectRatio = req.shape === "square" ? "1:1" : req.shape === "portrait" ? "9:16" : "16:9";
  if (engine === "glm") {
    if (!isZhipuConfigured()) return null;
    return generateImagePersisted(req.prompt, { aspectRatio, folder: req.folder, projectId: req.projectId, deadlineAt });
  }
  if (engine === "openai") {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return null;
    const url = await openaiImage(new OpenAI({ apiKey: key }), "gpt-image-1", req, true, deadlineAt);
    await logAiUsage({ provider: "openai", model: "gpt-image-1", capability: "image", images: 1, costUsd: null, projectId: req.projectId });
    return url;
  }
  if (engine === "fal") {
    const key = process.env.FAL_KEY;
    if (!key) return null;
    const { url, costUsd } = await falGenerate(key, "fal-ai/flux/schnell", req, deadlineAt);
    await logAiUsage({ provider: "fal", model: "fal-ai/flux/schnell", capability: "image", images: 1, costUsd, projectId: req.projectId });
    return url;
  }
  if (engine === "pollinations") {
    const url = await pollinations(req, deadlineAt);
    await logAiUsage({ provider: "pollinations", model: "flux", capability: "image", images: 1, costUsd: 0, projectId: req.projectId });
    return url;
  }
  if (engine === "bach") {
    if (!process.env.BACH_ACCESS_KEY || !process.env.BACH_SECRET_KEY) return null;
    const sourceUrl = await generateBachImage({
      prompt: req.prompt,
      aspectRatio,
      imageSize: "2K",
      quality: req.openaiQuality === "low" ? "low" : "medium",
      referenceImageUrls: req.referenceImageUrls?.slice(0, 4),
    }, deadlineAt);
    await logAiUsage({ provider: "bach", model: "gpt-image2-economy", capability: "image", images: 1, costUsd: null, projectId: req.projectId });
    const fetched = await safeFetchBuffer(sourceUrl, { timeoutMs: remainingRequestMs(deadlineAt, 25_000), maxBytes: 20 * 1024 * 1024 });
    if (!fetched.ok || !fetched.buffer) return sourceUrl;
    const uploaded = await uploadBuffer({ buffer: fetched.buffer, filename: `bach-${Date.now()}.jpg`, contentType: fetched.contentType || "image/jpeg", folder: req.folder, signal: AbortSignal.timeout(remainingRequestMs(deadlineAt)) });
    return uploaded.provider === "inline" ? sourceUrl : uploaded.url;
  }

  // Bring-your-own provider.
  const p = cachedProvider(engine.slice(CUSTOM_PREFIX.length));
  const model = p?.models.image;
  if (!p || !model) return null;
  if (!p.apiKey) throw new Error(`Provider "${p.name}": ${p.keyError ?? "key unavailable"}`);
  const costUsd = p.prices?.perImageUsd ?? null;
  if (p.type === "zhipu-paid") {
    return generateImagePersisted(req.prompt, {
      aspectRatio,
      folder: req.folder,
      projectId: req.projectId,
      model,
      auth: { apiKey: p.apiKey, baseUrl: p.baseUrl },
      costUsd,
      usageProvider: engine,
      deadlineAt,
    });
  }
  const url =
    p.type === "fal"
      ? (await falGenerate(p.apiKey, model, req, deadlineAt)).url
      : await openaiImage(new OpenAI({ apiKey: p.apiKey, baseURL: p.baseUrl ?? undefined }), model, req, false, deadlineAt);
  await logAiUsage({ provider: engine, model, capability: "image", images: 1, costUsd, projectId: req.projectId });
  return url;
}

/** The engines this request will try, in order. */
export async function imageEngineOrder(defaults: ImageRequest["defaults"]): Promise<ImageEngineId[]> {
  await loadAiSettings();
  const strict = isStrictFree();
  return routeOrder(cachedAiSettings().settings.image, strict ? defaults.free : defaults.paid, {
    strictFree: strict,
    freeIds: ["glm", "pollinations"],
  }) as ImageEngineId[];
}

/** Only Bach currently sends reference photos to its image endpoint. */
export function imageOrderForRequest(order: ImageEngineId[], referenceImageUrls?: string[]): ImageEngineId[] {
  return referenceImageUrls?.some((url) => url.trim()) ? order.filter((engine) => engine === "bach") : order;
}

/**
 * gpt-image-1 and Pollinations can hand back base64. Kept as-is, a ~4 MB data
 * URI lands in the storyboard's frames JSON — one Ramp storyboard grew to 12 MB,
 * so listing storyboards took 14 s and every frame approval rewrote it. Store
 * the bytes and keep the URL; only fall back to the data URI with no storage.
 */
export async function persistDataUrl(url: string, folder: string, deadlineAt?: number): Promise<string> {
  const m = /^data:([^;,]+);base64,([\s\S]*)$/.exec(url);
  if (!m) return url;
  try {
    const up = await uploadBuffer({
      buffer: Buffer.from(m[2], "base64"),
      filename: `image-${Date.now()}.${m[1].split("/")[1] || "png"}`,
      contentType: m[1],
      folder,
      signal: deadlineAt === undefined ? undefined : AbortSignal.timeout(remainingRequestMs(deadlineAt)),
    });
    return up.provider === "inline" ? url : up.url;
  } catch (err) {
    console.warn("[image] could not store generated image, keeping it inline:", err instanceof Error ? err.message : err);
    return url;
  }
}

export async function generateImageByEngine(req: ImageRequest): Promise<string> {
  const budgetMs = Math.max(1, Math.min(150_000, req.budgetMs ?? 150_000));
  const deadlineAt = Date.now() + budgetMs;
  // A member account past its monthly allowance gets no more paid images (no-op for the admin).
  // Estimated at the priciest engine in the fallback order (gpt-image-1) — the engine isn't known
  // yet — unless strict free mode without paid fallback makes the call free by construction.
  await loadAiSettings();
  const mayCost = !(isStrictFree() && !paidFallbackAllowed());
  await assertAccountAllowance(req.projectId, mayCost ? imageCostUsd(DEFAULT_PRICES, "gpt-image-1").usd ?? 0.042 : 0, {
    kind: "image",
    model: "image-engine",
  });
  const order = imageOrderForRequest(await imageEngineOrder(req.defaults), req.referenceImageUrls);
  if (!order.length && req.referenceImageUrls?.some((url) => url.trim())) {
    throw new Error("No reference-capable image engine is available; cannot generate a product keyframe without its reference photo");
  }
  let lastErr: unknown = null;
  for (const engine of order) {
    remainingRequestMs(deadlineAt);
    try {
      const url = await runEngine(engine, req, deadlineAt);
      if (url) return persistDataUrl(url, req.folder, deadlineAt);
    } catch (err) {
      lastErr = err;
      console.warn(`[image] ${engine} failed, trying the next engine:`, err instanceof Error ? err.message : err);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("No image engine is configured");
}
