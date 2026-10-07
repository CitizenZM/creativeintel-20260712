/**
 * OpenRouter engine — production renders on one OpenRouter key:
 *   image (K<n>) → Seedream 5 Flash / Qwen-Image 3 (job settings `openrouterModel`), stored in our assets
 *   video (V<n>) → Veo 3.1 Lite / Wan 3.0 / Kling 3.0 image-to-video, the keyframe as the first frame
 * Credits on these jobs are US cents (estimates; OpenRouter bills the key and reports the real cost).
 * Graph walking, claiming and assembly live in server-executor.ts.
 */
import { uploadBuffer } from "@/services/storage";
import { logAiUsage } from "@/services/ai/usage";
import { endFramePrompt, lockedEditPrompt } from "@/services/ai/matrix";
import {
  downloadOpenRouterVideo,
  generateOpenRouterImage,
  getOpenRouterVideoTask,
  isOpenRouterConfigured,
  submitOpenRouterVideo,
} from "@/services/ai/openrouter-media";
import { negativePromptFor } from "./shot-director";
import { applyCorrections } from "./consistency/corrections";
import { clipDriftMode } from "./keyframe-qc";
import { driveRun, type EngineAdapter, type JobContext, type TaskResult, type TickResult } from "./server-executor";

const DEFAULT_IMAGE = "bytedance-seed/seedream-5-0-flash";
const DEFAULT_VIDEO = "google/veo-3.1-lite";

function modelOf(ctx: JobContext, fallback: string): string {
  const m = ctx.settings?.openrouterModel;
  return typeof m === "string" && m ? m : fallback;
}

/**
 * An OpenRouter keyframe for any engine: plain text-to-image, or — under the
 * cast lock — an edit of the run's CAST reference (people) and/or the packshot.
 */
export async function openrouterKeyframe(prompt: string, ctx: JobContext): Promise<{ url: string }> {
  const editFrom = ctx.settings?.editFrom;
  const refs = ctx.referenceUrls ?? [];
  const model = modelOf(ctx, DEFAULT_IMAGE);
  const fresh = () => generateOpenRouterImage(prompt, { model, aspectRatio: ctx.aspectRatio, projectId: ctx.projectId });
  const shot = typeof ctx.settings?.directedKeyframe === "string" ? ctx.settings.directedKeyframe : prompt;
  // Consistency-gate re-roll: the previous attempt's defects as explicit corrections (edit prompts truncate the shot, so they go last).
  const corrections = Array.isArray(ctx.settings?.qcCorrections) ? (ctx.settings.qcCorrections as string[]) : undefined;
  // End keyframe of an anchored segment: edit the approved START frame (image 1) to the end state, re-locked
  // to the cast sheet and the product photo, so both ends of the clip are corrected to the references.
  if (editFrom === "end" && refs.length >= 1) {
    const out = await generateOpenRouterImage(applyCorrections(endFramePrompt(shot, { cast: !!ctx.settings?.endCast, product: !!ctx.settings?.endProduct }), corrections), {
      model,
      aspectRatio: ctx.aspectRatio,
      referenceUrls: refs.slice(0, 6),
      projectId: ctx.projectId,
    });
    const up = await uploadBuffer({ buffer: out.buffer, filename: `${ctx.nodeName}${out.contentType === "image/png" ? ".png" : ".jpg"}`, contentType: out.contentType, folder: `openrouter-runs/${ctx.runId}` });
    if (up.provider === "inline") throw new Error("No asset storage configured — set BLOB_READ_WRITE_TOKEN or CLOUDINARY_URL");
    return { url: up.url };
  }
  const usable =
    (editFrom === "cast" || editFrom === "product") && refs.length >= 1 ? editFrom : editFrom === "cast+product" && refs.length >= 2 ? editFrom : null;
  const { buffer, contentType } = usable
    ? await generateOpenRouterImage(applyCorrections(lockedEditPrompt(usable, shot, { maxChars: 1400 }), corrections), {
        model,
        aspectRatio: ctx.aspectRatio,
        referenceUrls: usable === "cast+product" ? refs.slice(0, 2) : [refs[0]],
        projectId: ctx.projectId,
      }).catch((err) => {
        // Plan B: an unlocked keyframe beats a failed run.
        console.warn(`[openrouter] cast-lock edit for ${ctx.nodeName} failed, generating it fresh:`, err instanceof Error ? err.message.slice(0, 200) : err);
        return fresh();
      })
    : await fresh();
  const up = await uploadBuffer({
    buffer,
    filename: `${ctx.nodeName}${contentType === "image/png" ? ".png" : ".jpg"}`,
    contentType,
    folder: `openrouter-runs/${ctx.runId}`,
  });
  if (up.provider === "inline") throw new Error("No asset storage configured — set BLOB_READ_WRITE_TOKEN or CLOUDINARY_URL");
  return { url: up.url };
}

