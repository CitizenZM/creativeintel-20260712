/**
 * Operator endpoint — the Studio's approve-frames → compile → approve steps
 * for the operator's tooling when no browser session is available.
 *
 * Auth: header `x-worker-token` vs env WORKER_TOKEN (exempt from Access like
 * the other /api/worker routes). A paid server render needs allowPaid and a
 * creditCap covering its estimate; LibTV runs stay a Studio action.
 *
 * POST { action: "approve-frames", projectId, storyboardId }
 * POST { action: "compile-run", projectId, storyboardId, scriptId?, imageModel, videoModel, clipDurationSec?, aspectRatio? }
 * POST { action: "approve-run", projectId, runId, allowPaid?, creditCap? }
 * POST { action: "reassemble-run", projectId, runId } — re-cut a finished server run from its clips
 * POST { action: "render-variant", projectId, runId, hookStyle: q|c|p, hookText? } — A/B hook variant
 * POST { action: "render-export", projectId, runId, format: 4:5|1:1|16:9|15s|10s } — delivery format
 * GET  ?runId=…  — the run's status, job counts and outputs
 */
import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/db";
import { hasWorkerToken } from "@/lib/worker-token";
import { LIVE } from "@/services/creative-library";
import { approveAllFrames, freeRunRefusal, operatorActionSchema } from "@/services/operator";
import { compileRunFromStoryboard, LibtvCompileError } from "@/services/video-gen/libtv-compile";
import { isServerEngine } from "@/services/video-gen/libtv-pricing";
import { approveRun, getRunWithJobs, runDone } from "@/services/video-gen/libtv-queue";
import { assembleGlmMaster } from "@/services/video-gen/glm-assemble";
import { renderVariantForRun } from "@/services/video-gen/variants";
import { renderExportForRun } from "@/services/video-gen/exports";
import { storyboardFrames } from "@/services/video-gen/server-executor";
import { driveServerRun } from "@/services/video-gen/server-engines";
import { loadAiSettings } from "@/services/settings/ai-settings";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function summarize(run: NonNullable<Awaited<ReturnType<typeof getRunWithJobs>>>) {
  const jobs = (run as { jobs?: { status: string }[] }).jobs ?? [];
  const counts: Record<string, number> = {};
  for (const j of jobs) counts[j.status] = (counts[j.status] ?? 0) + 1;
  const r = run as unknown as Record<string, unknown>;
  return {
    id: run.id,
    status: run.status,
    executor: run.executor,
    creditsEstimated: run.creditsEstimated,
    jobs: counts,
    masterUrl: r.masterMp4Url ?? null,
    voiceoverUrl: r.voiceoverUrl ?? null,
    subtitlesUrl: r.subtitlesUrl ?? null,
    previewUrl: r.previewMp4Url ?? null,
    contactSheetUrl: r.contactSheetUrl ?? null,
    qc: r.qcReport ?? null,
    error: r.error ?? null,
  };
}

