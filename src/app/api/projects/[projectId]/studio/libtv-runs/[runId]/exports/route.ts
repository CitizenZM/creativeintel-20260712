/**
 * POST { format: "4:5" | "1:1" | "16:9" | "15s" | "10s" } — render a delivery
 * format of a finished server master in the background (~2–3 min). Results and
 * progress show on the run's QC card.
 */
import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/db";
import { isServerEngine } from "@/services/video-gen/libtv-pricing";
import { isExportFormat, renderExportForRun } from "@/services/video-gen/exports";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string; runId: string }> }) {
  const { projectId, runId } = await params;
  const body = (await request.json().catch(() => ({}))) as { format?: unknown };
  if (!isExportFormat(body.format)) return NextResponse.json({ error: "format must be 4:5, 1:1, 16:9, 15s or 10s" }, { status: 400 });
  const run = await prisma.libtvRun.findFirst({ where: { id: runId, projectId }, select: { id: true, status: true, executor: true } });
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  if (!isServerEngine(run.executor) || run.status !== "completed") {
    return NextResponse.json({ error: "Exports are made from a finished server-rendered master" }, { status: 409 });
  }
  const format = body.format;
  after(() =>
    renderExportForRun(run.id, format).then(
      () => undefined,
      (err) => console.warn(`[exports] ${run.id} ${format} failed:`, err instanceof Error ? err.message : err)
    )
  );
  return NextResponse.json({ ok: true, started: format }, { status: 202 });
}
