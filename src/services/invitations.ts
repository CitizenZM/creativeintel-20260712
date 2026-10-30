import { clerkClient } from "@clerk/nextjs/server";
import { z } from "zod";
import { APP_KEY, accountSignUpUrl, appLandingUrl, parseApps } from "@/lib/auth/account";

/**
 * Admin invitations (/settings/users → POST /api/settings/invitations), on the shared Xark Accounts
 * instance. Clerk emails the invitee a link to account.xark.io/sign-up carrying an invitation ticket
 * and the `apps.creative = "member"` grant; after sign-up they land back here and, on first sign-in,
 * get their own empty workspace like any other member (src/services/app-user.ts).
 */
export const inviteSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254) });

export interface PendingInvitation {
  id: string;
  email: string;
  createdAt: number;
  invitedBy: string | null;
}

/** Where the invitation link lands: Xark Accounts sign-up, returning to this app's landing page. */
export function invitationRedirectUrl(env: NodeJS.ProcessEnv = process.env): string {
  return accountSignUpUrl(appLandingUrl(env), env);
}

export async function listPendingInvitations(): Promise<PendingInvitation[]> {
  const client = await clerkClient();
  const { data } = await client.invitations.getInvitationList({ status: "pending", orderBy: "-created_at", limit: 100 });
  // The instance is shared by every Xark app: only list invitations that grant CreativeIntel.
  return data.filter((i) => !!parseApps(i.publicMetadata?.apps)[APP_KEY]).map((i) => ({
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
    publicMetadata: { apps: { [APP_KEY]: "member" }, invitedBy },
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
