/** Approve the video spend of one Ad Studio variant (books the estimate against budget and monthly allowance). */
import { NextResponse } from "next/server";
import { withAccess } from "@/lib/auth/route-guard";
import { BudgetExceededError } from "@/services/ops/budget-guard";
import { AdStudioError, approveRun } from "@/services/video-gen/adstudio-queue";

export const dynamic = "force-dynamic";

async function unguardedPOST(_request: Request, { params }: { params: Promise<{ projectId: string; runId: string }> }) {
  const { projectId, runId } = await params;
  try {
    return NextResponse.json({ run: await approveRun(projectId, runId) });
  } catch (err) {
    if (err instanceof AdStudioError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof BudgetExceededError) return NextResponse.json({ error: err.message, code: err.code }, { status: 402 });
    throw err;
  }
}

export const POST = withAccess(unguardedPOST);
