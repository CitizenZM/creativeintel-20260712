import type { AppUser, Workspace } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

/** "ann@example.com" → "ann", for a readable workspace name / slug. */
function handleOf(user: Pick<AppUser, "name" | "email">): string {
  return (user.name?.trim() || user.email.split("@")[0] || "My").slice(0, 40);
}

/**
 * The member's own workspace — created empty on their first sign-in. Their projects, brand library,
 * competitor library and history all hang off it, so a new account starts with a blank slate and
 * never sees another account's records. Idempotent: returns the oldest workspace they own.
 */
export async function ensurePersonalWorkspace(user: Pick<AppUser, "id" | "name" | "email">): Promise<Workspace> {
  const owned = await prisma.workspace.findFirst({ where: { ownerId: user.id }, orderBy: { createdAt: "asc" } });
  if (owned) return owned;
  const slug = `u-${user.id}`; // unique per account, so concurrent first requests converge on one row
  return prisma.workspace.upsert({
    where: { slug },
    update: {},
    create: { slug, name: `${handleOf(user)}'s workspace`, ownerId: user.id },
  });
}
