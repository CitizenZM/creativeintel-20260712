/** Pure mapping from a Clerk user to the fields we keep on AppUser (src/services/app-user.ts). */
export interface ClerkUserLike {
  primaryEmailAddressId: string | null;
  emailAddresses: { id: string; emailAddress: string; verification: { status: string } | null }[];
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  /** Epoch ms when the user ticked Clerk's legal-consent box at sign-up; null/absent if never. */
  legalAcceptedAt?: number | null;
}

/**
 * `ownerEligibleEmail` is the email only when Clerk has verified it — OWNER_EMAILS must never match
 * an address someone merely typed in.
 */
export function clerkProfile(user: ClerkUserLike): {
  email: string | null;
  name: string | null;
  ownerEligibleEmail: string | null;
  legalAcceptedAt: Date | null;
} {
  const primary =
    user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId) ?? user.emailAddresses[0] ?? null;
  const fullName = [user.firstName, user.lastName]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join(" ");
  const email = primary ? primary.emailAddress.trim().toLowerCase() : null;
  return {
    email,
    name: fullName || user.username?.trim() || null,
    ownerEligibleEmail: primary?.verification?.status === "verified" ? email : null,
    legalAcceptedAt: typeof user.legalAcceptedAt === "number" ? new Date(user.legalAcceptedAt) : null,
  };
}

/** lastSeenAt is refreshed at most this often, so page loads don't each write to the DB. */
export const SEEN_THROTTLE_MS = 5 * 60 * 1000;

export function needsTouch(lastSeenAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - lastSeenAt.getTime() > SEEN_THROTTLE_MS;
}
