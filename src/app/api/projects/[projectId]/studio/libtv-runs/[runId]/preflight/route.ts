/**
 * POST { platform?, goal? } — pre-flight creative score of the run's master (ffmpeg + sharp measures
 * plus the render plan, scored 0–100 for the platform with fixes). No spend; kept on qcReport.preflight.
 */
import { NextResponse } from "next/server";
import { parseOperatorAction } from "@/services/operator";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string; runId: string }> }) {
  const { projectId, runId } = await params;
  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const parsed = parseOperatorAction("preflight", { ...body, projectId, runId });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { preflightRun, PreflightError } = await import("@/services/video-gen/preflight/run");
  try {
    return NextResponse.json({ ok: true, preflight: await preflightRun(projectId, runId, { platform: parsed.data.platform, goal: parsed.data.goal }) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: err instanceof PreflightError ? err.status : 500 });
  }
}
