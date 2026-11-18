/** GET — the Video Brain board's single read (snapshot + age). Admin only (src/lib/auth/gate.ts). */
import { NextResponse } from "next/server";
import { getView } from "@/services/brain/store";
import { withAccess } from "@/lib/auth/route-guard";

export const dynamic = "force-dynamic";

async function unguardedGET() {
  return NextResponse.json(await getView());
}

export const GET = withAccess(unguardedGET);
