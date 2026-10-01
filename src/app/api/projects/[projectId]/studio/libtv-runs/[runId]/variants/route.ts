/**
 * POST — render hook A/B variants of a finished server master (Studio button).
 * Body { styles?: ("c"|"p"|"q")[] } (default: the ones still missing). The first
 * renders now in the background (~2–3 min); the hook-variants cron makes the rest.
 */
import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/db";
import { isServerEngine } from "@/services/video-gen/libtv-pricing";
import { missingStyles, renderVariantForRun, type HookStyle } from "@/services/video-gen/variants";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string; runId: string }> }) {
  const { projectId, runId } = await params;
  const body = (await request.json().catch(() => ({}))) as { styles?: unknown };
  const run = await prisma.libtvRun.findFirst({ where: { id: runId, projectId }, select: { id: true, status: true, executor: true, qcReport: true } });
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  if (!isServerEngine(run.executor) || run.status !== "completed") {
    return NextResponse.json({ error: "Hook variants are made from a finished server-rendered master" }, { status: 409 });
  }
  const wanted = Array.isArray(body.styles)
    ? (body.styles.filter((s) => s === "c" || s === "p" || s === "q") as HookStyle[])
    : missingStyles((run.qcReport ?? {}) as never, Date.now());
  if (!wanted.length) return NextResponse.json({ ok: true, started: [] });
  // One render fits a function's time limit; the hook-variants cron makes the rest.
  const style = wanted[0];
  after(() =>
    renderVariantForRun(run.id, style).then(
      () => undefined,
      (err) => console.warn(`[variants] ${run.id} ${style} failed:`, err instanceof Error ? err.message : err)
    )
  );
  return NextResponse.json({ ok: true, started: [style], queued: wanted.slice(1) }, { status: 202 });
}
