/**
 * Video Brain worker endpoint (Mac daemon workers/video-brain). Auth: header `x-worker-token` (WORKER_TOKEN).
 *
 * POST body (one of):
 *   { action: "observe" }                                   -> Observation (read-only DB gather)
 *   { action: "publish", snapshot }                         -> { ok, bytes, events, learnings } then re-read (second check)
 *   { action: "approve", runId, why }                       -> brain auto-approval within policy (server re-checks the caps)
 *   { action: "retry", runId, why }                         -> retry a failed run (Ad Studio retryRun, max 3)
 *   { action: "learn", learning }                           -> { ok, count }
 *   { action: "events", events }                            -> { ok }
 */
import { NextResponse } from "next/server";
import { hasWorkerToken } from "@/lib/worker-token";
import { prisma } from "@/lib/db";
import { observe } from "@/services/brain/observe";
import { addLearning, appendEvents, getPolicy, getSnapshot, publish } from "@/services/brain/store";
import { canAutoApprove } from "@/services/brain/policy";
import { pacificDayStart } from "@/services/brain/observe";
import { AdStudioError, approveRun, reserveUsd, retryRun } from "@/services/video-gen/adstudio-queue";
import type { BrainEvent, BrainLearning, BrainSnapshot } from "@/services/brain/contract";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;

async function logOps(action: string, runId: string, projectId: string, ok: boolean, detail: Record<string, unknown>) {
  await prisma.opsEvent.create({ data: { action, targetType: "run", targetId: runId, projectId, ok, detail: detail as never } });
}

export async function POST(request: Request) {
  if (!hasWorkerToken(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body || typeof body.action !== "string") return NextResponse.json({ error: "action required" }, { status: 400 });
  try {
    switch (body.action) {
      case "observe":
        return NextResponse.json(await observe());
      case "publish": {
        const snap = body.snapshot as BrainSnapshot | undefined;
        if (!snap || snap.v !== 1 || typeof snap.at !== "string") return NextResponse.json({ error: "snapshot v1 required" }, { status: 400 });
        const out = await publish(snap);
        const back = await getSnapshot();
        const verified = back?.at === snap.at && back.loops.length === snap.loops.length;
        return NextResponse.json({ ok: verified, ...out, verified });
      }
      case "approve": {
        if (typeof body.runId !== "string") return NextResponse.json({ error: "runId required" }, { status: 400 });
        const run = await prisma.adStudioRun.findUnique({ where: { id: body.runId }, select: { id: true, projectId: true, status: true, estUsd: true, updatedAt: true, cancelRequested: true } });
        if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
        const policy = await getPolicy();
        const today = await prisma.opsEvent.findMany({ where: { action: "brain-auto-approve", ok: true, createdAt: { gte: pacificDayStart(new Date()) } }, select: { detail: true } });
        const used = today.reduce((s, e) => s + Number((e.detail as { reserveUsd?: number } | null)?.reserveUsd ?? 0), 0);
        const verdict = canAutoApprove(run, policy, used, reserveUsd);
        if (!verdict.ok) return NextResponse.json({ ok: false, reason: verdict.reason }, { status: 409 });
        const approved = await approveRun(run.projectId, run.id);
        await logOps("brain-auto-approve", run.id, run.projectId, true, { reserveUsd: verdict.reserveUsd, estUsd: run.estUsd, why: String(body.why || "") });
        const back = await prisma.adStudioRun.findUnique({ where: { id: run.id }, select: { status: true, spendEntryId: true } });
        return NextResponse.json({ ok: back?.status === "approved" && !!back.spendEntryId, status: approved.status, reserveUsd: verdict.reserveUsd });
      }
      case "retry": {
        if (typeof body.runId !== "string") return NextResponse.json({ error: "runId required" }, { status: 400 });
        const run = await prisma.adStudioRun.findUnique({ where: { id: body.runId }, select: { projectId: true } });
        if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
        const r = await retryRun(run.projectId, body.runId);
        await logOps("brain-retry", body.runId, run.projectId, true, { why: String(body.why || ""), status: r.status });
        return NextResponse.json({ ok: true, status: r.status });
      }
      case "learn": {
        const l = body.learning as BrainLearning | undefined;
        if (!l || typeof l.id !== "string" || typeof l.rule !== "string") return NextResponse.json({ error: "learning {id, rule} required" }, { status: 400 });
        const all = await addLearning(l);
        return NextResponse.json({ ok: all.some((x) => x.id === l.id), count: all.length });
      }
      case "events": {
        const ev = Array.isArray(body.events) ? (body.events as BrainEvent[]).filter((e) => e && typeof e.at === "string" && typeof e.summary === "string") : [];
        await appendEvents(ev);
        return NextResponse.json({ ok: true, count: ev.length });
      }
      default:
        return NextResponse.json({ error: 'action must be one of "observe" | "publish" | "approve" | "retry" | "learn" | "events"' }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof AdStudioError) return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    console.error("[worker/brain]", err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
