import { createHmac } from "node:crypto";

const BASE_URL = "https://api-gen-na.bach.art/api/vdr";
type BachData = { task_id?: string; status?: string; video_url?: string; image_urls?: string[]; [key: string]: unknown };

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

export function bachConfigured(): boolean {
  return !!process.env.BACH_ACCESS_KEY && !!process.env.BACH_SECRET_KEY;
}

export function createBachToken(nowMs = Date.now()): string {
  const accessKey = process.env.BACH_ACCESS_KEY;
  const secretKey = process.env.BACH_SECRET_KEY;
  if (!accessKey || !secretKey) throw new Error("Bach API credentials are not configured");
  const now = Math.floor(nowMs / 1000);
  const unsigned = `${base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${base64url(JSON.stringify({ iss: accessKey, nbf: now - 5, exp: now + 600 }))}`;
  const signature = createHmac("sha256", secretKey).update(unsigned).digest();
  return `${unsigned}.${base64url(signature)}`;
}

async function bachFetch(path: string, init: RequestInit = {}): Promise<BachData> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${createBachToken()}`, "Content-Type": "application/json", ...init.headers },
    signal: init.signal ?? AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => ({})) as { code?: number; message?: string; data?: BachData };
  if (!response.ok || (typeof payload.code === "number" && payload.code !== 200)) {
    throw new Error(`Bach API request failed (${response.status}, code ${payload.code ?? "unknown"})`);
  }
  return payload.data ?? {};
}

export async function submitBachVideo(input: {
  prompt: string;
  duration: number;
  aspectRatio: string;
  resolution: string;
  modelName?: "chrome" | "chrome-ads";
  imageUrl?: string;
  endImageUrl?: string;
  generateAudio?: boolean;
}): Promise<string> {
  if (input.prompt.length > 6500) throw new Error("Bach prompt exceeds the 6,500 character limit");
  const task = input.imageUrl || input.endImageUrl ? "i2v" : "t2v";
  const data = await bachFetch("/video/chrome", {
    method: "POST",
    body: JSON.stringify({
      model_name: input.modelName ?? "chrome",
      enhance_prompt: true,
      input: {
        task,
        prompt: input.prompt,
        duration: Math.max(5, Math.min(15, Math.round(input.duration))),
        generate_audio: input.generateAudio ?? true,
        aspect_ratio: task === "i2v" ? "auto" : input.aspectRatio,
        resolution: input.resolution.toLowerCase(),
        ...(input.imageUrl ? { image_url: input.imageUrl } : {}),
        ...(input.endImageUrl ? { end_image_url: input.endImageUrl } : {}),
      },
    }),
  });
  if (!data.task_id) throw new Error("Bach API response did not include a task ID");
  return String(data.task_id);
}

export async function pollBachVideo(taskId: string): Promise<{ status: "processing" | "completed" | "failed"; videoUrl?: string; error?: string }> {
  const data = await bachFetch(`/video/chrome/${encodeURIComponent(taskId)}`, { method: "GET" });
  const status = String(data.status ?? "").toUpperCase();
  if (status === "TASK_SUCCEEDED" && typeof data.video_url === "string") return { status: "completed", videoUrl: data.video_url };
  if (status === "TASK_FAILED") return { status: "failed", error: "Bach video generation failed" };
  return { status: "processing" };
}

export async function generateBachImage(input: {
  prompt: string;
  aspectRatio?: string;
  imageSize?: "1K" | "2K" | "4K";
  quality?: "low" | "medium" | "high";
  referenceImageUrls?: string[];
}, deadlineAt: number): Promise<string> {
  const created = await bachFetch("/images/text2image", {
    method: "POST",
    body: JSON.stringify({
      prompt: input.prompt.slice(0, 10_000),
      aspect_ratio: input.aspectRatio ?? "1:1",
      image_size: input.imageSize ?? "2K",
      quality: input.quality ?? "medium",
      output_count: 1,
      output_mime_type: "image/png",
      ...(input.referenceImageUrls?.length ? { reference_image_urls: input.referenceImageUrls.slice(0, 8) } : {}),
    }),
    signal: AbortSignal.timeout(Math.min(30_000, Math.max(1, deadlineAt - Date.now()))),
  });
  if (!created.task_id) throw new Error("Bach image response did not include a task ID");
  const taskId = encodeURIComponent(String(created.task_id));
  while (Date.now() < deadlineAt) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(2_000, Math.max(0, deadlineAt - Date.now()))));
    const result = await bachFetch(`/images/text2image/${taskId}`, { method: "GET", signal: AbortSignal.timeout(Math.min(20_000, Math.max(1, deadlineAt - Date.now()))) });
    const status = String(result.status ?? "").toUpperCase();
    if (status === "TASK_FAILED") throw new Error("Bach image generation failed");
    if (status === "TASK_SUCCEEDED") {
      const url = Array.isArray(result.image_urls) ? result.image_urls[0] : undefined;
      if (typeof url === "string") return url;
      throw new Error("Bach image task succeeded without an image URL");
    }
  }
  throw new Error("Bach image generation exceeded its request deadline");
}
