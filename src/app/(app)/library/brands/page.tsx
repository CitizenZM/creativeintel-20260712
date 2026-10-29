import Link from "next/link";
import { prisma } from "@/lib/db";
import { listBrandProfiles } from "@/services/brand-library";
import { getActiveWorkspace } from "@/services/workspace";

export const dynamic = "force-dynamic";

export default async function BrandLibraryPage() {
  const workspace = await getActiveWorkspace();
  const [brands, competitors] = await Promise.all([
    listBrandProfiles(workspace.id),
    prisma.competitorProfile.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { updatedAt: "desc" },
      include: { _count: { select: { competitors: true } } },
    }),
  ]);

  return (
    <div className="max-w-5xl mx-auto space-y-8 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Brand library</h1>
        <p className="text-sm text-muted-foreground">
          Workspace · {workspace.name}
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Brands ({brands.length})
        </h2>
        {brands.length === 0 ? (
          <EmptyState label="No brands yet. They appear after your first research run." />
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {brands.map((b) => (
              <Link
                key={b.id}
                href={`/library/brands/${b.id}`}
                className="rounded-lg border border-border p-4 hover:border-foreground/40 transition"
              >
                <div className="font-medium">{b.name}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {b._count.projects} project{b._count.projects === 1 ? "" : "s"}
                  {b.lastCrawledAt
                    ? ` · crawled ${new Date(b.lastCrawledAt).toLocaleDateString()}`
                    : ""}
                </div>
                {b.url && (
                  <div className="text-xs text-muted-foreground truncate mt-1">
                    {b.url}
                  </div>
                )}
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Competitors ({competitors.length})
        </h2>
        {competitors.length === 0 ? (
          <EmptyState label="No competitor profiles yet." />
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {competitors.map((c) => (
              <div
                key={c.id}
                className="rounded-lg border border-border p-4"
              >
                <div className="font-medium">{c.name}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {c._count.competitors} reference{c._count.competitors === 1 ? "" : "s"}
                  {c.lastCrawledAt
                    ? ` · crawled ${new Date(c.lastCrawledAt).toLocaleDateString()}`
                    : ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
      {label}
    </div>
  );
}
