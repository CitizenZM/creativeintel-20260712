/**
 * Matrix engine — production renders on the Matrix gateway (paid):
 *   image (K<n>) → Qwen-Image or Seedream (job settings `matrixModel`), stored in our assets
 *   video (V<n>) → Seedance 2.x image-to-video, the keyframe as the first frame
 * Credits on these jobs are US cents (estimates; Matrix bills the account).
 * Graph walking, claiming and assembly live in server-executor.ts.
 */
import { uploadBuffer } from "@/services/storage";
import { logAiUsage } from "@/services/ai/usage";
import { editMatrixImage, generateMatrixImage, getSeedanceTask, isMatrixConfigured, lockedEditPrompt, submitSeedance } from "@/services/ai/matrix";
import { persistResult } from "@/services/ai/zhipu";
import { driveRun, type EngineAdapter, type JobContext, type TaskResult, type TickResult } from "./server-executor";

const DEFAULT_IMAGE = "qwen/qwen-image";
const DEFAULT_VIDEO = "doubao/seedance-2.0-fast-720p";

function matrixModel(ctx: JobContext, fallback: string): string {
  const m = ctx.settings?.matrixModel;
  return typeof m === "string" && m ? m : fallback;
}

/**
 * A Matrix keyframe for any engine: plain text-to-image, or — under the cast
 * lock — an edit of the run's CAST reference (people) or the packshot (product).
 */
export async function matrixKeyframe(prompt: string, ctx: JobContext): Promise<{ url: string }> {
  const editFrom = ctx.settings?.editFrom;
  const refs = ctx.referenceUrls ?? [];
  const fresh = () => generateMatrixImage(prompt, { model: matrixModel(ctx, DEFAULT_IMAGE), aspectRatio: ctx.aspectRatio, projectId: ctx.projectId });
  const usable =
    (editFrom === "cast" || editFrom === "product") && refs.length >= 1 ? editFrom : editFrom === "cast+product" && refs.length >= 2 ? editFrom : null;
  const { buffer, contentType } =
    usable
      ? await editMatrixImage(lockedEditPrompt(usable, prompt), usable === "cast+product" ? refs.slice(0, 2) : refs[0], { projectId: ctx.projectId }).catch((err) => {
          // Plan B: an unlocked keyframe beats a failed run.
          console.warn(`[matrix] cast-lock edit for ${ctx.nodeName} failed, generating it fresh:`, err instanceof Error ? err.message.slice(0, 200) : err);
          return fresh();
        })
      : await fresh();
  const up = await uploadBuffer({
    buffer,
    filename: `${ctx.nodeName}${contentType === "image/png" ? ".png" : ".jpg"}`,
    contentType,
    folder: `matrix-runs/${ctx.runId}`,
  });
  if (up.provider === "inline") throw new Error("No asset storage configured — set BLOB_READ_WRITE_TOKEN or CLOUDINARY_URL");
  return { url: up.url };
}

export const matrixAdapter: EngineAdapter = {
  engine: "matrix",
  workerId: "matrix-server",
  maxVideosInFlight: 4,
  // Qwen-Image takes ~55 s a still: three per tick keeps a tick under the budget.
  imagesPerTick: 3,
  isConfigured: isMatrixConfigured,
  notConfiguredError: "MATRIX_API_KEY is not configured",

  generateImage(prompt, ctx) {
    return matrixKeyframe(prompt, ctx);
  },

  async submitVideo(input, ctx) {
    return submitSeedance({
      model: matrixModel(ctx, DEFAULT_VIDEO),
      prompt: input.prompt,
      imageUrl: input.imageUrl,
      aspectRatio: ctx.aspectRatio,
      durationSec: ctx.durationSec,
    });
  },

  async pollVideo(taskId, ctx): Promise<TaskResult> {
    const task = await getSeedanceTask(taskId);
    if (task.status === "SUCCESS" && task.videoUrl) {
      const url = await persistResult(task.videoUrl, `matrix-runs/${ctx.runId}`, `${ctx.nodeName}.mp4`);
      const cents = ctx.creditsEstimated ?? 0;
      logAiUsage({
        provider: "matrix",
        model: matrixModel(ctx, DEFAULT_VIDEO),
        capability: "video",
        videoSeconds: ctx.durationSec,
        costUsd: cents / 100,
        projectId: ctx.projectId,
      });
      return { status: "SUCCESS", url, remoteUrl: task.videoUrl, creditsSpent: cents };
    }
    if (task.status === "FAIL") return { status: "FAIL", error: task.error ?? "Seedance failed" };
    return { status: "PROCESSING" };
  },
};

export function driveMatrixRun(runId: string, budgetMs = 270_000): Promise<TickResult> {
  return driveRun(matrixAdapter, runId, budgetMs);
}
