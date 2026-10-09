/**
 * PATCH { access: "view" | "download" | "edit" } — change a coworker's level on one project.
 * DELETE — stop sharing that project with them (it disappears from their list at once).
 * Master admin only; the proxy's cached share levels are dropped so the change applies immediately.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { SHARE_ACCESS, type ShareAccess } from "@/lib/auth/access";
import { currentAppUser } from "@/services/app-user";
import { invalidateShares } from "@/services/access";
import { removeShare, updateShareAccess } from "@/services/project-shares";

export const dynamic = "force-dynamic";

const patchSchema = z.object({ access: z.enum(SHARE_ACCESS as unknown as [string, ...string[]]) });

async function owner() {
  const me = await currentAppUser();
  return me?.role === "owner" ? me : null;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await owner();
  if (!me) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "access must be view, download or edit" }, { status: 400 });
  const { id } = await params;
  try {
    const share = await updateShareAccess(id, parsed.data.access as ShareAccess);
    invalidateShares();
    console.info(`[auth] ${me.email} set share ${id} (${share.email}) to ${share.access}`);
    return NextResponse.json({ share });
  } catch {
    return NextResponse.json({ error: "Share not found" }, { status: 404 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await owner();
  if (!me) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  const { id } = await params;
  try {
    const share = await removeShare(id);
    invalidateShares();
    console.info(`[auth] ${me.email} removed share ${id} (${share.email})`);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Share not found" }, { status: 404 });
  }
}
