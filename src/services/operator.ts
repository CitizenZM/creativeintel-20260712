/**
 * Operator actions for /api/worker/operator: the same steps a user takes in
 * the Studio (approve a storyboard's frames, compile a render, approve it),
 * callable with the worker token when no browser is available. They can only
 * start free renders — a run that would spend credits is refused.
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
  }),
  z.object({ action: z.literal("approve-run"), projectId: z.string().min(1), runId: z.string().min(1) }),
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
export function freeRunRefusal(run: { executor: string | null; creditsEstimated: number; status: string }, isServerEngine: boolean): string | null {
  if (!isServerEngine) return `Only free server renders can be approved here (executor ${run.executor ?? "none"}) — approve LibTV runs in the Studio.`;
  if (run.creditsEstimated > 0) return `This run is estimated at ${run.creditsEstimated} credits — approve it in the Studio.`;
  return null;
}
