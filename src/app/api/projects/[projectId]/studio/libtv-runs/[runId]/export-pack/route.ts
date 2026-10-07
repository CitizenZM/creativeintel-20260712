/**
 * POST { platforms? } — build the run's export pack: every rendered video with a thumbnail, per-platform
 * ad copy, Meta + TikTok bulk CSVs, README and manifest, uploaded; returns the manifest with file URLs.
 * The pack is also kept on qcReport.exportPack.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseOperatorAction } from "@/services/operator";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string; runId: string }> }) {
  const { projectId, runId } = await params;
  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const parsed = parseOperatorAction("export-pack", { ...body, projectId, runId });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const run = await prisma.libtvRun.findFirst({ where: { id: runId, projectId }, select: { id: true } });
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  try {
    const { buildExportPack } = await import("@/services/delivery/export-pack");
    return NextResponse.json({ ok: true, ...(await buildExportPack(run.id, { platforms: parsed.data.platforms })) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 409 });
  }
}
