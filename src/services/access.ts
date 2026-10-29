import { clerkClient } from "@clerk/nextjs/server";
import { createPrincipalLookup, normalizeShareAccess, type Principal, type ProjectTenant } from "@/lib/auth/access";
import { clerkProfile } from "@/lib/auth/profile";
import { type TtlCache } from "@/lib/auth/ttl-cache";

/** Authorization reads the shared database on every request. Removing process-local
 * permission caches makes block/share changes effective on every instance immediately
 * and fails closed when the database is unavailable. */
const principals: TtlCache<Principal> = {
  get: () => undefined, getStale: () => undefined,
  set: () => {}, delete: () => {}, clear: () => {}, size: 0,
};

async function db() {
  // Imported lazily so the proxy only builds a DB client once Clerk mode actually needs one.
  return (await import("@/lib/db")).prisma;
}

/** The proxy's principal lookup: AppUser via Prisma (Node runtime), with a ~30 s per-user cache. */
export const getPrincipal = createPrincipalLookup({
  async findUser(clerkUserId) {
    return (await db()).appUser.findUnique({
      where: { clerkUserId },
      select: { id: true, role: true, status: true, email: true },
    });
  },
  async verifiedEmail(clerkUserId) {
    const user = await (await clerkClient()).users.getUser(clerkUserId);
    return clerkProfile(user).ownerEligibleEmail;
  },
  ownerEmails: () => process.env.OWNER_EMAILS,
  cache: principals,
});

/**
 * Whose workspace a project lives in (null when the project doesn't exist), plus `appUserId`'s share
 * of it when they don't own it.
 */
export async function getProjectTenant(projectId: string, appUserId: string | null = null): Promise<ProjectTenant | null> {
  const prisma = await db();
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      workspace: { select: { ownerId: true } },
      ...(appUserId ? { shares: { where: { userId: appUserId }, select: { access: true }, take: 1 } } : {}),
    },
  });
  if (!project) return null;
  return {
    ownerId: project.workspace?.ownerId ?? null,
    ...(appUserId ? { share: normalizeShareAccess(project.shares?.[0]?.access) } : {}),
  };
}

// Retained for callers; there is no stale process-local permission state to invalidate.
export function invalidateShares(): void {}
export function invalidatePrincipal(_clerkUserId: string): void {}
