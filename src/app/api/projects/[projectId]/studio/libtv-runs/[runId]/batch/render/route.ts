/**
 * POST { batchId, limit? } — render the next free re-edit variants of a planned batch (same clips, new
 * edit; never generates new hook clips). Claims now, renders after the response (~2–3 min each); the
 * Studio polls the run for qcReport.batches progress.
 */
import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/db";
import { parseOperatorAction } from "@/services/operator";
import { claimBatchVariants, renderClaimedVariants } from "@/services/video-gen/batch-render";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string; runId: string }> }) {
  const { projectId, runId } = await params;
  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const parsed = parseOperatorAction("render-batch", { ...body, projectId, runId });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const run = await prisma.libtvRun.findFirst({ where: { id: runId, projectId }, select: { id: true } });
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  const { batchId, limit } = parsed.data;
  try {
    const claimed = await claimBatchVariants(run.id, batchId, limit);
    if (claimed.length) after(() => renderClaimedVariants(run.id, batchId, claimed).then(() => undefined));
    return NextResponse.json({ ok: true, rendering: claimed.map((v) => ({ id: v.id, name: v.name })) }, { status: claimed.length ? 202 : 200 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 409 });
  }
}
