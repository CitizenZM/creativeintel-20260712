import { recoverResearchQueue } from "@/services/research/dispatch";
import { NextResponse } from "next/server";
import { recoverRenderQueue } from "@/services/video-gen/render-dispatch";
import { recoverCreativeBatchQueue } from "@/services/creative/batch-dispatch";
import { cronHeartbeat } from "@/services/ops/heartbeat";

// Long enough to assemble a finished server-rendered run (see ASSEMBLY_RESERVE_MS).
export const maxDuration = 300;

/**
 * Vercel Cron target — sweeps queued/processing/generating FalVideoJob rows
 * so video jobs keep progressing even if the client tab that started them
 * is closed (client polling alone previously left rows stuck forever).
 * Scheduled every 5 minutes via vercel.json.
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (process.env.VERCEL === "1") {
    // No secret configured in a real Vercel deployment — refuse rather than
    // allow an unauthenticated public endpoint to trigger job polling.
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await cronHeartbeat("poll-video-jobs");
  const [render, research, creativeBatches] = await Promise.all([recoverRenderQueue(), recoverResearchQueue(), recoverCreativeBatchQueue()]);
  return NextResponse.json({ ...render, research, creativeBatches });
}
