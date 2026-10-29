/** Run with a dedicated DB credential and Blob tokens. Defaults to read-only.
 * pnpm exec tsx scripts/migrate-media-storage.ts --apply
 * Uploads are verified before database bytes are removed. Resumable in ID order. */
import { prisma } from "../src/lib/db";
import { Prisma } from "../src/generated/prisma/client";
import { sqlTable } from "../src/lib/sql-table";
import { digestBytes, durablePreviewUrl, uploadArchive } from "../src/services/storage/durable";
import { decodeDataUrl } from "../src/services/artifacts/record";

const apply = process.argv.includes("--apply");
const batchArg = process.argv.find((x) => x.startsWith("--batch="));
const batch = Math.min(100, Math.max(1, Number(batchArg?.split("=")[1]) || 20));

async function main() {
  const counts = {
    archiveByteRows: await prisma.artifactBlob.count(),
    inlinePreviews: await prisma.previewAsset.count({ where: { imageUrl: { startsWith: "data:" } } }),
    inlineArtifacts: await prisma.projectArtifact.count({ where: { url: { startsWith: "data:" } } }),
  };
  console.log({ mode: apply ? "apply" : "dry-run", ...counts });
  if (!apply) return;
  if (!process.env.ARCHIVE_BLOB_READ_WRITE_TOKEN || !process.env.BLOB_READ_WRITE_TOKEN) throw new Error("Private archive and public preview Blob credentials are required");

  let cursor: string | undefined;
  while (true) {
    const rows = await prisma.artifactBlob.findMany({
      where: cursor ? { artifactId: { gt: cursor } } : {}, orderBy: { artifactId: "asc" }, take: batch,
      include: { artifact: { select: { contentType: true } } },
    });
    if (!rows.length) break;
    for (const row of rows) {
      const sha256 = digestBytes(row.data);
      const archiveBlobUrl = await uploadArchive(row.data, row.artifact.contentType || "application/octet-stream");
      await prisma.$transaction(async (tx) => {
        // Lock the source so a concurrent writer cannot change it between
        // verification and removal. Names are schema-qualified, values bound.
        await tx.$queryRaw(Prisma.sql`SELECT "artifactId" FROM ${sqlTable("ArtifactBlob")} WHERE "artifactId" = ${row.artifactId} FOR UPDATE`);
        const current = await tx.artifactBlob.findUnique({ where: { artifactId: row.artifactId } });
        if (!current || digestBytes(current.data) !== sha256) return;
        const artifact = await tx.projectArtifact.findUniqueOrThrow({ where: { id: row.artifactId }, select: { meta: true } });
        await tx.projectArtifact.update({ where: { id: row.artifactId }, data: { meta: { ...(artifact.meta as Record<string, never> | null), archiveBlobUrl, archiveSha256: sha256 } } });
        await tx.artifactBlob.delete({ where: { artifactId: row.artifactId } });
      });
      console.log({ archiveMigrated: row.artifactId, bytes: row.data.length });
    }
    cursor = rows.at(-1)!.artifactId;
  }
  cursor = undefined;
  while (true) {
    const rows: { id: string; url: string | null; meta: unknown; contentType: string | null }[] = await prisma.projectArtifact.findMany({
      where: { url: { startsWith: "data:" }, ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: "asc" }, take: batch, select: { id: true, url: true, meta: true, contentType: true },
    });
    if (!rows.length) break;
    for (const row of rows) {
      const decoded = decodeDataUrl(row.url!);
      if (!decoded) throw new Error(`Invalid inline artifact ${row.id}`);
      const archiveBlobUrl = await uploadArchive(decoded.data, row.contentType || decoded.contentType);
      const result = await prisma.projectArtifact.updateMany({
        where: { id: row.id, url: row.url },
        data: { url: null, meta: { ...(row.meta as Record<string, never> | null), archiveBlobUrl } },
      });
      console.log({ inlineArtifactMigrated: row.id, updated: result.count });
    }
    cursor = rows.at(-1)!.id;
  }
  cursor = undefined;
  while (true) {
    const rows: { id: string; imageUrl: string | null }[] = await prisma.previewAsset.findMany({
      where: { imageUrl: { startsWith: "data:" }, ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: "asc" }, take: batch, select: { id: true, imageUrl: true },
    });
    if (!rows.length) break;
    for (const row of rows) {
      const imageUrl = await durablePreviewUrl(row.imageUrl!);
      const result = await prisma.previewAsset.updateMany({ where: { id: row.id, imageUrl: row.imageUrl }, data: { imageUrl } });
      console.log({ previewMigrated: row.id, updated: result.count });
    }
    cursor = rows.at(-1)!.id;
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
