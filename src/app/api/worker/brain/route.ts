/**
 * Video Brain worker endpoint (Mac daemon workers/video-brain). Auth: header `x-worker-token` (WORKER_TOKEN).
 *
 * POST body (one of):
 *   { action: "observe" }                                   -> Observation (read-only DB gather)
 *   { action: "view" }                                      -> exactly what GET /api/brain serves the /brain page (read-only)
 *   { action: "publish", snapshot }                         -> { ok, bytes, events, learnings } then re-read (second check)
 *   { action: "approve", runId, why }                       -> brain auto-approval within policy (server re-checks the caps)
 *   { action: "retry", runId, why }                         -> retry a failed run (Ad Studio retryRun, max 3)
 *   { action: "batch", projectId, why, mode? }  mode "free" = stock remix (no spend)                     -> start ONE Ad Studio variant from the newest storyboard (no spend: it stops at the gate)
 *   { action: "budget", out, detail }                       -> model budget state from the brain probe (adstudio-budget.ts); re-read
 *   { action: "learn", learning }                           -> { ok, count }
 *   { action: "events", events }                            -> { ok }
 */
import { NextResponse } from "next/server";
import { hasWorkerToken } from "@/lib/worker-token";
import { prisma } from "@/lib/db";
import { observe } from "@/services/brain/observe";
import { addLearning, appendEvents, getPolicy, getSnapshot, getView, publish } from "@/services/brain/store";
import { canAutoApprove } from "@/services/brain/policy";
import { pacificDayStart } from "@/services/brain/observe";
import { AdStudioError, approveRun, createBatch, reserveUsd, retryRun } from "@/services/video-gen/adstudio-queue";
import { BRAIN_BATCH, BRAIN_BATCH_FREE, pickBatch } from "@/services/brain/batch";
import { BUDGET_KEY, setBudget } from "@/services/video-gen/adstudio-budget";
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
      case "view":
        return NextResponse.json(await getView());
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
      case "batch": {
        if (typeof body.projectId !== "string") return NextResponse.json({ error: "projectId required" }, { status: 400 });
        const project = await prisma.project.findUnique({ where: { id: body.projectId }, select: { productUrl: true, archivedAt: true } });
        if (!project || project.archivedAt) return NextResponse.json({ error: "Project not found" }, { status: 404 });
        const [storyboards, runs] = await Promise.all([
          prisma.storyboard.findMany({ where: { projectId: body.projectId, deletedAt: null }, select: { id: true, frames: true, createdAt: true }, take: 20 }),
          prisma.adStudioRun.findMany({ where: { projectId: body.projectId }, select: { status: true, createdAt: true, error: true }, orderBy: { createdAt: "desc" }, take: 20 }),
        ]);
        const pick = pickBatch({ storyboards, runs, productUrl: project.productUrl });
        if (!pick.ok) return NextResponse.json({ ok: false, reason: pick.reason }, { status: 409 });
        const B = body.mode === "free" ? BRAIN_BATCH_FREE : BRAIN_BATCH;
        const out = await createBatch({ projectId: body.projectId, storyboardId: pick.storyboardId, hookTypes: [...B.hookTypes], engines: [...B.engines], visualMode: B.visualMode, openingId: B.openingId, endCardId: B.endCardId, notes: `Started by the Video Brain: ${String(body.why || "").slice(0, 200)}`, createdById: null });
        const back = await prisma.adStudioRun.findMany({ where: { batchId: out.batchId }, select: { id: true, status: true } });
        await prisma.opsEvent.create({ data: { action: "brain-batch", targetType: "run", targetId: back[0]?.id ?? null, projectId: body.projectId, ok: back.length > 0, detail: { storyboardId: pick.storyboardId, why: String(body.why || "") } as never } });
        return NextResponse.json({ ok: back.length === out.runs.length && back.every((r) => r.status === "queued"), batchId: out.batchId, runs: back });
      }
      case "budget": {
        if (typeof body.out !== "boolean") return NextResponse.json({ error: "out (boolean) required" }, { status: 400 });
        const state = { out: body.out, detail: String(body.detail || "").slice(0, 300), at: new Date().toISOString() };
        await setBudget(state);
        const back = await prisma.appSetting.findUnique({ where: { key: BUDGET_KEY } });
        return NextResponse.json({ ok: (back?.value as { at?: string } | null)?.at === state.at, state });
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
        return NextResponse.json({ error: 'action must be one of "observe" | "view" | "publish" | "approve" | "retry" | "batch" | "budget" | "learn" | "events"' }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof AdStudioError) return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    console.error("[worker/brain]", err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
