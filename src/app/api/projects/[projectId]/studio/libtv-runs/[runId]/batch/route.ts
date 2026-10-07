/**
 * POST { dims?, design?: pairwise|full, maxVariants? } — plan a Batch Mode variant matrix (+ cost) for a
 * finished server master; kept on qcReport.batches (GET the run to read them). Planning spends nothing.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseOperatorAction } from "@/services/operator";
import { planBatchForRun } from "@/services/video-gen/batch-render";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string; runId: string }> }) {
  const { projectId, runId } = await params;
  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const parsed = parseOperatorAction("plan-batch", { ...body, projectId, runId });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const run = await prisma.libtvRun.findFirst({ where: { id: runId, projectId }, select: { id: true } });
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  try {
    const batch = await planBatchForRun({ runId: run.id, dims: parsed.data.dims, design: parsed.data.design, maxVariants: parsed.data.maxVariants });
    return NextResponse.json({ ok: true, batch });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 409 });
  }
}
