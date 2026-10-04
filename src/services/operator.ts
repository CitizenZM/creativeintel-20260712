/**
 * Operator actions for /api/worker/operator: the same steps a user takes in
 * the Studio (approve a storyboard's frames, compile a render, approve it),
 * callable with the worker token when no browser is available. A run that
 * spends money is refused unless the call carries allowPaid and a creditCap
 * covering its estimate (only on the user's explicit go-ahead).
 */
import { z } from "zod";
import { appendFrameHistory } from "@/services/creative-library";

export const operatorActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve-frames"), projectId: z.string().min(1), storyboardId: z.string().min(1) }),
  z.object({
    action: z.literal("compile-run"),
    projectId: z.string().min(1),
    storyboardId: z.string().min(1),
    scriptId: z.string().min(1).nullable().optional(),
    imageModel: z.string().min(1),
    videoModel: z.string().min(1),
    clipDurationSec: z.number().int().positive().max(20).optional(),
    aspectRatio: z.enum(["9:16", "16:9", "1:1", "4:5", "4:3", "3:4"]).optional(),
    budgetMode: z.enum(["economy", "full"]).optional(),
    allowOverBudget: z.boolean().optional(),
    holdVideos: z.boolean().optional(),
  }),
  /** Store a prepared image (composite, reference, end card) and return its URL. */
  z.object({
    action: z.literal("upload-asset"),
    projectId: z.string().min(1),
    filename: z.string().min(1).max(120),
    contentType: z.enum(["image/jpeg", "image/png"]),
    base64: z.string().min(10).max(5_000_000),
  }),
  /**
   * Import an approved script as a locked storyboard; creates the project and its brand kit
   * (packshots, logo) when `project` is given instead of `projectId`.
   */
  z.object({
    action: z.literal("import-script"),
    projectId: z.string().min(1).optional(),
    templateProjectId: z.string().min(1).optional(),
    project: z
      .object({ name: z.string().min(1), brandName: z.string().min(1), productName: z.string().min(1), productUrl: z.string().url().optional() })
      .optional(),
    packshots: z.array(z.object({ url: z.string().url(), variant: z.string().optional() })).max(6).optional(),
    logoUrl: z.string().url().optional(),
    storyboard: z.object({ title: z.string().min(1), frames: z.array(z.record(z.string(), z.unknown())).min(1).max(30) }),
  }),
  /** Release the held clips of a keyframe-review run and start rendering them. */
  z.object({ action: z.literal("release-videos"), projectId: z.string().min(1), runId: z.string().min(1) }),
  z.object({ action: z.literal("reassemble-run"), projectId: z.string().min(1), runId: z.string().min(1) }),
  /** Tick an approved server run now instead of waiting for the 5-minute cron (no new spend beyond what was approved). */
  z.object({ action: z.literal("drive-run"), projectId: z.string().min(1), runId: z.string().min(1) }),
  z.object({ action: z.literal("director-review"), projectId: z.string().min(1), runId: z.string().min(1) }),
  z.object({ action: z.literal("save-structure"), projectId: z.string().min(1), teardownId: z.string().min(1) }),
  z.object({ action: z.literal("choose-structure"), projectId: z.string().min(1), structureId: z.string().min(1).nullable() }),
  z.object({
    action: z.literal("rerender-shots"),
    projectId: z.string().min(1),
    runId: z.string().min(1),
    /** Default: the shots the AI director flagged. */
    shotIndexes: z.array(z.number().int().min(0)).optional(),
  }),
  z.object({
    action: z.literal("render-export"),
    projectId: z.string().min(1),
    runId: z.string().min(1),
    format: z.enum(["4:5", "1:1", "16:9", "15s", "10s"]),
  }),
  z.object({
    action: z.literal("render-variant"),
    projectId: z.string().min(1),
    runId: z.string().min(1),
    hookStyle: z.enum(["q", "c", "p"]),
    hookText: z.string().max(80).optional(),
  }),
  z.object({
    action: z.literal("approve-run"),
    projectId: z.string().min(1),
    runId: z.string().min(1),
    /**
     * Spend on a paid server render (Matrix, paid Zhipu). Only with the user's
     * explicit go-ahead for this run, and never above `creditCap`.
     */
    allowPaid: z.boolean().optional(),
    creditCap: z.number().int().positive().optional(),
  }),
]);

export type OperatorAction = z.infer<typeof operatorActionSchema>;

/** Approve every frame, keeping each changed frame's prior state in the history — as PATCH …/frames does. */
export function approveAllFrames(
  frames: Array<Record<string, unknown>>,
  history: unknown
): { frames: Array<Record<string, unknown>>; history: unknown; approved: number } {
  let approved = 0;
  let next = history;
  const out = frames.map((f) => {
    if (f.approved === true) return f;
    next = appendFrameHistory(next, f.frameNumber as number, f);
    approved++;
    return { ...f, approved: true };
  });
  return { frames: out, history: next, approved };
}

/** Why the operator may not approve this run, or null when it's a free server render. */
export function freeRunRefusal(
  run: { executor: string | null; creditsEstimated: number; status: string },
  isServerEngine: boolean,
  paid: { allowPaid?: boolean; creditCap?: number } = {}
): string | null {
  if (!isServerEngine) return `Only server renders can be approved here (executor ${run.executor ?? "none"}) — approve LibTV runs in the Studio.`;
  if (run.creditsEstimated > 0) {
    if (!paid.allowPaid) return `This run is estimated at ${run.creditsEstimated} credits — approve it in the Studio, or pass allowPaid with a creditCap.`;
    if (!paid.creditCap || paid.creditCap < run.creditsEstimated) {
      return `This run is estimated at ${run.creditsEstimated} credits — a creditCap of at least that is required.`;
    }
  }
  return null;
}
