/**
 * Matrix (摩智视界, mzsjai.com) — a paid model gateway with production image
 * and video models: ByteDance Seedance 2.x image-to-video, Seedream and
 * Qwen-Image stills. Images use the OpenAI images API; clips use Volcengine
 * Ark's task API (`/api/v3/contents/generations/tasks`), with the keyframe as
 * the clip's first frame so the shot keeps its look.
 *
 * Seedance and Seedream need the account's *paid* quota: on gift credit the
 * gateway answers 403 "requires quota source paid" (surfaced as-is).
 */
import { logAiUsage } from "@/services/ai/usage";

export const MATRIX_BASE_URL = (process.env.MATRIX_BASE_URL || "https://mzsjai.com").replace(/\/+$/, "");

export function matrixKey(): string | undefined {
  return process.env.MATRIX_API_KEY || undefined;
}

export function isMatrixConfigured(): boolean {
  return !!matrixKey();
}

async function call<T>(path: string, init: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  const key = matrixKey();
  if (!key) throw new Error("MATRIX_API_KEY is not configured");
  const res = await fetch(`${MATRIX_BASE_URL}${path}`, {
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
    throw new Error(`Matrix ${res.status}: ${msg}`);
  }
  return json as T;
}

/** Image sizes per aspect ratio — Qwen-Image's native vertical is 928×1664. */
export function matrixImageSize(aspectRatio: string): string {
  if (aspectRatio === "16:9") return "1664x928";
  if (aspectRatio === "1:1") return "1328x1328";
  if (aspectRatio === "4:3") return "1472x1140";
  if (aspectRatio === "3:4") return "1140x1472";
  return "928x1664";
}

/** One still; returns the image bytes (the gateway answers base64 or a URL). */
export async function generateMatrixImage(
  prompt: string,
  opts: { model: string; aspectRatio: string; projectId?: string | null }
): Promise<{ buffer: Buffer; contentType: string }> {
  const out = await call<{ data?: { b64_json?: string; url?: string }[] }>("/v1/images/generations", {
    body: { model: opts.model, prompt, size: matrixImageSize(opts.aspectRatio), n: 1 },
    timeoutMs: 170_000,
  });
  const item = out.data?.[0];
  let buffer: Buffer | null = null;
  let contentType = "image/jpeg";
  if (item?.b64_json) buffer = Buffer.from(item.b64_json, "base64");
  else if (item?.url && /^https?:\/\//.test(item.url)) {
    const res = await fetch(item.url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`Matrix image download ${res.status}`);
    contentType = res.headers.get("content-type")?.split(";")[0] || contentType;
    buffer = Buffer.from(await res.arrayBuffer());
  }
  if (!buffer?.length) throw new Error("Matrix returned no image");
  if (buffer[0] === 0x89) contentType = "image/png";
  logAiUsage({ provider: "matrix", model: opts.model, capability: "image", images: 1, projectId: opts.projectId ?? undefined });
  return { buffer, contentType };
}

export interface SeedanceInput {
  model: string;
  prompt: string;
  /** The keyframe — becomes the clip's first frame. */
  imageUrl?: string;
  aspectRatio: string;
  durationSec: number;
}

/** Ark task body: text + first-frame image; ratio, duration and no watermark as parameters. */
export function seedanceBody(input: SeedanceInput): Record<string, unknown> {
  const content: Record<string, unknown>[] = [{ type: "text", text: input.prompt }];
  if (input.imageUrl) content.push({ type: "image_url", image_url: { url: input.imageUrl }, role: "first_frame" });
  return {
    model: input.model,
    content,
    ratio: input.aspectRatio,
    duration: Math.round(input.durationSec),
    watermark: false,
  };
}

export async function submitSeedance(input: SeedanceInput): Promise<string> {
  const out = await call<{ id?: string; task_id?: string }>("/api/v3/contents/generations/tasks", {
    body: seedanceBody(input),
  });
  const id = out.id || out.task_id;
  if (!id) throw new Error("Matrix accepted the clip but returned no task id");
  return id;
}

export interface SeedanceTask {
  status: "PROCESSING" | "SUCCESS" | "FAIL";
  videoUrl?: string;
  error?: string;
}

/** Ark statuses: queued | running | succeeded | failed | cancelled | expired. */
export function parseSeedanceTask(raw: {
  status?: string;
  content?: { video_url?: string };
  error?: { message?: string } | null;
}): SeedanceTask {
  const s = (raw.status ?? "").toLowerCase();
  if (s === "succeeded" && raw.content?.video_url) return { status: "SUCCESS", videoUrl: raw.content.video_url };
  if (["failed", "cancelled", "expired"].includes(s) || (s === "succeeded" && !raw.content?.video_url)) {
    return { status: "FAIL", error: raw.error?.message || `Seedance task ${s || "failed"}` };
  }
  return { status: "PROCESSING" };
}

export async function getSeedanceTask(taskId: string): Promise<SeedanceTask> {
  const raw = await call<Parameters<typeof parseSeedanceTask>[0]>(`/api/v3/contents/generations/tasks/${encodeURIComponent(taskId)}`);
  return parseSeedanceTask(raw);
}

/**
 * Edit a reference image into a new shot (Qwen-Image-Edit): the person or
 * product in the reference keeps its identity — the basis of the cast lock.
 * Multipart, like the OpenAI images/edits API.
 */
export async function editMatrixImage(
  prompt: string,
  referenceUrls: string | string[],
  opts: { model?: string; projectId?: string | null } = {}
): Promise<{ buffer: Buffer; contentType: string }> {
  const key = matrixKey();
  if (!key) throw new Error("MATRIX_API_KEY is not configured");
  const form = new FormData();
  const model = opts.model ?? "qwen/qwen-image-edit";
  form.set("model", model);
  form.set("prompt", prompt);
  form.set("n", "1");
  // Several references (person + product) compose into one scene, in order.
  for (const [i, url] of (Array.isArray(referenceUrls) ? referenceUrls : [referenceUrls]).entries()) {
    const ref = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!ref.ok) throw new Error(`Reference image download ${ref.status}`);
    const refType = ref.headers.get("content-type")?.split(";")[0] || "image/jpeg";
    form.append("image", new Blob([await ref.arrayBuffer()], { type: refType }), `ref${i}.${refType.includes("png") ? "png" : "jpg"}`);
  }
  const res = await fetch(`${MATRIX_BASE_URL}/v1/images/edits`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(170_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Matrix ${res.status}: ${text.slice(0, 200)}`);
  const out = JSON.parse(text) as { data?: { b64_json?: string; url?: string }[]; error?: unknown };
  const b64 = out.data?.[0]?.b64_json;
  if (!b64) throw new Error(`Matrix edit returned no image${out.error ? `: ${JSON.stringify(out.error).slice(0, 160)}` : ""}`);
  const buffer = Buffer.from(b64, "base64");
  logAiUsage({ provider: "matrix", model, capability: "image", images: 1, projectId: opts.projectId ?? undefined });
  return { buffer, contentType: buffer[0] === 0x89 ? "image/png" : "image/jpeg" };
}

/**
 * Keep the reference's identity; describe only the new shot. Matrix's edit
 * endpoint rewrites the prompt and fails on long ones (measured: 240 chars ok,
 * 1,800 → 502 prompt_rewrite_failed), so the shot is cut to its first two
 * sentences after dropping the no-text preamble.
 */
export type EditFrom = "cast" | "product" | "cast+product";

export function lockedEditPrompt(kind: EditFrom, shot: string, opts: { maxChars?: number } = {}): string {
  const keep =
    kind === "cast"
      ? "Keep this exact person unchanged — same face, hair, skin tone, build and wardrobe."
      : kind === "product"
        ? "Keep this exact product unchanged — same shape, colour, proportions, bezel thickness, screen and logo placement."
        : "Person or people from image 1 (same faces, hair, skin tone, wardrobe) with the exact product from image 2 (same shape, bezel thickness, screen, logo), product prominent.";
  const body = shot
    .replace(/^No text, letters[^.]*\.\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  // Matrix rewrites (and chokes on) long prompts; OpenRouter models take the whole directed shot.
  const sentences = body.split(/(?<=[.!?])\s+/).slice(0, opts.maxChars ? 12 : 2).join(" ");
  const tail = "One single photograph of one continuous scene — no collage, split screen or panels; no text on screens or signs.";
  const room = (opts.maxChars ?? 430) - keep.length - tail.length - 14;
  const cut = sentences.length > room ? `${sentences.slice(0, room).replace(/\s+\S*$/, "")}.` : sentences;
  return `${keep} New shot: ${cut} ${tail}`;
}
