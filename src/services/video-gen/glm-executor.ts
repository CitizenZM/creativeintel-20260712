/**
 * GLM engine — the free, parallel alternative to the LibTV Mac worker.
 *   image (K<n>) → Zhipu CogView-3-Flash (free)
 *   video (V<n>) → Zhipu CogVideoX-Flash image-to-video off its keyframe (free)
 * The graph walking, claiming and assembly live in server-executor.ts.
 */
import { generateImagePersisted, getVideoTask, isZhipuConfigured, persistResult, submitVideo } from "@/services/ai/zhipu";
import { advanceActiveRuns, driveRun, tickRun, type EngineAdapter, type TaskResult, type TickResult } from "./server-executor";

export const glmAdapter: EngineAdapter = {
  engine: "glm",
  workerId: "glm-server",
  maxVideosInFlight: 2, // free-tier concurrency is low
  imagesPerTick: 3,
  isConfigured: isZhipuConfigured,
  notConfiguredError: "ZHIPU_API_KEY is not configured",

  async generateImage(prompt, ctx) {
    const url = await generateImagePersisted(prompt, { aspectRatio: ctx.aspectRatio, folder: `glm-runs/${ctx.runId}` });
    return { url };
  },

  async submitVideo(input, ctx) {
    return submitVideo({ prompt: input.prompt, imageUrl: input.imageUrl, aspectRatio: ctx.aspectRatio });
  },

  async pollVideo(taskId, ctx): Promise<TaskResult> {
    const task = await getVideoTask(taskId);
    if (task.status === "SUCCESS" && task.videoUrl) {
      const url = await persistResult(task.videoUrl, `glm-runs/${ctx.runId}`, `${ctx.nodeName}.mp4`);
      return { status: "SUCCESS", url, remoteUrl: task.videoUrl };
    }
    if (task.status === "FAIL") return { status: "FAIL", error: "CogVideoX-Flash reported FAIL" };
    return { status: "PROCESSING" };
  },
};

export function tickGlmRun(runId: string): Promise<TickResult> {
  return tickRun(glmAdapter, runId);
}

/** Keep ticking a run until it settles or the time budget runs out. */
export function driveGlmRun(runId: string, budgetMs = 270_000): Promise<TickResult> {
  return driveRun(glmAdapter, runId, budgetMs);
}

/** Cron sweep: advance every active GLM run a little. */
export function advanceActiveGlmRuns(budgetMs = 50_000): Promise<number> {
  return advanceActiveRuns(glmAdapter, budgetMs);
}
