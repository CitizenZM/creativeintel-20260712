import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { prisma } from "@/lib/db";
import { currentAppUser } from "@/services/app-user";
import { UserActions } from "@/components/settings/user-actions";

export const metadata: Metadata = { title: "Users · CreativeIntel OS" };
export const dynamic = "force-dynamic";

const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

/**
 * Master-admin list of every account (AppUser rows), with how much each holds in its own workspaces.
 * Sign-up is open; each member only ever sees their own workspace, so this page is where the admin
 * blocks an account or makes someone else an admin. 404 for anyone else.
 */
export default async function UsersPage() {
  const me = await currentAppUser();
  if (me?.role !== "owner") notFound();

  const [users, projectCounts] = await Promise.all([
    prisma.appUser.findMany({
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { workspaces: true } } },
    }),
    prisma.project.groupBy({ by: ["workspaceId"], _count: { _all: true } }),
  ]);
  const workspaces = await prisma.workspace.findMany({ select: { id: true, ownerId: true } });
  const ownerOf = new Map(workspaces.map((w) => [w.id, w.ownerId]));
  const projectsByUser = new Map<string | null, number>();
  for (const row of projectCounts) {
    // Ownerless workspaces (and projects with no workspace) are the master admin's legacy data.
    const owner = row.workspaceId ? (ownerOf.get(row.workspaceId) ?? null) : null;
    projectsByUser.set(owner, (projectsByUser.get(owner) ?? 0) + row._count._all);
  }

  return (
    <div>
      <Header
        title="Users"
        description="Everyone who has created an account. Sign-up is open and each account only sees its own workspace; admins (OWNER_EMAILS, or made here) see everything."
      />
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Projects</TableHead>
                <TableHead>Joined (UTC)</TableHead>
                <TableHead>Last seen (UTC)</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.name ?? "—"}</TableCell>
                  <TableCell>{u.email || "—"}</TableCell>
                  <TableCell>
                    <Badge variant={u.role === "owner" ? "default" : "secondary"}>
                      {u.role === "owner" ? "admin" : "member"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.status === "blocked" ? "destructive" : "outline"}>{u.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {(projectsByUser.get(u.id) ?? 0) + (u.role === "owner" && u.id === me.id ? (projectsByUser.get(null) ?? 0) : 0)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{fmt.format(u.createdAt)}</TableCell>
                  <TableCell className="text-muted-foreground">{fmt.format(u.lastSeenAt)}</TableCell>
                  <TableCell>{u.id !== me.id && <UserActions id={u.id} role={u.role} status={u.status} />}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
