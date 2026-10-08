/**
 * GET — the project's content history (ProjectArtifact versions, services/artifacts), newest version
 * first within each slot. Filters: ?kind=master,variant &runId= &sourceKey= &q= (title) &latest=1 &limit=
 * Rows carry no content or bytes: GET …/artifacts/[artifactId]/download serves those.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { LIST_SELECT, latestOnly, listWhere, parseListFilters, toListItem } from "@/services/artifacts/serve";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const f = parseListFilters(new URL(request.url).searchParams);
  const [rows, counts] = await Promise.all([
    prisma.projectArtifact.findMany({ where: listWhere(projectId, f), orderBy: [{ kind: "asc" }, { sourceKey: "asc" }, { version: "desc" }], take: f.limit, select: LIST_SELECT }),
    prisma.projectArtifact.groupBy({ by: ["kind"], where: { projectId }, _count: { _all: true }, _sum: { bytes: true } }),
  ]);
  const items = (f.latest ? latestOnly(rows) : rows).map((r) => toListItem(projectId, r));
  return NextResponse.json({
    items,
    truncated: rows.length >= f.limit,
    byKind: Object.fromEntries(counts.map((c) => [c.kind, { count: c._count._all, bytes: c._sum.bytes ?? 0 }])),
    archiveUrl: `/api/projects/${projectId}/artifacts/archive`,
  });
}
