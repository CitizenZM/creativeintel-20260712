import { NextResponse } from "next/server";
import { advanceAutoVariants } from "@/services/video-gen/variants";
import { cronHeartbeat } from "@/services/ops/heartbeat";

// One full variant render (edit engine v2) fits comfortably.
export const maxDuration = 300;

/**
 * Vercel Cron — every new server-rendered master gets its contrast and
 * product-blast hook variants for A/B tests, one per invocation
 * (AUTO_HOOK_VARIANTS=off disables).
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (process.env.VERCEL === "1") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await cronHeartbeat("hook-variants");
  try {
    return NextResponse.json({ rendered: await advanceAutoVariants() });
  } catch (err) {
    console.warn("[hook-variants] render failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
