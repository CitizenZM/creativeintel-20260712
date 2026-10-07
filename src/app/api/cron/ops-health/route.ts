import { NextResponse } from "next/server";
import { cronHeartbeat } from "@/services/ops/heartbeat";
import { autoRecover } from "@/services/ops/health";

// Re-driving a stuck run ticks it for up to 90 s (at most 3 per pass).
export const maxDuration = 300;

/**
 * Vercel Cron — ops health monitor: scan for stuck runs / jobs, failing engines, broken renders,
 * spend anomalies and silent crons, then take the safe recovery actions (logged as OpsEvent rows).
 * OPS_AUTO_RECOVER=off turns the pass into a dry run (scan + plan only).
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
  await cronHeartbeat("ops-health");
  try {
    const out = await autoRecover({ dryRun: process.env.OPS_AUTO_RECOVER === "off" });
    return NextResponse.json({ ok: out.counts.critical === 0, at: out.at, dryRun: out.dryRun, counts: out.counts, actions: out.actions, issues: out.issues.slice(0, 50) });
  } catch (err) {
    console.warn("[ops-health] scan failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
