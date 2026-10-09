/** DELETE — revoke a pending invitation (master admin only); its link stops working. */
import { NextResponse } from "next/server";
import { currentAppUser } from "@/services/app-user";
import { clerkErrorMessage, revokeInvitation } from "@/services/invitations";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentAppUser();
  if (me?.role !== "owner") return NextResponse.json({ error: "Owner only" }, { status: 403 });
  const { id } = await params;
  if (!/^inv_[A-Za-z0-9]+$/.test(id)) return NextResponse.json({ error: "Invalid invitation id" }, { status: 400 });
  try {
    const invitation = await revokeInvitation(id);
    console.info(`[auth] ${me.email} revoked invitation ${id} (${invitation.email})`);
    return NextResponse.json({ invitation });
  } catch (err) {
    return NextResponse.json({ error: clerkErrorMessage(err) }, { status: 502 });
  }
}