export const openrouterAdapter: EngineAdapter = {
  engine: "openrouter",
  workerId: "openrouter-server",
  maxVideosInFlight: 4,
  // A Seedream 5 Flash still takes ~10 s: four per tick stays well inside the budget.
  imagesPerTick: 4,
  isConfigured: isOpenRouterConfigured,
  notConfiguredError: "OPENROUTER_API_KEY is not configured",

  generateImage(prompt, ctx) {
    return openrouterKeyframe(prompt, ctx);
  },

  async submitVideo(input, ctx) {
    const resolution = typeof ctx.settings?.resolution === "string" ? ctx.settings.resolution : undefined;
    const model = modelOf(ctx, DEFAULT_VIDEO);
    return submitOpenRouterVideo({
      model,
      negativePrompt: ctx.settings?.directed ? negativePromptFor(model) : undefined,
      prompt: input.prompt,
      imageUrl: input.imageUrl,
      lastImageUrl: input.lastImageUrl,
      seed: input.seed,
      aspectRatio: ctx.aspectRatio,
      durationSec: ctx.durationSec,
      resolution,
    });
  },

  async pollVideo(taskId, ctx): Promise<TaskResult> {
    const task = await getOpenRouterVideoTask(taskId);
    if (task.status === "FAIL") return { status: "FAIL", error: task.error ?? "OpenRouter video failed" };
    if (task.status !== "SUCCESS") return { status: "PROCESSING" };
    const buffer = await downloadOpenRouterVideo(taskId);
    // Drift check on the clip we already hold: sample 0 / 50 / 100 %, score against cast + product refs (free when "pixel").
    const mode = clipDriftMode();
    const runDrift = async () => (await import("./consistency/drift")).clipDriftForJob(buffer, ctx.consistency, ctx.settings, { mode });
    let drift: Awaited<ReturnType<typeof runDrift>> | null = null;
    if (mode !== "off") {
      try {
        // Vision drift scoring is 3 paid calls: under the project's spend guard (advisory — skipped when over budget).
        drift = mode === "pixel" ? await runDrift() : await (await import("@/services/ops/spend")).guardLlm({ projectId: ctx.projectId, runId: ctx.runId, kind: "vision_qc" }, { inTokens: 3 * 2500, outTokens: 3 * 600 }, runDrift);
      } catch (err) {
        console.warn(`[drift] ${ctx.nodeName}: skipped —`, err instanceof Error ? err.message.slice(0, 200) : err);
      }
    }
    const up = await uploadBuffer({ buffer, filename: `${ctx.nodeName}.mp4`, contentType: "video/mp4", folder: `openrouter-runs/${ctx.runId}` });
    if (up.provider === "inline") throw new Error("No asset storage configured — set BLOB_READ_WRITE_TOKEN or CLOUDINARY_URL");
    const costUsd = task.costUsd ?? (ctx.creditsEstimated ?? 0) / 100;
    logAiUsage({ provider: "openrouter", model: modelOf(ctx, DEFAULT_VIDEO), capability: "video", videoSeconds: ctx.durationSec, costUsd, projectId: ctx.projectId });
    return {
      status: "SUCCESS",
      url: up.url,
      creditsSpent: Math.round(costUsd * 100),
      ...(drift ? { settingsPatch: { drift: drift.report, driftFlag: drift.report.driftFlag }, regenerate: drift.regenerate } : {}),
    };
  },
};

export function driveOpenRouterRun(runId: string, budgetMs = 270_000): Promise<TickResult> {
  return driveRun(openrouterAdapter, runId, budgetMs);
}
