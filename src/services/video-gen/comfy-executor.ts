/**
 * ComfyUI engine — renders on the operator's own GPU node (COMFYUI_URL), so a
 * clip costs no credits, only GPU time.
 *   image (K<n>) → t2i-keyframe workflow (SDXL-class checkpoint), queued at the
 *                  front so keyframes are not stuck behind long clips
 *   video (V<n>) → i2v-wan22-5b workflow off the uploaded keyframe
 * Outputs are copied into our asset storage; the /view URL is private to the node.
 * The graph walking, claiming and assembly live in server-executor.ts.
 */
import { fetchOutput, getHistory, isComfyConfigured, isPromptQueued, queuePrompt, uploadImage } from "@/services/ai/comfyui";
import { uploadBuffer } from "@/services/storage";
import {
  comfyImageSize,
  comfyVideoSize,
  DEFAULT_NEGATIVE_PROMPT,
  fillWorkflow,
  loadWorkflow,
  parseHistory,
  wanFrameCount,
  type ComfyFileRef,
} from "./comfy-workflows";
import { advanceActiveRuns, driveRun, type EngineAdapter, type JobContext, type TaskResult, type TickResult } from "./server-executor";

const CLIENT_ID = "creativeintel";
const VIDEO_FPS = 24; // Wan 2.2 TI2V 5B native frame rate
const IMAGE_WAIT_MS = 45_000;
const IMAGE_POLL_MS = 3_000;
const MAX_PROMPT_CHARS = 2000;
export const DEFAULT_IMAGE_CHECKPOINT = "sd_xl_base_1.0.safetensors";

function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

function extFor(contentType: string, fallback: string): string {
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return ".jpg";
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("webp")) return ".webp";
  if (contentType.includes("mp4")) return ".mp4";
  if (contentType.includes("webm")) return ".webm";
  if (contentType.includes("gif")) return ".gif";
  return fallback;
}

async function store(file: { buffer: Buffer; contentType: string }, ctx: JobContext, fallbackExt: string): Promise<string> {
  const uploaded = await uploadBuffer({
    buffer: file.buffer,
    filename: `${ctx.nodeName}${extFor(file.contentType, fallbackExt)}`,
    contentType: file.contentType,
    folder: `comfy-runs/${ctx.runId}`,
  });
  if (uploaded.provider === "inline") {
    throw new Error("No asset storage configured for ComfyUI outputs — set CLOUDINARY_URL or BLOB_READ_WRITE_TOKEN");
  }
  return uploaded.url;
}

/** Where a queued prompt stands; copies the chosen output into our storage once it is done. */
async function resolvePrompt(promptId: string, kind: "image" | "video", ctx: JobContext): Promise<TaskResult> {
  let state = parseHistory(await getHistory(promptId), promptId);
  if (state.state === "pending") {
    if (await isPromptQueued(promptId)) return { status: "PROCESSING" };
    // It may have finished between the two calls — look once more before calling it lost.
    state = parseHistory(await getHistory(promptId), promptId);
    if (state.state === "pending") {
      return { status: "FAIL", error: `ComfyUI lost prompt ${promptId} (the node restarted or the queue was cleared)` };
    }
  }
  if (state.state === "error") return { status: "FAIL", error: `ComfyUI: ${state.error}` };
  const pick: ComfyFileRef | undefined = kind === "video" ? state.outputs.videos[0] : state.outputs.images[0];
  if (!pick) return { status: "FAIL", error: `ComfyUI finished with no ${kind} output — check the workflow's save node` };
  const file = await fetchOutput(pick);
  return { status: "SUCCESS", url: await store(file, ctx, kind === "video" ? ".mp4" : ".png") };
}

async function downloadKeyframe(url: string): Promise<{ buffer: Buffer; contentType: string }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Keyframe download ${res.status} for ${url.slice(0, 80)}`);
  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get("content-type")?.split(";")[0] || "image/png",
  };
}

export const comfyAdapter: EngineAdapter = {
  engine: "comfyui",
  workerId: "comfyui-server",
  // One GPU renders one prompt at a time; two in flight keeps it busy between polls.
  maxVideosInFlight: 2,
  imagesPerTick: 3,
  isConfigured: isComfyConfigured,
  notConfiguredError: "COMFYUI_URL is not configured — point it at your ComfyUI node (see docs/comfyui-node.md)",

  async generateImage(prompt, ctx) {
    const workflow = fillWorkflow(await loadWorkflow("t2i"), {
      prompt: prompt.slice(0, MAX_PROMPT_CHARS),
      negative: DEFAULT_NEGATIVE_PROMPT,
      checkpoint: process.env.COMFYUI_IMAGE_CHECKPOINT?.trim() || DEFAULT_IMAGE_CHECKPOINT,
      ...comfyImageSize(ctx.aspectRatio),
      seed: randomSeed(),
    });
    const promptId = await queuePrompt(workflow, { clientId: CLIENT_ID, front: true });
    // Keyframes take seconds on a free GPU: wait briefly, else let later ticks poll it.
    const deadline = Date.now() + IMAGE_WAIT_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, IMAGE_POLL_MS));
      const result = await resolvePrompt(promptId, "image", ctx);
      if (result.status === "SUCCESS") return { url: result.url };
      if (result.status === "FAIL") throw new Error(result.error);
    }
    return { taskId: promptId };
  },

  pollImage(taskId, ctx) {
    return resolvePrompt(taskId, "image", ctx);
  },

  async submitVideo(input, ctx) {
    if (!input.imageUrl) throw new Error("ComfyUI image-to-video needs a keyframe, and this clip has none");
    const keyframe = await downloadKeyframe(input.imageUrl);
    const uploaded = await uploadImage(keyframe.buffer, `${ctx.runId}-${ctx.nodeName}${extFor(keyframe.contentType, ".png")}`, {
      subfolder: "creativeintel",
      overwrite: true,
      contentType: keyframe.contentType,
    });
    const workflow = fillWorkflow(await loadWorkflow("i2v"), {
      prompt: input.prompt.slice(0, MAX_PROMPT_CHARS),
      negative: DEFAULT_NEGATIVE_PROMPT,
      image: uploaded.loadImageName,
      ...comfyVideoSize(ctx.aspectRatio),
      frames: wanFrameCount(ctx.durationSec, VIDEO_FPS),
      fps: VIDEO_FPS,
      seed: randomSeed(),
    });
    return queuePrompt(workflow, { clientId: CLIENT_ID });
  },

  pollVideo(taskId, ctx) {
    return resolvePrompt(taskId, "video", ctx);
  },
};

export function driveComfyRun(runId: string, budgetMs = 270_000): Promise<TickResult> {
  return driveRun(comfyAdapter, runId, budgetMs);
}

export function advanceActiveComfyRuns(budgetMs = 50_000): Promise<number> {
  return advanceActiveRuns(comfyAdapter, budgetMs);
}
