import { safeFetchBuffer } from "@/lib/safe-fetch";
import { uploadBuffer } from "@/services/storage";
import { logAiUsage } from "@/services/ai/usage";
import { generateImageByEngine } from "@/services/ai/image-engine";
import { bachConfigured, pollBachVideo, submitBachVideo } from "./bach";
import { applyCorrections } from "./consistency/corrections";
import { driveRun, type EngineAdapter, type TaskResult } from "./server-executor";

const MODEL = "bach-chrome";
const COST_PER_SECOND = 0.5;

export const bachAdapter: EngineAdapter = {
  engine: "bach",
  workerId: "bach-server",
  maxVideosInFlight: 3,
  imagesPerTick: 3,
  isConfigured: bachConfigured,
  notConfiguredError: "BACH_ACCESS_KEY / BACH_SECRET_KEY are not configured",

  async generateImage(prompt, ctx) {
    const url = await generateImageByEngine({
      prompt: applyCorrections(prompt, Array.isArray(ctx.settings?.qcCorrections) ? ctx.settings.qcCorrections as string[] : undefined),
      shape: ctx.aspectRatio === "1:1" ? "square" : ctx.aspectRatio === "9:16" ? "portrait" : "landscape",
      openaiQuality: "medium",
      pollinations: ctx.aspectRatio === "9:16" ? { width: 576, height: 1024, as: "url" } : { width: 1024, height: 576, as: "url" },
      folder: `bach-runs/${ctx.runId}`,
      projectId: ctx.projectId,
      defaults: { free: ["glm", "pollinations"], paid: ["bach", "openai", "fal", "pollinations"] },
    });
    if (!/^https:\/\//i.test(url)) throw new Error("Bach image-to-video requires a publicly reachable keyframe URL");
    return { url };
  },

  submitVideo(input, ctx) {
    return submitBachVideo({
      prompt: input.prompt,
      imageUrl: input.imageUrl,
      endImageUrl: input.lastImageUrl,
      duration: ctx.durationSec,
      aspectRatio: ctx.aspectRatio,
      resolution: String(ctx.settings?.resolution ?? "720P"),
      generateAudio: !!ctx.settings?.nativeAudio,
    });
  },

  async pollVideo(taskId, ctx): Promise<TaskResult> {
    const task = await pollBachVideo(taskId);
    if (task.status === "failed") return { status: "FAIL", error: task.error ?? "Bach video generation failed" };
    if (task.status !== "completed" || !task.videoUrl) return { status: "PROCESSING" };
    if (ctx.claimFinish && !(await ctx.claimFinish())) return { status: "PROCESSING" };
    const fetched = await safeFetchBuffer(task.videoUrl, { timeoutMs: 30_000, maxBytes: 250 * 1024 * 1024 });
    if (!fetched.ok || !fetched.buffer) throw new Error(fetched.error ?? "Could not download Bach video");
    const uploaded = await uploadBuffer({ buffer: fetched.buffer, filename: `${ctx.nodeName}.mp4`, contentType: "video/mp4", folder: `bach-runs/${ctx.runId}` });
    if (uploaded.provider === "inline") throw new Error("Bach video requires configured public asset storage");
    await logAiUsage({ provider: "bach", model: MODEL, capability: "video", videoSeconds: ctx.durationSec, costUsd: COST_PER_SECOND * ctx.durationSec, requestId: taskId, projectId: ctx.projectId });
    return { status: "SUCCESS", url: uploaded.url };
  },
};

export function driveBachRun(runId: string, budgetMs = 270_000) {
  return driveRun(bachAdapter, runId, budgetMs);
}
