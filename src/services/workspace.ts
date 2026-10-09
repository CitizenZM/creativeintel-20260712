import { cookies } from "next/headers";
import type { AppUser, Prisma, Workspace } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { isClerkActive } from "@/lib/auth/mode";
import { currentAppUser } from "@/services/app-user";
import { ensureDefaultWorkspace } from "@/services/brand-library";
import { ensurePersonalWorkspace } from "@/services/personal-workspace";
import { tenantOfProject, type TenantId } from "@/services/tenancy";

export const ACTIVE_WORKSPACE_COOKIE = "activeWorkspaceId";

/**
 * Who is looking, for workspace scoping.
 * - admin  — the master admin (an owner), or any non-Clerk mode (local dev / Cloudflare Access,
 *            which only ever admitted the owner): every workspace, including the default one that
 *            holds all pre-account data.
 * - member — a self-registered account: only the workspaces they own.
 * Fails closed: in Clerk mode with no resolvable account it throws instead of falling back to admin.
 */
export type Viewer = { kind: "admin"; user: AppUser | null } | { kind: "member"; user: AppUser };

export async function currentViewer(): Promise<Viewer> {
  if (!isClerkActive()) return { kind: "admin", user: null };
  const me = await currentAppUser();
  if (!me) throw new Error("[workspace] no signed-in account — refusing to scope data");
  return me.role === "owner" ? { kind: "admin", user: me } : { kind: "member", user: me };
}

export async function listWorkspaces() {
  const viewer = await currentViewer();
  const include = { _count: { select: { projects: true } } } as const;
  if (viewer.kind === "member") {
    await ensurePersonalWorkspace(viewer.user);
    return prisma.workspace.findMany({ where: { ownerId: viewer.user.id }, orderBy: { createdAt: "asc" }, include });
  }
  // Guarantee the default workspace exists so the switcher is never empty.
  await ensureDefaultWorkspace();
  return prisma.workspace.findMany({ orderBy: { createdAt: "asc" }, include });
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "workspace"
  );
}

export async function createWorkspace(name: string) {
  const viewer = await currentViewer();
  const base = slugify(name);
  // Ensure slug uniqueness with a numeric suffix if needed.
  let slug = base;
  for (let i = 2; ; i++) {
    const clash = await prisma.workspace.findUnique({ where: { slug } });
    if (!clash) break;
    slug = `${base}-${i}`;
  }
  return prisma.workspace.create({
    data: { name: name.trim() || "Untitled workspace", slug, ownerId: viewer.user?.id ?? null },
  });
}

/** The workspace with this id if the viewer may use it, else null. */
export async function findAccessibleWorkspace(id: string, viewer?: Viewer): Promise<Workspace | null> {
  const v = viewer ?? (await currentViewer());
  const ws = await prisma.workspace.findUnique({ where: { id } });
  if (!ws) return null;
  if (v.kind === "member" && ws.ownerId !== v.user.id) return null;
  return ws;
}

/**
 * Resolve the active workspace from the cookie. Admin: falls back to the default workspace. Member:
 * the cookie only counts if they own that workspace, otherwise their personal one. Always returns a
 * real, existing workspace the viewer may use.
 */
export async function getActiveWorkspace() {
  const viewer = await currentViewer();
  const store = await cookies();
  const id = store.get(ACTIVE_WORKSPACE_COOKIE)?.value;
  if (viewer.kind === "member") {
    const personal = await ensurePersonalWorkspace(viewer.user);
    if (!id || id === personal.id) return personal;
    return (await findAccessibleWorkspace(id, viewer)) ?? personal;
  }
  const fallback = await ensureDefaultWorkspace();
  if (!id || id === fallback.id) return fallback;
  const ws = await prisma.workspace.findUnique({ where: { id } });
  return ws ?? fallback;
}

/**
 * Build a project `where` filter for the active workspace.
 *
 * The default workspace also surfaces legacy projects that have no workspace
 * assigned (workspaceId = null), so nothing is ever hidden after this feature
 * ships. Every other workspace sees only its own projects; a member also sees projects shared with them.
 */
export async function projectWorkspaceFilter(): Promise<Prisma.ProjectWhereInput> {
  const viewer = await currentViewer();
  const active = await getActiveWorkspace();
  if (viewer.kind === "member") {
    // Their workspace's projects, plus any project shared with them (src/services/project-shares.ts).
    return { OR: [{ workspaceId: active.id }, { shares: { some: { userId: viewer.user.id } } }] };
  }
  const fallback = await ensureDefaultWorkspace();
  if (active.id === fallback.id) {
    return { OR: [{ workspaceId: active.id }, { workspaceId: null }] };
  }
  return { workspaceId: active.id };
}

/** The signed-in viewer's tenant: null for the master admin (and non-Clerk modes). */
export async function viewerTenant(): Promise<TenantId> {
  const viewer = await currentViewer();
  return viewer.kind === "member" ? viewer.user.id : null;
}

/**
 * May the signed-in viewer use this project? The admin may use any existing project; a member only
 * their own. For ids that arrive in a body or query string — the proxy only sees the URL.
 */
export async function viewerCanUseProject(projectId: string): Promise<boolean> {
  const tenant = await tenantOfProject(projectId);
  if (tenant === undefined) return false;
  const viewer = await currentViewer();
  return viewer.kind === "admin" || tenant === viewer.user.id;
}
