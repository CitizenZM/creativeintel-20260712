/**
 * GET  — pending invitations (master admin only).
 * POST { email } — email an invitation to join creative.xark.io (Clerk sends it). 409 when the
 *      address already has an account or a pending invitation.
 * The proxy already keeps members out of /api/settings; this route also requires an owner.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { currentAppUser } from "@/services/app-user";
import { clerkErrorMessage, inviteSchema, listPendingInvitations, sendInvitation } from "@/services/invitations";

export const dynamic = "force-dynamic";

async function owner() {
  const me = await currentAppUser();
  return me?.role === "owner" ? me : null;
}

export async function GET() {
  if (!(await owner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  try {
    return NextResponse.json({ invitations: await listPendingInvitations() });
  } catch (err) {
    return NextResponse.json({ error: clerkErrorMessage(err) }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const me = await owner();
  if (!me) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  const parsed = inviteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  const { email } = parsed.data;

  if (await prisma.appUser.findFirst({ where: { email }, select: { id: true } })) {
    return NextResponse.json({ error: `${email} already has an account` }, { status: 409 });
  }
  try {
    const invitation = await sendInvitation(email, me.email);
    console.info(`[auth] ${me.email} invited ${email} (${invitation.id})`);
    return NextResponse.json({ invitation }, { status: 201 });
  } catch (err) {
    const message = clerkErrorMessage(err);
    const duplicate = /already|exists|pending/i.test(message);
    return NextResponse.json({ error: message }, { status: duplicate ? 409 : 502 });
  }
}
