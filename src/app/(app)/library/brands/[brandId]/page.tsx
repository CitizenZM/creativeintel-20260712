import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { findAccessibleWorkspace } from "@/services/workspace";

export const dynamic = "force-dynamic";

export default async function BrandProfilePage({
  params,
}: {
  params: Promise<{ brandId: string }>;
}) {
  const { brandId } = await params;
  const brand = await prisma.brandProfile.findUnique({
    where: { id: brandId },
    include: {
      projects: { orderBy: { updatedAt: "desc" }, take: 20 },
      workspace: true,
    },
  });
  // Brand profiles belong to a workspace; a member may only open their own.
  if (!brand || !(await findAccessibleWorkspace(brand.workspaceId))) notFound();

  return (
    <div className="max-w-3xl mx-auto space-y-6 p-6">
      <Link href="/library/brands" className="text-sm text-muted-foreground hover:text-foreground">
        ← Brand library
      </Link>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{brand.name}</h1>
        <p className="text-sm text-muted-foreground">
          {brand.url ?? "—"} · workspace {brand.workspace.name}
        </p>
      </header>

      <section className="grid sm:grid-cols-2 gap-3 text-sm">
        <Field label="Brand promise" value={brand.brandPromise} />
        <Field label="Value proposition" value={brand.valueProposition} />
        <Field label="Tone of voice" value={brand.toneOfVoice} />
        <Field label="Target audience" value={brand.targetAudience} />
        <Field label="Pricing theme" value={brand.pricingTheme} />
        <Field label="Category" value={brand.category} />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Projects ({brand.projects.length})
        </h2>
        <div className="rounded-lg border border-border divide-y divide-border">
          {brand.projects.map((p) => (
            <Link
              key={p.id}
              href={`/projects/${p.id}/overview`}
              className="block px-4 py-3 hover:bg-muted/40 transition"
            >
              <div className="font-medium text-sm">{p.name}</div>
              <div className="text-xs text-muted-foreground">
                {p.status} · {new Date(p.updatedAt).toLocaleDateString()}
              </div>
            </Link>
          ))}
          {brand.projects.length === 0 && (
            <div className="px-4 py-6 text-sm text-muted-foreground">
              No projects yet for this brand.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="mt-1">{value ?? "—"}</div>
    </div>
  );
}
