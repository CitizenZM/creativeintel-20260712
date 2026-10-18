import { createHash } from "node:crypto";
import { get, put } from "@vercel/blob";
import { decodeDataUrl } from "@/services/artifacts/record";

export const digestBytes = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Archive bytes stay private; never publish internal reports in a public media store. */
export async function uploadArchive(bytes: Uint8Array, contentType: string): Promise<string> {
  const token = process.env.ARCHIVE_BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("Private archive Blob storage is not configured");
  const sha256 = digestBytes(bytes);
  const blob = await put(`creativeintel/archive/${sha256}`, Buffer.from(bytes), {
    access: "private", token, contentType, addRandomSuffix: false, allowOverwrite: true,
    abortSignal: AbortSignal.timeout(30_000),
  });
  // Read back the actual bytes, rather than trusting an upload response or length.
  const stored = await get(blob.url, { access: "private", token, useCache: false, abortSignal: AbortSignal.timeout(30_000) });
  if (!stored || stored.statusCode !== 200) throw new Error("Archive upload verification failed");
  const readback = new Uint8Array(await new Response(stored.stream).arrayBuffer());
  if (readback.length !== bytes.length || digestBytes(readback) !== sha256) throw new Error("Archive checksum mismatch");
  return blob.url;
}

/** Generated preview images already use hosted public media URLs. Inline bytes
 * must be uploaded successfully before a URL is persisted; no data-URL fallback. */
export async function durablePreviewUrl(url: string): Promise<string> {
  if (!url.startsWith("data:")) return url;
  const decoded = decodeDataUrl(url);
  if (!decoded) throw new Error("Invalid inline preview");
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("Preview Blob storage is not configured");
  const sha256 = digestBytes(decoded.data);
  const blob = await put(`creativeintel/previews/${sha256}`, Buffer.from(decoded.data), {
    access: "public", token, contentType: decoded.contentType,
    addRandomSuffix: false, allowOverwrite: true, abortSignal: AbortSignal.timeout(30_000),
  });
  const response = await fetch(blob.url, { signal: AbortSignal.timeout(30_000), cache: "no-store" });
  if (!response.ok) throw new Error("Preview upload verification failed");
  const readback = new Uint8Array(await response.arrayBuffer());
  if (digestBytes(readback) !== sha256) throw new Error("Preview checksum mismatch");
  return blob.url;
}
