/** GET — every project share (master admin only): project, coworker email, level, joined yet. */
import { NextResponse } from "next/server";
import { currentAppUser } from "@/services/app-user";
import { listShares } from "@/services/project-shares";
import { withAccess } from "@/lib/auth/route-guard";

export const dynamic = "force-dynamic";

async function unguardedGET(_request: Request) {
  const me = await currentAppUser();
  if (me?.role !== "owner") return NextResponse.json({ error: "Owner only" }, { status: 403 });
  return NextResponse.json({ shares: await listShares() });
}

export const GET = withAccess(unguardedGET);
