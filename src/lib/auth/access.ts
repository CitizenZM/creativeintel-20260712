import { parseOwnerEmails, type AppUserRole } from "./roles";
import type { TtlCache } from "./ttl-cache";

/**
 * Who is making a request, as the proxy sees it (src/lib/auth/gate.ts). Sign-up is open: every
 * account is active unless an owner blocks it. An `owner` is the master admin and reaches every
 * workspace; a `member` only reaches workspaces they own (Workspace.ownerId).
 *
 * Why a DB lookup and not Clerk `publicMetadata`: the default Clerk session token carries no
 * metadata, and the proxy runs on the Node.js runtime in Next 16, so Prisma is available there.
 * Results are cached per key for a short TTL.
 */
export type AccountStatus = "active" | "blocked";

export interface Principal {
  /** AppUser.id — null until the root layout has created the row on the first page load. */
  appUserId: string | null;
  role: AppUserRole;
  status: AccountStatus;
}

export function normalizeStatus(raw: string | null | undefined): AccountStatus {
  return raw === "blocked" ? "blocked" : "active";
}

export interface PrincipalRow {
  id: string;
  role: string;
  status: string;
  email: string;
}

export interface PrincipalDeps {
  /** The AppUser row for a Clerk user, or null when they've never been upserted. */
  findUser(clerkUserId: string): Promise<PrincipalRow | null>;
  /** The user's primary email if Clerk has verified it (lower-cased), else null. */
  verifiedEmail(clerkUserId: string): Promise<string | null>;
  ownerEmails(): string | undefined;
  cache: TtlCache<Principal>;
}

/**
 * `getPrincipal(clerkUserId)`: the row's role and status, except that a user OWNER_EMAILS could
 * match (no row yet, or the row's email is listed) has their email re-checked against Clerk — a
 * verified match is an owner, so the owner's very first request isn't treated as a member.
 * Owners are never blocked. Errors propagate (and aren't cached) so the gate can fail closed.
 */
export function createPrincipalLookup(deps: PrincipalDeps) {
  return async function getPrincipal(clerkUserId: string): Promise<Principal> {
    const cached = deps.cache.get(clerkUserId);
    if (cached) return cached;

    const row = await deps.findUser(clerkUserId);
    let role: AppUserRole = row?.role === "owner" ? "owner" : "member";
    if (role !== "owner") {
      const owners = parseOwnerEmails(deps.ownerEmails());
      const mayBeOwner = owners.length > 0 && (!row || owners.includes(row.email.trim().toLowerCase()));
      if (mayBeOwner) {
        const email = await deps.verifiedEmail(clerkUserId);
        if (email && owners.includes(email)) role = "owner";
      }
    }
    const principal: Principal = {
      appUserId: row?.id ?? null,
      role,
      status: role === "owner" ? "active" : normalizeStatus(row?.status),
    };
    deps.cache.set(clerkUserId, principal);
    return principal;
  };
}

/** A coworker's level on a project shared with them (ProjectShare.access). */
export type ShareAccess = "view" | "download" | "edit";
export const SHARE_ACCESS: readonly ShareAccess[] = ["view", "download", "edit"];

export function normalizeShareAccess(raw: string | null | undefined): ShareAccess | null {
  return raw === "view" || raw === "download" || raw === "edit" ? raw : null;
}

/**
 * Whose data a project is: its workspace's owner (null = the master admin's), plus — when looked up
 * for a particular user — that user's share of it, if any.
 */
export interface ProjectTenant {
  ownerId: string | null;
  share?: ShareAccess | null;
}

/** full = it's yours (or you're the master admin); otherwise the level it was shared with you at. */
export type ProjectAccess = "full" | ShareAccess;

export const ACCESS_RANK: Record<ProjectAccess, number> = { view: 1, download: 2, edit: 3, full: 4 };

export function projectAccessFor(principal: Principal, tenant: ProjectTenant | null): ProjectAccess | null {
  if (principal.role === "owner") return "full";
  if (!tenant || !principal.appUserId) return null;
  if (tenant.ownerId === principal.appUserId) return "full";
  return tenant.share ?? null;
}

/** May this principal open this project at all? Owners: always. Members: their own, or shared with them. */
export function canAccessProject(principal: Principal, tenant: ProjectTenant | null): boolean {
  return projectAccessFor(principal, tenant) !== null;
}
