/**
 * Credit gate. A run only becomes claimable here, and only when the brand kit
 * is studio-ready — packshots and SKU dimensions are what keep the product from
 * drifting, so an unready kit is a 409, not a warning.
 */
import { NextResponse, after } from "next/server";
import { approveRun, getRunWithJobs } from "@/services/video-gen/libtv-queue";
import { driveGlmRun } from "@/services/video-gen/glm-executor";
import { isStrictFree, PaidFeatureDisabledError } from "@/lib/cost-mode";
import { getBrandKitCompleteness } from "@/services/brand-kit";

export const dynamic = "force-dynamic";
// GLM runs render on the server right after approval.
export const maxDuration = 300;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string; runId: string }> }
) {
  const { projectId, runId } = await params;
  const body = (await request.json().catch(() => ({}))) as { creditCap?: number };

  const existing = await getRunWithJobs(runId);
  if (!existing || existing.projectId !== projectId) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  // LibTV spends credits; strict free mode only renders with the free GLM engine.
  if (isStrictFree() && existing.executor !== "glm") {
    return NextResponse.json(
      { error: new PaidFeatureDisabledError("Rendering on LibTV").message + " Compile the run with the GLM models instead." },
      { status: 402 }
    );
  }

  const completeness = await getBrandKitCompleteness(projectId);
  if (!completeness.ready.studio) {
    return NextResponse.json(
      {
        error: "Brand kit is not ready for studio generation",
        missing: completeness.missing,
        score: completeness.score,
      },
      { status: 409 }
    );
  }

  const cap = typeof body.creditCap === "number" && body.creditCap > 0 ? Math.round(body.creditCap) : null;
  if (cap !== null && cap < existing.creditsEstimated) {
    return NextResponse.json(
      {
        error: `Credit cap ${cap} is below the estimate of ${existing.creditsEstimated} credits`,
        creditsEstimated: existing.creditsEstimated,
      },
      { status: 409 }
    );
  }

  const run = await approveRun(runId, cap);
  if (!run) {
    return NextResponse.json(
      { error: `Run cannot be approved from status "${existing.status}"` },
      { status: 409 }
    );
  }

  // Free GLM runs start rendering immediately on the server.
  if (run.executor === "glm") after(() => driveGlmRun(runId, 280_000).then(() => undefined));

  return NextResponse.json({ run });
}