export async function GET(request: Request) {
  if (!hasWorkerToken(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const runId = new URL(request.url).searchParams.get("runId");
  if (!runId) return NextResponse.json({ error: "runId required" }, { status: 400 });
  const run = await getRunWithJobs(runId);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  return NextResponse.json({ run: summarize(run) });
}

export async function POST(request: Request) {
  if (!hasWorkerToken(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = operatorActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid action", issues: parsed.error.issues }, { status: 400 });
  const input = parsed.data;

  if (input.action === "approve-frames") {
    const board = await prisma.storyboard.findFirst({ where: { id: input.storyboardId, projectId: input.projectId, ...LIVE } });
    if (!board) return NextResponse.json({ error: "Storyboard not found" }, { status: 404 });
    const frames = Array.isArray(board.frames) ? (board.frames as Array<Record<string, unknown>>) : [];
    const next = approveAllFrames(frames, board.frameHistory);
    if (next.approved) {
      await prisma.storyboard.update({
        where: { id: board.id },
        data: { frames: next.frames as never, frameHistory: next.history as never },
      });
    }
    return NextResponse.json({ ok: true, approved: next.approved, frames: frames.length });
  }

  if (input.action === "compile-run") {
    try {
      const result = await compileRunFromStoryboard({
        projectId: input.projectId,
        storyboardId: input.storyboardId,
        scriptId: input.scriptId ?? null,
        imageModel: input.imageModel,
        videoModel: input.videoModel,
        clipDurationSec: input.clipDurationSec,
        aspectRatio: input.aspectRatio,
        budgetMode: input.budgetMode,
        allowOverBudget: input.allowOverBudget === true,
      });
      return NextResponse.json(
        { runId: result.runId, creditsEstimated: result.creditsEstimated, jobCount: result.jobCount },
        { status: 201 }
      );
    } catch (err) {
      if (err instanceof LibtvCompileError) {
        return NextResponse.json({ error: err.message, missing: err.missing }, { status: err.status });
      }
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
  }

  if (input.action === "reassemble-run") {
    // Re-cut a finished server run from its existing clips (no generation, no spend).
    const run = await prisma.libtvRun.findFirst({ where: { id: input.runId, projectId: input.projectId } });
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    if (!isServerEngine(run.executor) || run.status !== "completed") {
      return NextResponse.json({ error: `Only completed server runs can be re-assembled (status ${run.status})` }, { status: 409 });
    }
    const jobs = await prisma.libtvJob.findMany({ where: { runId: run.id } });
    const frames = await storyboardFrames(run.storyboardId);
    const master = await assembleGlmMaster({ runId: run.id, aspectRatio: run.aspectRatio, frames, jobs });
    await runDone({
      runId: run.id,
      masterMp4Url: master.masterUrl,
      voiceoverUrl: master.voiceoverUrl,
      subtitlesUrl: master.subtitlesUrl,
      previewMp4Url: master.previewUrl ?? null,
      contactSheetUrl: master.contactSheetUrl ?? null,
      qcReport: master.qcReport ? { ...master.qcReport, variants: ((run.qcReport as { variants?: unknown[] } | null)?.variants ?? []) } : null,
      creditsSpent: run.creditsSpent,
    });
    return NextResponse.json({ ok: true, run: summarize((await getRunWithJobs(run.id))!), qc: master.qcReport ?? null });
  }

  if (input.action === "render-export") {
    const run = await prisma.libtvRun.findFirst({ where: { id: input.runId, projectId: input.projectId }, select: { id: true } });
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    try {
      return NextResponse.json({ ok: true, export: await renderExportForRun(run.id, input.format) });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 409 });
    }
  }

  if (input.action === "render-variant") {
    // An A/B hook variant from the same clips; kept on the run next to its QC.
    const run = await prisma.libtvRun.findFirst({ where: { id: input.runId, projectId: input.projectId }, select: { id: true } });
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    try {
      const variant = await renderVariantForRun(run.id, input.hookStyle, input.hookText);
      return NextResponse.json({ ok: true, variant });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 409 });
    }
  }

  // approve-run: free server renders only.
  await loadAiSettings();
  const existing = await getRunWithJobs(input.runId);
  if (!existing || existing.projectId !== input.projectId) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  const refusal = freeRunRefusal(existing, isServerEngine(existing.executor), input);
  if (refusal) return NextResponse.json({ error: refusal }, { status: 403 });
  const run = await approveRun(input.runId, existing.creditsEstimated > 0 ? (input.creditCap ?? null) : null);
  if (!run) {
    return NextResponse.json({ error: `Run cannot be approved from status "${existing.status}"` }, { status: 409 });
  }
  after(() => driveServerRun(run.executor, run.id, 280_000).then(() => undefined));
  return NextResponse.json({ ok: true, run: summarize((await getRunWithJobs(run.id)) ?? run) });
}
