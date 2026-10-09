import { clerkClient } from "@clerk/nextjs/server";
import { z } from "zod";

/**
 * Admin invitations (/settings/users → POST /api/settings/invitations). Clerk emails the invitee a
 * link to /sign-up carrying an invitation ticket: their email is pre-verified, they still tick the
 * Terms / Privacy consent box, and on first sign-in they get their own empty workspace like any
 * other member (src/services/app-user.ts). Sign-up stays open; an invitation is just a nudge.
 */
export const inviteSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254) });

export interface PendingInvitation {
  id: string;
  email: string;
  createdAt: number;
  invitedBy: string | null;
}

/** Where the invitation link lands: the canonical host's sign-up page. */
export function invitationRedirectUrl(env: NodeJS.ProcessEnv = process.env): string {
  const host = env.AUTH_CANONICAL_HOST?.trim() || "creative.xark.io";
  return `https://${host}/sign-up`;
}

export async function listPendingInvitations(): Promise<PendingInvitation[]> {
  const client = await clerkClient();
  const { data } = await client.invitations.getInvitationList({ status: "pending", orderBy: "-created_at", limit: 100 });
  return data.map((i) => ({
    id: i.id,
    email: i.emailAddress,
    createdAt: i.createdAt,
    invitedBy: typeof i.publicMetadata?.invitedBy === "string" ? i.publicMetadata.invitedBy : null,
  }));
}

export async function sendInvitation(email: string, invitedBy: string) {
  const client = await clerkClient();
  const invitation = await client.invitations.createInvitation({
    emailAddress: email,
    redirectUrl: invitationRedirectUrl(),
    notify: true,
    publicMetadata: { invitedBy },
  });
  return { id: invitation.id, email: invitation.emailAddress, status: invitation.status, createdAt: invitation.createdAt };
}

export async function revokeInvitation(id: string) {
  const client = await clerkClient();
  const invitation = await client.invitations.revokeInvitation(id);
  return { id: invitation.id, email: invitation.emailAddress, status: invitation.status };
}

/** Clerk's API errors carry `errors[0].longMessage`; fall back to the message. */
export function clerkErrorMessage(err: unknown): string {
  const e = err as { errors?: { longMessage?: string; message?: string; code?: string }[]; message?: string };
  return e?.errors?.[0]?.longMessage || e?.errors?.[0]?.message || e?.message || "Clerk request failed";
}
