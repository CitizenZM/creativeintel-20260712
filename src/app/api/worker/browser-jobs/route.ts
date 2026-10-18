import { safePublicError } from "@/lib/public-error";
/**
 * Worker-facing endpoint for BrowserGenJob. The local Mac worker (driving
 * Google AI Studio / Flow / Kling web UIs via browser-harness) calls this
 * over HTTPS against the deployed app instead of connecting to the DB
 * directly — keeps DB credentials off the operator's laptop.
 *
 * Secured by header `x-worker-token`, matched against env
 * BROWSER_WORKER_TOKEN (constant-time compare). 401 on mismatch/missing.
 *
 * POST body:
 *   { action: "claim", workerId, sites? }
 *   { action: "complete", id, resultUrl }
 *   { action: "fail", id, error }
 *   { action: "heartbeat", id }
 */
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { claimNextJob, completeJob, failJob, requeueStale } from "@/services/video-gen/browser-queue";

export const maxDuration = 30;

function isAuthorized(request: Request): boolean {
  const expected = process.env.BROWSER_WORKER_TOKEN;
  if (!expected) return false;

  const provided = request.headers.get("x-worker-token");
  if (!provided) return false;

  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length) return false;

  return timingSafeEqual(expectedBuf, providedBuf);
}

type Body =
  | { action: "claim"; workerId: string; sites?: string[] }
  | { action: "complete"; id: string; resultUrl: string }
  | { action: "fail"; id: string; error: string }
  | { action: "heartbeat"; id: string };

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as Partial<Body>;

    switch (body.action) {
      case "claim": {
        if (!body.workerId) {
          return NextResponse.json({ error: "workerId required" }, { status: 400 });
        }
        await requeueStale();
        const job = await claimNextJob(body.workerId, body.sites);
        return NextResponse.json({ job });
      }

      case "complete": {
        if (!body.id || !body.resultUrl) {
          return NextResponse.json({ error: "id and resultUrl required" }, { status: 400 });
        }
        const job = await completeJob(body.id, body.resultUrl);
        return NextResponse.json({ job });
      }

      case "fail": {
        if (!body.id || !body.error) {
          return NextResponse.json({ error: "id and error required" }, { status: 400 });
        }
        const job = await failJob(body.id, body.error);
        return NextResponse.json({ job });
      }

      case "heartbeat": {
        if (!body.id) {
          return NextResponse.json({ error: "id required" }, { status: 400 });
        }
        // Bumps updatedAt (via Prisma @updatedAt) so requeueStale's staleness
        // clock resets; also refreshes claimedAt to reflect the live worker.
        const job = await prisma.browserGenJob.update({
          where: { id: body.id },
          data: { claimedAt: new Date() },
        });
        return NextResponse.json({ job });
      }

      default:
        return NextResponse.json(
          { error: 'action must be one of "claim" | "complete" | "fail" | "heartbeat"' },
          { status: 400 }
        );
    }
  } catch (err) {
    console.error("worker/browser-jobs failed:", err);
    return NextResponse.json(
      { error: safePublicError(err) },
      { status: 500 }
    );
  }
}
