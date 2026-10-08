import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { prisma } from "@/lib/db";
import { currentAppUser } from "@/services/app-user";

export const metadata: Metadata = { title: "Users · CreativeIntel OS" };
export const dynamic = "force-dynamic";

const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

/** Owner-only list of everyone who has signed in (AppUser rows). 404 for anyone else. */
export default async function UsersPage() {
  const me = await currentAppUser();
  if (me?.role !== "owner") notFound();

  const users = await prisma.appUser.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { projects: true } } },
  });

  return (
    <div>
      <Header
        title="Users"
        description="Everyone who has created an account. Owners come from OWNER_EMAILS; sign-up rules live in the Clerk dashboard."
      />
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Projects</TableHead>
                <TableHead>Joined (UTC)</TableHead>
                <TableHead>Last seen (UTC)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.name ?? "—"}</TableCell>
                  <TableCell>{u.email || "—"}</TableCell>
                  <TableCell>
                    <Badge variant={u.role === "owner" ? "default" : "secondary"}>{u.role}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{u._count.projects}</TableCell>
                  <TableCell className="text-muted-foreground">{fmt.format(u.createdAt)}</TableCell>
                  <TableCell className="text-muted-foreground">{fmt.format(u.lastSeenAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
