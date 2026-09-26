/**
 * Animatic engine — the render path that needs no key, no GPU and no credits,
 * so a run can always reach a master video:
 *   image (K<n>) → Pollinations (Flux, free, no key), stored in our assets
 *   video (V<n>) → the keyframe animated with a slow zoom and pan (FFmpeg
 *                  zoompan, on the server) for the clip's duration
 * It is an animatic for reviewing story and timing, not AI motion; GLM,
 * ComfyUI or LibTV give real motion. Graph walking and assembly live in
 * server-executor.ts, exactly as for the other server engines.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { uploadBuffer } from "@/services/storage";
import { logAiUsage } from "@/services/ai/usage";
import { canvasFor } from "./glm-assemble";
import { driveRun, type EngineAdapter, type JobContext, type TickResult } from "./server-executor";

const run = promisify(execFile);
const FPS = 30;
const MAX_PROMPT_CHARS = 900;

/** Pollinations accepts any size; keep keyframes near 1 MP in the run's aspect. */
export function stillSize(aspectRatio: string): { width: number; height: number } {
  if (aspectRatio === "16:9") return { width: 1344, height: 768 };
  if (aspectRatio === "1:1") return { width: 1024, height: 1024 };
  if (aspectRatio === "4:3") return { width: 1152, height: 864 };
  if (aspectRatio === "3:4") return { width: 864, height: 1152 };
  return { width: 768, height: 1344 };
}

/**
 * FFmpeg filter for a slow push-in (odd clips pan the other way so cuts don't
 * feel identical). Upscaling first keeps zoompan from jittering.
 */
export function kenBurnsFilter(aspectRatio: string, durationSec: number, variant: number): string {
  const { w, h } = canvasFor(aspectRatio);
  const frames = Math.max(1, Math.round(durationSec * FPS));
  const step = (0.12 / frames).toFixed(5); // ~12% zoom over the clip
  const x = variant % 2 ? "iw/2-(iw/zoom/2)+(iw/zoom/12)*(on/" + frames + ")" : "iw/2-(iw/zoom/2)";
  return [
    `scale=${w * 2}:${h * 2}:force_original_aspect_ratio=increase`,
    `crop=${w * 2}:${h * 2}`,
    `zoompan=z='min(zoom+${step},1.12)':d=${frames}:x='${x}':y='ih/2-(ih/zoom/2)':s=${w}x${h}:fps=${FPS}`,
    "format=yuv420p",
  ].join(",");
}

async function store(buffer: Buffer, contentType: string, ctx: JobContext, ext: string): Promise<string> {
  const up = await uploadBuffer({ buffer, filename: `${ctx.nodeName}${ext}`, contentType, folder: `animatic-runs/${ctx.runId}` });
  if (up.provider === "inline") throw new Error("No asset storage configured — set BLOB_READ_WRITE_TOKEN or CLOUDINARY_URL");
  return up.url;
}

/** Wait before retrying Pollinations: honour Retry-After on 429, else back off. */
export function pollinationsBackoffMs(status: number, retryAfter: string | null, attempt: number): number {
  const header = Number(retryAfter);
  if (status === 429 && Number.isFinite(header) && header > 0) return Math.min(header, 60) * 1000;
  return (status === 429 ? 10_000 : 3_000) * (attempt + 1);
}

async function pollinationsStill(prompt: string, ctx: JobContext): Promise<string> {
  const { width, height } = stillSize(ctx.aspectRatio);
  let lastErr: unknown;
  // The anonymous tier allows about one request at a time per IP: another run
  // rendering in parallel gets 429s, so wait them out rather than fail the run.
  for (let attempt = 0; attempt < 6; attempt++) {
    const seed = Math.floor(Math.random() * 999_999);
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.slice(0, MAX_PROMPT_CHARS))}?width=${width}&height=${height}&seed=${seed}&nologo=true&model=flux&nofeed=true`;
    let status = 0;
    let retryAfter: string | null = null;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      status = res.status;
      retryAfter = res.headers.get("retry-after");
      const type = res.headers.get("content-type")?.split(";")[0] ?? "";
      if (!res.ok || !type.startsWith("image/")) throw new Error(`Pollinations ${res.status} ${type}`);
      const stored = await store(Buffer.from(await res.arrayBuffer()), type, ctx, type.includes("png") ? ".png" : ".jpg");
      logAiUsage({ provider: "pollinations", model: "flux", capability: "image", images: 1, costUsd: 0 });
      return stored;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, pollinationsBackoffMs(status, retryAfter, attempt)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Pollinations failed");
}

async function animateStill(imageUrl: string, ctx: JobContext): Promise<string> {
  if (!ffmpegPath) throw new Error("ffmpeg is not available on this server");
  const res = await fetch(imageUrl, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Keyframe download ${res.status}`);
  const dir = await mkdtemp(path.join(tmpdir(), `animatic-${ctx.nodeName}-`));
  try {
    const src = path.join(dir, "still.img");
    const out = path.join(dir, "clip.mp4");
    await writeFile(src, Buffer.from(await res.arrayBuffer()));
    const variant = Number(ctx.nodeName.replace(/\D/g, "")) || 0;
    await run(
      ffmpegPath,
      ["-y", "-v", "error", "-loop", "1", "-i", src, "-t", String(ctx.durationSec), "-vf", kenBurnsFilter(ctx.aspectRatio, ctx.durationSec, variant), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-movflags", "+faststart", out],
      { timeout: 120_000 }
    );
    const url = await store(await readFile(out), "video/mp4", ctx, ".mp4");
    logAiUsage({ provider: "animatic", model: "ffmpeg-zoompan", capability: "video", videoSeconds: ctx.durationSec, costUsd: 0 });
    return url;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export const animaticAdapter: EngineAdapter = {
  engine: "animatic",
  workerId: "animatic-server",
  // FFmpeg on a serverless CPU: a couple of clips per tick keeps each tick short.
  maxVideosInFlight: 2,
  // One keyframe at a time: Pollinations' free tier rate-limits parallel requests.
  imagesPerTick: 1,
  isConfigured: () => true,
  notConfiguredError: "",

  async generateImage(prompt, ctx) {
    return { url: await pollinationsStill(prompt, ctx) };
  },

  // The clip is rendered synchronously; its stored URL doubles as the task id.
  async submitVideo(input, ctx) {
    if (!input.imageUrl) throw new Error("An animatic clip needs its keyframe, and this clip has none");
    return animateStill(input.imageUrl, ctx);
  },

  async pollVideo(taskId) {
    return { status: "SUCCESS", url: taskId };
  },
};

export function driveAnimaticRun(runId: string, budgetMs = 270_000): Promise<TickResult> {
  return driveRun(animaticAdapter, runId, budgetMs);
}
