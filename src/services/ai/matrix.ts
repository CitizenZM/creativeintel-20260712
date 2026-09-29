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
