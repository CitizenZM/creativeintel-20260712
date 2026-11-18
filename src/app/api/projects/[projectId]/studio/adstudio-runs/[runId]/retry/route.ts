/** Retry a failed Ad Studio variant: back to approval (if it had a plan) or to the queue. */
import { NextResponse } from "next/server";
import { withAccess } from "@/lib/auth/route-guard";
import { AdStudioError, retryRun } from "@/services/video-gen/adstudio-queue";

export const dynamic = "force-dynamic";

async function unguardedPOST(_request: Request, { params }: { params: Promise<{ projectId: string; runId: string }> }) {
  const { projectId, runId } = await params;
  try {
    return NextResponse.json({ run: await retryRun(projectId, runId) });
  } catch (err) {
    if (err instanceof AdStudioError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

export const POST = withAccess(unguardedPOST);
