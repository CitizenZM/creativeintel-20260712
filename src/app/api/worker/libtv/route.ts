/**
 * Worker-facing endpoint for LibtvRun. The local Mac worker drives the `libtv`
 * CLI (which needs the operator's browser login) and reports over HTTPS, so no
 * database credentials ever reach the laptop.
 *
 * Auth: header `x-worker-token` vs env WORKER_TOKEN, constant-time.
 *
 * POST body (one of):
 *   { action: "claim",       workerId }
 *   { action: "bind_canvas", runId, workerId, canvasUuid, canvasName? }
 *   { action: "job_started", jobId }
 *   { action: "job_done",    jobId, nodeId?, resultUrl?, remoteUrl?, localPath?, creditsSpent?, skipped? }
 *   { action: "job_failed",  jobId, error }
 *   { action: "run_done",    runId, masterMp4Url?, previewMp4Url?, contactSheetUrl?, creditsSpent? }
 *   { action: "run_failed",  runId, error, needsLogin? }
 *   { action: "heartbeat",   runId, workerId }
 */
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import {
  bindCanvas,
  claimNextRun,
  heartbeat,
  jobDone,
  jobFailed,
  jobStarted,
  requeueStale,
  runAssembling,
  runDone,
  runFailed,
} from "@/services/video-gen/libtv-queue";

export const maxDuration = 30;

function isAuthorized(request: Request): boolean {
  const expected = process.env.WORKER_TOKEN;
  if (!expected) return false;

  const provided = request.headers.get("x-worker-token");
  if (!provided) return false;

  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length) return false;

  return timingSafeEqual(expectedBuf, providedBuf);
}

interface Body {
  action?: string;
  workerId?: string;
  runId?: string;
  jobId?: string;
  nodeId?: string;
  canvasUuid?: string;
  canvasName?: string;
  resultUrl?: string;
  remoteUrl?: string;
  localPath?: string;
  creditsSpent?: number;
  skipped?: boolean;
  masterMp4Url?: string;
  previewMp4Url?: string;
  contactSheetUrl?: string;
  needsLogin?: boolean;
  error?: string;
}

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as Body;

    switch (body.action) {
      case "claim": {
        if (!body.workerId) return bad("workerId required");
        await requeueStale();
        const payload = await claimNextRun(body.workerId);
        return NextResponse.json({ run: payload });
      }

      case "bind_canvas": {
        if (!body.runId || !body.canvasUuid) return bad("runId and canvasUuid required");
        const run = await bindCanvas(body.runId, body.canvasUuid, body.canvasName);
        return NextResponse.json({ run: { id: run.id, canvasUuid: run.canvasUuid, canvasUrl: run.canvasUrl } });
      }

      case "job_started": {
        if (!body.jobId) return bad("jobId required");
        const job = await jobStarted(body.jobId);
        return NextResponse.json({ job: { id: job.id, status: job.status, attempts: job.attempts } });
      }

      case "job_done": {
        if (!body.jobId) return bad("jobId required");
        const job = await jobDone({
          jobId: body.jobId,
          nodeId: body.nodeId,
          resultUrl: body.resultUrl,
          remoteUrl: body.remoteUrl,
          localPath: body.localPath,
          creditsSpent: body.creditsSpent,
          skipped: body.skipped,
        });
        return NextResponse.json({ job: { id: job.id, status: job.status } });
      }

      case "job_failed": {
        if (!body.jobId || !body.error) return bad("jobId and error required");
        const job = await jobFailed(body.jobId, body.error);
        if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
        return NextResponse.json({ job: { id: job.id, status: job.status, attempts: job.attempts } });
      }

      case "run_assembling": {
        if (!body.runId) return bad("runId required");
        const run = await runAssembling(body.runId);
        return NextResponse.json({ run: { id: run.id, status: run.status } });
      }

      case "run_done": {
        if (!body.runId) return bad("runId required");
        const run = await runDone({
          runId: body.runId,
          masterMp4Url: body.masterMp4Url,
          previewMp4Url: body.previewMp4Url,
          contactSheetUrl: body.contactSheetUrl,
          creditsSpent: body.creditsSpent,
        });
        return NextResponse.json({ run: { id: run.id, status: run.status, creditsSpent: run.creditsSpent } });
      }

      case "run_failed": {
        if (!body.runId || !body.error) return bad("runId and error required");
        const run = await runFailed(body.runId, body.error, { needsLogin: body.needsLogin });
        return NextResponse.json({ run: { id: run.id, status: run.status, error: run.error } });
      }

      case "heartbeat": {
        if (!body.runId || !body.workerId) return bad("runId and workerId required");
        const ok = await heartbeat(body.runId, body.workerId);
        return NextResponse.json({ ok }, { status: ok ? 200 : 409 });
      }

      default:
        return bad(
          'action must be one of "claim" | "bind_canvas" | "job_started" | "job_done" | "job_failed" | "run_assembling" | "run_done" | "run_failed" | "heartbeat"'
        );
    }
  } catch (err) {
    console.error("worker/libtv failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error handling worker request" },
      { status: 500 }
    );
  }
}
