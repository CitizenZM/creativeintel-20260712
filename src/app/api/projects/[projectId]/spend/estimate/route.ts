/**
 * POST { runId } | { storyboardId, imageModel?, videoModel?, clipDurationSec? } — line-item cost forecast
 * (low / expected / high, QC rerolls included) before spend is approved. Pure estimate: no paid call.
 */
import { NextResponse } from "next/server";
import { parseOperatorAction } from "@/services/operator";
import { estimateRunAction } from "@/services/ops/operator-ops";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const parsed = parseOperatorAction("estimate-run", { ...body, projectId });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const r = await estimateRunAction(parsed.data);
  return NextResponse.json(r.body, { status: r.status });
}
