import { cache } from "react";
import { unstable_rethrow } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";
import type { AppUser } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { isClerkActive } from "@/lib/auth/mode";
import { clerkProfile, needsTouch } from "@/lib/auth/profile";
import { resolveRole } from "@/lib/auth/roles";

/**
 * The signed-in person's AppUser row, created on their first authenticated request (lazy upsert —
 * no webhook). Role comes from OWNER_EMAILS matched against the Clerk-verified primary email (see
 * src/lib/auth/roles.ts). Returns null when Clerk
 * isn't the active gate, when nobody is signed in, or when the DB is unreachable (never throws, so
 * the root layout can always render). Memoized per request.
 */
export const currentAppUser = cache(async (): Promise<AppUser | null> => {
  if (!isClerkActive()) return null;
  // Outside the try: auth() reads headers, and Next must see that to render the route dynamically.
  const { userId } = await auth();
  if (!userId) return null;
  try {
    const owners = process.env.OWNER_EMAILS;
    const now = new Date();

    const existing = await prisma.appUser.findUnique({ where: { clerkUserId: userId } });
    if (existing) {
      let role = existing.role;
      // OWNER_EMAILS now lists this user: promote, but only on a verified email (re-read from Clerk).
      if (resolveRole(existing.email, owners, existing.role) !== existing.role) {
        const user = await currentUser();
        role = resolveRole(user ? clerkProfile(user).ownerEligibleEmail : null, owners, existing.role);
      }
      if (role === existing.role && !needsTouch(existing.lastSeenAt, now)) return existing;
      return await prisma.appUser.update({ where: { id: existing.id }, data: { role, lastSeenAt: now } });
    }

    // First visit: fetch the profile from Clerk's Backend API (once per user).
    const user = await currentUser();
    if (!user) return null;
    const { email, name, ownerEligibleEmail } = clerkProfile(user);
    return await prisma.appUser.upsert({
      where: { clerkUserId: userId },
      create: {
        clerkUserId: userId,
        email: email ?? "",
        name,
        role: resolveRole(ownerEligibleEmail, owners),
        lastSeenAt: now,
      },
      update: { lastSeenAt: now },
    });
  } catch (err) {
    unstable_rethrow(err);
    console.error("[auth] currentAppUser failed:", err);
    return null;
  }
});
