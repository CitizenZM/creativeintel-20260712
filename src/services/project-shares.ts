import { prisma } from "@/lib/db";
import { normalizeShareAccess, type ShareAccess } from "@/lib/auth/access";

/**
 * Project sharing (ProjectShare). The master admin shares chosen projects with a coworker by email —
 * at view, download or edit level — from /settings/users, optionally with a Clerk invitation. Shares
 * are keyed by email so they exist before the person signs up; linkSharesToUser() attaches them on
 * their first sign-in with that (verified) address. Enforcement lives in the proxy
 * (src/lib/auth/gate.ts → projectAction); listings include shared projects (src/services/workspace.ts).
 */
export interface ShareRow {
  id: string;
  projectId: string;
  projectName: string;
  email: string;
  access: ShareAccess;
  joined: boolean;
  createdAt: Date;
}

const norm = (email: string) => email.trim().toLowerCase();

/** Give an account the shares that were waiting for its (verified) email. Returns how many. */
export async function linkSharesToUser(userId: string, verifiedEmail: string): Promise<number> {
  const { count } = await prisma.projectShare.updateMany({
    where: { email: norm(verifiedEmail), userId: null },
    data: { userId },
  });
  return count;
}

/**
 * Share each project with `email` at `access` (an existing share's level is updated). Linked to the
 * account right away when one exists with that email. Unknown project ids are ignored.
 */
export async function shareProjects(input: {
  projectIds: string[];
  email: string;
  access: ShareAccess;
  createdById: string | null;
}): Promise<{ shared: number; userId: string | null }> {
  const email = norm(input.email);
  const ids = [...new Set(input.projectIds)];
  if (!ids.length) return { shared: 0, userId: null };
  const [user, projects] = await Promise.all([
    prisma.appUser.findFirst({ where: { email }, select: { id: true } }),
    prisma.project.findMany({ where: { id: { in: ids } }, select: { id: true } }),
  ]);
  await prisma.$transaction(
    projects.map((p) =>
      prisma.projectShare.upsert({
        where: { projectId_email: { projectId: p.id, email } },
        create: { projectId: p.id, email, access: input.access, userId: user?.id ?? null, createdById: input.createdById },
        update: { access: input.access, ...(user ? { userId: user.id } : {}) },
      }),
    ),
  );
  return { shared: projects.length, userId: user?.id ?? null };
}

export async function listShares(): Promise<ShareRow[]> {
  const rows = await prisma.projectShare.findMany({
    orderBy: [{ email: "asc" }, { createdAt: "asc" }],
    include: { project: { select: { brandName: true, name: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    projectId: r.projectId,
    projectName: r.project.brandName || r.project.name,
    email: r.email,
    access: normalizeShareAccess(r.access) ?? "view",
    joined: r.userId !== null,
    createdAt: r.createdAt,
  }));
}

export async function updateShareAccess(id: string, access: ShareAccess) {
  return prisma.projectShare.update({ where: { id }, data: { access } });
}

export async function removeShare(id: string) {
  return prisma.projectShare.delete({ where: { id } });
}

/** projectId → this user's share level, for badges and the project banner. */
export async function sharedAccessByProject(userId: string): Promise<Map<string, ShareAccess>> {
  const rows = await prisma.projectShare.findMany({ where: { userId }, select: { projectId: true, access: true } });
  return new Map(rows.flatMap((r) => (normalizeShareAccess(r.access) ? [[r.projectId, normalizeShareAccess(r.access)!]] : [])));
}
