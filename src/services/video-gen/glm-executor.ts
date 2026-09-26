/**
 * GLM engine — the free, parallel alternative to the LibTV Mac worker.
 *   image (K<n>) → Zhipu CogView-3-Flash (free)
 *   video (V<n>) → Zhipu CogVideoX-Flash image-to-video off its keyframe (free)
 * A bring-your-own paid Zhipu model (cogvideox-3, viduq1-image, … — set up in
 * Settings → AI engines) renders here too: its job settings carry `zhipuModel`
 * and `providerId`, the clip is submitted on that provider's key, and its cost
 * (creditsEstimated, in US cents) is recorded as spent.
 * The graph walking, claiming and assembly live in server-executor.ts.
 */
import { generateImagePersisted, getVideoTask, isZhipuConfigured, persistResult, submitVideo } from "@/services/ai/zhipu";
import { zhipuAuthFor } from "@/services/settings/ai-settings";
import { advanceActiveRuns, driveRun, tickRun, type EngineAdapter, type TaskResult, type TickResult } from "./server-executor";

/** A paid bring-your-own model on a video job (credits = US cents per clip). */
function paidVideo(settings: Record<string, unknown> = {}): { zhipuModel?: string; providerId?: string } {
  return {
    zhipuModel: typeof settings.zhipuModel === "string" ? settings.zhipuModel : undefined,
    providerId: typeof settings.providerId === "string" ? settings.providerId : undefined,
  };
}

export const glmAdapter: EngineAdapter = {
  engine: "glm",
  workerId: "glm-server",
  maxVideosInFlight: 2, // free-tier concurrency is low
  imagesPerTick: 3,
  isConfigured: isZhipuConfigured,
  notConfiguredError: "ZHIPU_API_KEY is not configured",

  async generateImage(prompt, ctx) {
    const url = await generateImagePersisted(prompt, {
      aspectRatio: ctx.aspectRatio,
      folder: `glm-runs/${ctx.runId}`,
      projectId: ctx.projectId,
    });
    return { url };
  },

  async submitVideo(input, ctx) {
    const paid = paidVideo(ctx.settings);
    return submitVideo({
      prompt: input.prompt,
      imageUrl: input.imageUrl,
      aspectRatio: ctx.aspectRatio,
      model: paid.zhipuModel,
      auth: await zhipuAuthFor(paid.providerId),
    });
  },

  async pollVideo(taskId, ctx): Promise<TaskResult> {
    const paid = paidVideo(ctx.settings);
    const cents = ctx.creditsEstimated ?? 0;
    const costUsd = paid.zhipuModel ? cents / 100 : 0;
    const task = await getVideoTask(taskId, {
      auth: await zhipuAuthFor(paid.providerId),
      usage: {
        provider: paid.providerId ? `custom:${paid.providerId}` : undefined,
        model: paid.zhipuModel,
        seconds: ctx.durationSec,
        costUsd,
        projectId: ctx.projectId,
      },
    });
    if (task.status === "SUCCESS" && task.videoUrl) {
      const url = await persistResult(task.videoUrl, `glm-runs/${ctx.runId}`, `${ctx.nodeName}.mp4`);
      return paid.zhipuModel
        ? { status: "SUCCESS", url, remoteUrl: task.videoUrl, creditsSpent: cents }
        : { status: "SUCCESS", url, remoteUrl: task.videoUrl };
    }
    if (task.status === "FAIL") return { status: "FAIL", error: `${paid.zhipuModel ?? "CogVideoX-Flash"} reported FAIL` };
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
