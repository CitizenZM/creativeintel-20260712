import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

/**
 * Account boundaries for data that isn't reached through a /projects/<id> URL (which the proxy
 * already checks): ids taken from a request body or query, and cross-project "memory" such as the
 * structure library and trend data. A tenant is the AppUser who owns a project's workspace; the
 * master admin's tenant (null) is every project in an ownerless workspace, in no workspace, or in a
 * workspace owned by an admin. Works without a request (worker / cron), since it keys off the project;
 * the signed-in viewer's side lives in src/services/workspace.ts (viewerTenant, viewerCanUseProject).
 */
export type TenantId = string | null;

/** The tenant a project belongs to; undefined when the project doesn't exist. */
export async function tenantOfProject(projectId: string): Promise<TenantId | undefined> {
  const p = await prisma.project.findUnique({
    where: { id: projectId },
    select: { workspace: { select: { ownerId: true, owner: { select: { role: true } } } } },
  });
  if (!p) return undefined;
  const owner = p.workspace?.ownerId ?? null;
  return owner && p.workspace?.owner?.role !== "owner" ? owner : null;
}

/** Prisma filter: every project in this tenant. */
export function tenantProjectWhere(tenant: TenantId): Prisma.ProjectWhereInput {
  if (tenant) return { workspace: { ownerId: tenant } };
  return {
    OR: [{ workspaceId: null }, { workspace: { ownerId: null } }, { workspace: { owner: { role: "owner" } } }],
  };
}

/** Ids of every project sharing a tenant with this one (for tables without a Project relation). */
export async function sameTenantProjectIds(projectId: string): Promise<string[]> {
  const tenant = await tenantOfProject(projectId);
  if (tenant === undefined) return [];
  const rows = await prisma.project.findMany({ where: tenantProjectWhere(tenant), select: { id: true } });
  return rows.map((r) => r.id);
}
