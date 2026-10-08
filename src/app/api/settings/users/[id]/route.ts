/**
 * POST — the master admin blocks, unblocks, promotes or demotes another account (/settings/users).
 * Body: { action: "block" | "unblock" | "make-owner" | "make-member" }.
 *
 * The proxy already keeps members out of /api/settings; this route additionally requires the
 * caller's AppUser to be an owner (verified OWNER_EMAILS, or promoted by an owner).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { planUserAction, USER_ACTIONS } from "@/lib/auth/user-actions";
import { currentAppUser } from "@/services/app-user";
import { invalidatePrincipal } from "@/services/access";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ action: z.enum(USER_ACTIONS) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentAppUser();
  if (!me || me.role !== "owner") return NextResponse.json({ error: "Owner only" }, { status: 403 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid action", issues: parsed.error.issues }, { status: 400 });
  }

  const { id } = await params;
  const target = await prisma.appUser.findUnique({ where: { id } });
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const plan = planUserAction({
    actor: me,
    target,
    action: parsed.data.action,
    ownerEmails: process.env.OWNER_EMAILS,
  });
  if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: plan.status });

  const user = await prisma.appUser.update({ where: { id }, data: plan.data });
  invalidatePrincipal(target.clerkUserId);
  console.info(`[auth] ${me.email} → ${parsed.data.action} ${target.email} (now ${user.status}/${user.role})`);
  return NextResponse.json({ user });
}
