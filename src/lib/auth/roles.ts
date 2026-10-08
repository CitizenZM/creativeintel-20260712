export type AppUserRole = "owner" | "member";

/** OWNER_EMAILS: comma / semicolon / whitespace separated, case-insensitive. */
export function parseOwnerEmails(raw: string | undefined): string[] {
  if (!raw) return [];
  const out = new Set<string>();
  for (const part of raw.split(/[\s,;]+/)) {
    const email = part.trim().toLowerCase();
    if (email) out.add(email);
  }
  return [...out];
}

/**
 * A user whose email is in OWNER_EMAILS is an owner; everyone else is a member.
 * Promote-only: an existing owner (e.g. set by hand in the DB) is never demoted here.
 */
export function resolveRole(
  email: string | null | undefined,
  ownerEmailsRaw: string | undefined,
  current?: AppUserRole | string | null,
): AppUserRole {
  if (current === "owner") return "owner";
  const normalized = email?.trim().toLowerCase();
  if (normalized && parseOwnerEmails(ownerEmailsRaw).includes(normalized)) return "owner";
  return "member";
}
