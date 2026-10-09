/**
 * GET  — pending invitations (master admin only).
 * POST { email, projectIds?: string[], access?: "view" | "download" | "edit" } — invite a coworker
 *      and share the chosen projects with them at that level (default view). A new address gets a
 *      Clerk invitation email; an address that already has an account just gets the shares. Without
 *      projectIds the account starts with nothing but its own empty workspace.
 * The proxy already keeps members out of /api/settings; this route also requires an owner.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { SHARE_ACCESS } from "@/lib/auth/access";
import { currentAppUser } from "@/services/app-user";
import { invalidateShares } from "@/services/access";
import { clerkErrorMessage, listPendingInvitations, sendInvitation } from "@/services/invitations";
import { shareProjects } from "@/services/project-shares";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  projectIds: z.array(z.string().min(1).max(64)).max(200).default([]),
  access: z.enum(SHARE_ACCESS as unknown as [string, ...string[]]).default("view"),
});

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
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  const { email, projectIds } = parsed.data;
  const access = parsed.data.access as (typeof SHARE_ACCESS)[number];

  const existing = await prisma.appUser.findFirst({ where: { email }, select: { id: true } });
  if (existing && !projectIds.length) {
    return NextResponse.json({ error: `${email} already has an account — pick projects to share with them` }, { status: 409 });
  }

  // Shares first: they wait for the email to sign up, or apply at once to an existing account.
  const { shared } = await shareProjects({ projectIds, email, access, createdById: me.id });
  invalidateShares();

  if (existing) {
    console.info(`[auth] ${me.email} shared ${shared} project(s) with ${email} (${access})`);
    return NextResponse.json({ invitation: null, email, shared, access, existingAccount: true }, { status: 201 });
  }
  try {
    const invitation = await sendInvitation(email, me.email);
    console.info(`[auth] ${me.email} invited ${email} (${invitation.id}) with ${shared} project(s) at ${access}`);
    return NextResponse.json({ invitation, email, shared, access, existingAccount: false }, { status: 201 });
  } catch (err) {
    const message = clerkErrorMessage(err);
    const duplicate = /already|exists|pending/i.test(message);
    // A pending invitation already exists: the shares above still apply when they sign up.
    if (duplicate && shared) {
      return NextResponse.json({ invitation: null, email, shared, access, existingAccount: false, note: message }, { status: 201 });
    }
    return NextResponse.json({ error: message }, { status: duplicate ? 409 : 502 });
  }
}
