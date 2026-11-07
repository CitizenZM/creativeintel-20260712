/**
 * Worker-facing endpoint for AdStudioRun (Mac adstudio-worker). Same auth as /api/worker/libtv:
 * header `x-worker-token` vs env WORKER_TOKEN, constant-time. No database credentials reach the Mac.
 *
 * POST body (one of):
 *   { action: "claim",    workerId }                                   -> { run: {runId, phase, hookType, engine, planFromRunId, input} | null }
 *   { action: "progress", workerId, runId, step?, progress?, log?, plan?, storyboardAB? }   -> { cancel }
 *   { action: "gate",     workerId, runId, estimate, plan?, storyboardAB?, preUsd?, log? } -> { cancel }
 *   { action: "done",     workerId, runId, finalMp4Url, posterUrl?, review?, metrics?, autofix?, plan?, actualUsd?, log? }
 *   { action: "failed",   workerId, runId, error, cancelled?, actualUsd?, log? }
 */
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { recordWorkerSeen } from "@/services/worker-tasks";
import { ADSTUDIO_WORKER_PREFIX } from "@/services/video-gen/adstudio-worker-status";
import { AdStudioError, claimNext, reportDone, reportFailed, reportGate, reportProgress } from "@/services/video-gen/adstudio-queue";

export const maxDuration = 30;

function isAuthorized(request: Request): boolean {
  const expected = process.env.WORKER_TOKEN;
  const provided = request.headers.get("x-worker-token");
  if (!expected || !provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;

export async function POST(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body || typeof body.action !== "string") return NextResponse.json({ error: "action required" }, { status: 400 });
  const workerId = String(body.workerId || "mac");
  await recordWorkerSeen(ADSTUDIO_WORKER_PREFIX + workerId);
  if (body.action !== "claim" && typeof body.runId !== "string") return NextResponse.json({ error: "runId required" }, { status: 400 });
  try {
    switch (body.action) {
      case "claim":
        return NextResponse.json({ run: await claimNext(workerId) });
      case "progress":
        return NextResponse.json(await reportProgress(body.runId, body));
      case "gate":
        if (typeof body.estimate?.usd !== "number") return NextResponse.json({ error: "estimate.usd required" }, { status: 400 });
        return NextResponse.json(await reportGate(body.runId, body as never));
      case "done":
        if (typeof body.finalMp4Url !== "string") return NextResponse.json({ error: "finalMp4Url required" }, { status: 400 });
        return NextResponse.json(await reportDone(body.runId, body as never));
      case "failed":
        return NextResponse.json(await reportFailed(body.runId, String(body.error || "failed"), body));
      default:
        return NextResponse.json({ error: 'action must be one of "claim" | "progress" | "gate" | "done" | "failed"' }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof AdStudioError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
