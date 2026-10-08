import { parseOwnerEmails } from "./roles";

/** What the master admin can do to another account from /settings/users (POST /api/settings/users/[id]). */
export const USER_ACTIONS = ["block", "unblock", "make-owner", "make-member"] as const;
export type UserAction = (typeof USER_ACTIONS)[number];

export interface UserActionTarget {
  id: string;
  email: string;
  role: string;
  status: string;
}

export interface UserActionData {
  status?: "active" | "blocked";
  role?: "owner" | "member";
}

export type UserActionPlan =
  | { ok: true; data: UserActionData }
  | { ok: false; status: 400 | 409; error: string };

/**
 * The AppUser update for an owner's action, or why it's refused.
 * - block       → blocked (and demoted: a blocked account is never an admin)
 * - unblock     → active
 * - make-owner  → owner (master admin: sees every account's workspace) and active
 * - make-member → member
 * Owners can't block / demote themselves, nor an OWNER_EMAILS owner (the env would re-promote them).
 */
export function planUserAction({
  actor,
  target,
  action,
  ownerEmails,
}: {
  actor: { id: string };
  target: UserActionTarget;
  action: string;
  ownerEmails: string | undefined;
}): UserActionPlan {
  switch (action) {
    case "unblock":
      return { ok: true, data: { status: "active" } };
    case "make-owner":
      return { ok: true, data: { role: "owner", status: "active" } };
    case "block":
    case "make-member": {
      if (target.id === actor.id) return { ok: false, status: 400, error: "You can't lock yourself out" };
      const envOwner = parseOwnerEmails(ownerEmails).includes(target.email.trim().toLowerCase());
      if (envOwner) {
        return { ok: false, status: 409, error: "This owner is listed in OWNER_EMAILS; remove them there first" };
      }
      return { ok: true, data: action === "block" ? { status: "blocked", role: "member" } : { role: "member" } };
    }
    default:
      return { ok: false, status: 400, error: `Unknown action "${action}"` };
  }
}
