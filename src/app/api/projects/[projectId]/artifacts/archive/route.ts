/**
 * GET — "download all": every archived artifact of the project as one ZIP (STORE, streamed entry by
 * entry — src/lib/zip-stream.ts) under <kind>/<kind-title-vN.ext>, with manifest.json listing each
 * artifact, its sha256 and where it is in the archive (or why it is not). Same filters as the list
 * (?kind= &runId= &latest=1). Files past ARTIFACT_ZIP_MAX_BYTES (default 1.5 GB) are listed, not zipped.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { zipStream } from "@/lib/zip-stream";
import { safeFileName } from "@/services/artifacts/kinds";
import { archiveEntries, contentDisposition, latestOnly, listWhere, openStoredUrl, parseListFilters } from "@/services/artifacts/serve";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const f = parseListFilters(new URL(request.url).searchParams);
  const [project, rows] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true, brandName: true } }),
    prisma.projectArtifact.findMany({
      where: listWhere(projectId, f),
      orderBy: [{ kind: "asc" }, { sourceKey: "asc" }, { version: "asc" }],
      include: { blob: { select: { artifactId: true } } },
    }),
  ]);
  if (!rows.length) return NextResponse.json({ error: "Nothing archived for this project yet" }, { status: 404 });
  const name = project?.name || project?.brandName || projectId;
  const maxBytes = Number(process.env.ARTIFACT_ZIP_MAX_BYTES) || undefined;
  const entries = archiveEntries(
    { id: projectId, name },
    (f.latest ? latestOnly(rows) : rows).map((r) => ({ ...r, hasBlob: !!r.blob })),
    {
      async blobOf(id) {
        const b = await prisma.artifactBlob.findUnique({ where: { artifactId: id } });
        return b ? new Uint8Array(b.data) : null;
      },
      openUrl: openStoredUrl,
    },
    { maxBytes }
  );
  const filename = `${safeFileName(name, 60)}-history-${new Date().toISOString().slice(0, 10)}.zip`;
  return new Response(zipStream(entries), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": contentDisposition(filename), "Cache-Control": "no-store" },
  });
}
