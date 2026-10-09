import { clerkClient } from "@clerk/nextjs/server";
import { createPrincipalLookup, normalizeShareAccess, type Principal, type ProjectTenant, type ShareAccess } from "@/lib/auth/access";
import { clerkProfile } from "@/lib/auth/profile";
import { createTtlCache, type TtlCache } from "@/lib/auth/ttl-cache";

/** How long an account's role / status is trusted before the DB is asked again. */
export const PRINCIPAL_TTL_MS = 30_000;
/** A project never changes workspace, and a workspace never changes owner, so this can be longer. */
export const TENANT_TTL_MS = 120_000;
/** Share levels change from /settings/users; this process drops its copy at once, others within 15 s. */
export const SHARE_TTL_MS = 15_000;

// On globalThis so the proxy bundle and the route bundles share one cache when they run in the same
// process (`next start`); on Vercel they may be separate instances, hence the short TTLs.
const g = globalThis as unknown as {
  __principalCache?: TtlCache<Principal>;
  __tenantCache?: TtlCache<ProjectTenant | null>;
  __shareCache?: TtlCache<{ access: ShareAccess | null }>;
};
const principals = (g.__principalCache ??= createTtlCache<Principal>({ ttlMs: PRINCIPAL_TTL_MS }));
const tenants = (g.__tenantCache ??= createTtlCache<ProjectTenant | null>({ ttlMs: TENANT_TTL_MS }));
const shares = (g.__shareCache ??= createTtlCache<{ access: ShareAccess | null }>({ ttlMs: SHARE_TTL_MS }));

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
  let tenant = tenants.get(projectId);
  if (tenant === undefined) {
    const project = await (await db()).project.findUnique({
      where: { id: projectId },
      select: { workspace: { select: { ownerId: true } } },
    });
    tenant = project ? { ownerId: project.workspace?.ownerId ?? null } : null;
    // Don't cache a miss: the project may be created a moment later.
    if (tenant) tenants.set(projectId, tenant);
  }
  if (!tenant || !appUserId || tenant.ownerId === appUserId) return tenant;

  const key = `${projectId}:${appUserId}`;
  let share = shares.get(key);
  if (!share) {
    const row = await (await db()).projectShare.findFirst({
      where: { projectId, userId: appUserId },
      select: { access: true },
    });
    share = { access: normalizeShareAccess(row?.access) };
    shares.set(key, share);
  }
  return { ...tenant, share: share.access };
}

/** Forget cached share levels after an admin changes them (same process only). */
export function invalidateShares(): void {
  shares.clear();
}

/** Forget a user's cached role / status after an owner changes it (same process only). */
export function invalidatePrincipal(clerkUserId: string): void {
  principals.delete(clerkUserId);
}
