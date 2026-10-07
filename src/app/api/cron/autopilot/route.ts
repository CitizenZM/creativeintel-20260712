import { NextResponse } from "next/server";
import { advanceAllAutopilots } from "@/services/autopilot/operator-actions";

// One tick per running autopilot while the budget lasts (a render step drives its run inside it).
export const maxDuration = 300;

/**
 * Vercel Cron — advance every running URL-to-Video autopilot (scrape → … → report) between
 * operator calls. Autopilots waiting for the owner's budget are skipped until autopilot-approve.
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
  if (process.env.AUTOPILOT === "off") return NextResponse.json({ ticked: 0, disabled: true });
  try {
    return NextResponse.json(await advanceAllAutopilots(270_000));
  } catch (err) {
    console.warn("[autopilot] sweep failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
