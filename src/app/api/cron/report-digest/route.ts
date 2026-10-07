import { NextResponse } from "next/server";
import { runDigestCron } from "@/services/reports/delivery";
import { cronHeartbeat } from "@/services/ops/heartbeat";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Vercel Cron (weekly, vercel.json) — builds each configured project's weekly digest and logs it on a
 * ReportDelivery row. DRY-RUN unless the project's reportDelivery is enabled AND REPORT_DELIVERY_SEND=on;
 * Feishu goes to an open_id only and the blocklisted group chats are always refused.
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
  await cronHeartbeat("report-digest");
  try {
    const results = await runDigestCron({ budgetMs: 240_000 });
    const counts: Record<string, number> = {};
    for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1;
    return NextResponse.json({ projects: results.length, counts, results });
  } catch (err) {
    console.warn("[report-digest] failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
