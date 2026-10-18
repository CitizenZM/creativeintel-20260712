import { NextResponse } from "next/server";
import { withAccess } from "@/lib/auth/route-guard";
import { aiTraceReport } from "@/services/ai/trace-report";

export const dynamic = "force-dynamic";

async function unguardedGET(_request: Request, { params }: { params: Promise<{ projectId: string; traceId: string }> }) {
  const { projectId, traceId } = await params;
  if (traceId.length > 120) return NextResponse.json({ error: "Invalid trace id" }, { status: 400 });
  return NextResponse.json(await aiTraceReport(projectId, traceId));
}

export const GET = withAccess(unguardedGET);
