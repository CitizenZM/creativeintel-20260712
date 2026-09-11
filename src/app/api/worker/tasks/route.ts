/**
 * Worker-facing endpoint for WorkerTask — the local research worker on the
 * operator's Mac drives the public ad libraries (Meta / TikTok / Google ATC)
 * through ego-browser and reports AdCandidates back over HTTPS, so DB
 * credentials never leave the server.
 *
 * Secured by header `x-worker-token` against env WORKER_TOKEN (constant-time
 * compare). 401 on mismatch/missing.
 *
 * POST body:
 *   { action: "claim", workerId, kinds? }
 *   { action: "complete", id, result: { candidates: AdCandidate[] } }
 *   { action: "fail", id, error }
 *   { action: "heartbeat", id }
 */
import { NextResponse } from "next/server";
import { timingSafeEqual, createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import {
  claimNextTask,
  completeTask,
  failTask,
  heartbeatTask,
  requeueStaleTasks,
} from "@/services/worker-tasks";
import { parseAdCandidates, type AdCandidate } from "@/services/research/ad-candidate";
import { rankAndSaveCandidates } from "@/services/research/persist";
import { TOP_N_PER_COMPETITOR } from "@/services/research/ranking";

export const maxDuration = 60;

function isAuthorized(request: Request): boolean {
  const expected = process.env.WORKER_TOKEN;
  if (!expected) return false;

  const provided = request.headers.get("x-worker-token");
  if (!provided) return false;

  // Hash both sides so timingSafeEqual never sees mismatched lengths.
  const a = createHash("sha256").update(expected).digest();
  const b = createHash("sha256").update(provided).digest();
  return timingSafeEqual(a, b);
}

type Body =
  | { action: "claim"; workerId: string; kinds?: string[] }
  | { action: "complete"; id: string; result?: { candidates?: unknown } }
  | { action: "fail"; id: string; error: string }
  | { action: "heartbeat"; id: string };

/** Rank + upsert the worker's candidates into the task's project. */
async function persistWorkerCandidates(
  projectId: string,
  competitorId: string | null,
  candidates: AdCandidate[]
) {
  if (candidates.length === 0) return { saved: 0, failed: 0 };
  const competitors = await prisma.competitor.findMany({
    where: { projectId },
    select: { id: true },
  });
  const knownOwnerIds = new Set(competitors.map((c) => c.id));
  const owned = candidates.map((c) => ({
    ...c,
    competitorId:
      competitorId && knownOwnerIds.has(competitorId) ? competitorId : c.competitorId ?? null,
  }));
  const { saved, failed } = await rankAndSaveCandidates({
    projectId,
    candidates: owned,
    knownOwnerIds,
    topN: TOP_N_PER_COMPETITOR,
  });
  return { saved, failed };
}

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
        await requeueStaleTasks();
        const task = await claimNextTask(body.workerId, body.kinds);
        return NextResponse.json({ task });
      }

      case "complete": {
        if (!body.id) {
          return NextResponse.json({ error: "id required" }, { status: 400 });
        }
        const task = await prisma.workerTask.findUnique({ where: { id: body.id } });
        if (!task) {
          return NextResponse.json({ error: "Task not found" }, { status: 404 });
        }

        // Worker output crosses a trust boundary — validate before it reaches Prisma.
        const candidates = parseAdCandidates(body.result?.candidates);
        const payload = (task.payload ?? {}) as { competitorId?: string | null };

        let persisted = { saved: 0, failed: 0 };
        if (task.projectId) {
          persisted = await persistWorkerCandidates(
            task.projectId,
            payload.competitorId ?? null,
            candidates
          );
        }

        const updated = await completeTask(body.id, {
          candidates,
          saved: persisted.saved,
          failed: persisted.failed,
        });
        return NextResponse.json({
          task: updated,
          accepted: candidates.length,
          saved: persisted.saved,
        });
      }

      case "fail": {
        if (!body.id || !body.error) {
          return NextResponse.json({ error: "id and error required" }, { status: 400 });
        }
        const task = await failTask(body.id, body.error);
        return NextResponse.json({ task });
      }

      case "heartbeat": {
        if (!body.id) {
          return NextResponse.json({ error: "id required" }, { status: 400 });
        }
        const task = await heartbeatTask(body.id);
        return NextResponse.json({ task });
      }

      default:
        return NextResponse.json(
          { error: 'action must be one of "claim" | "complete" | "fail" | "heartbeat"' },
          { status: 400 }
        );
    }
  } catch (err) {
    console.error("worker/tasks failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error handling worker request" },
      { status: 500 }
    );
  }
}
