/** GET — every project share (master admin only): project, coworker email, level, joined yet. */
import { NextResponse } from "next/server";
import { currentAppUser } from "@/services/app-user";
import { listShares } from "@/services/project-shares";

export const dynamic = "force-dynamic";

export async function GET() {
  const me = await currentAppUser();
  if (me?.role !== "owner") return NextResponse.json({ error: "Owner only" }, { status: 403 });
  return NextResponse.json({ shares: await listShares() });
}
