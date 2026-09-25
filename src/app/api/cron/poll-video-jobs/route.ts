import { NextResponse } from "next/server";
import { pollAllActiveJobs } from "@/services/video-gen/poll";
import { advanceActiveGlmRuns } from "@/services/video-gen/glm-executor";

export const maxDuration = 60;

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

  const summary = await pollAllActiveJobs();
  // Also advance free GLM Studio runs (they render on the server, not the Mac).
  const glmRuns = await advanceActiveGlmRuns(40_000).catch(() => 0);
  return NextResponse.json({ ...summary, glmRuns });
}
