import { NextResponse } from "next/server";
import { pollAllActiveJobs } from "@/services/video-gen/poll";
import { advanceActiveServerRuns } from "@/services/video-gen/server-engines";

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
  // Also advance server-rendered Studio runs — GLM and ComfyUI render from
  // here, not on the Mac worker.
  const server = await advanceActiveServerRuns(40_000).catch(() => ({ glm: 0, comfyui: 0, animatic: 0 }));
  return NextResponse.json({ ...summary, glmRuns: server.glm, comfyuiRuns: server.comfyui });
}
