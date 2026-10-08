/**
 * Serving the content-history archive: list filters, single downloads (stored bytes → stored content →
 * proxied blob URL) and the "download all" ZIP (streamed, STORE, manifest.json last so it records what
 * actually made it into the archive). Pure apart from the injected openers, so routes stay thin.
 */
import { artifactFileName, isArtifactKind, safeFileName, type ArtifactKind } from "./kinds";
import { decodeDataUrl } from "./record";
import type { StreamZipEntry } from "@/lib/zip-stream";

export interface ArtifactListFilters {
  kinds: ArtifactKind[];
  runId?: string;
  sourceKey?: string;
  q?: string;
  /** Only the newest version of each slot. */
  latest: boolean;
  limit: number;
}

export function parseListFilters(sp: URLSearchParams): ArtifactListFilters {
  const kinds = (sp.get("kind") ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(isArtifactKind);
  const limit = Math.min(Math.max(Number(sp.get("limit")) || 500, 1), 2000);
  return {
    kinds,
    runId: sp.get("runId") || undefined,
    sourceKey: sp.get("sourceKey") || undefined,
    q: sp.get("q")?.trim() || undefined,
    latest: sp.get("latest") === "1" || sp.get("latest") === "true",
    limit,
  };
}

/** Prisma `where` for the filters. */
export function listWhere(projectId: string, f: ArtifactListFilters) {
  return {
    projectId,
    ...(f.kinds.length ? { kind: { in: f.kinds } } : {}),
    ...(f.runId ? { runId: f.runId } : {}),
    ...(f.sourceKey ? { sourceKey: f.sourceKey } : {}),
    ...(f.q ? { title: { contains: f.q, mode: "insensitive" as const } } : {}),
  };
}

/** Keep only the newest version of each slot. */
export function latestOnly<T extends { sourceKey: string; version: number }>(rows: T[]): T[] {
  const best = new Map<string, T>();
  for (const r of rows) {
    const b = best.get(r.sourceKey);
    if (!b || r.version > b.version) best.set(r.sourceKey, r);
  }
  return rows.filter((r) => best.get(r.sourceKey) === r);
}

/** attachment / inline with an ASCII fallback and the RFC 5987 UTF-8 name. */
export function contentDisposition(filename: string, inline = false): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export interface ServableArtifact {
  id: string;
  kind: string;
  title: string;
  version: number;
  sourceKey: string;
  sourceField: string;
  url: string | null;
  contentType: string | null;
  bytes: number | null;
  sha256: string | null;
  content: unknown;
  createdAt: Date;
  producedAt?: Date | null;
  hasBlob: boolean;
}

export type DownloadPlan =
  | { source: "blob"; filename: string; contentType: string }
  | { source: "content"; filename: string; contentType: string; body: string }
  | { source: "data-url"; filename: string; contentType: string; body: Uint8Array }
  | { source: "proxy"; filename: string; contentType: string | null; url: string }
  | { source: "none"; filename: string };

function contentBody(a: ServableArtifact): { body: string; contentType: string; json: boolean } {
  if (typeof a.content === "string") {
    const html = (a.contentType ?? "").includes("html");
    return { body: a.content, contentType: html ? "text/html; charset=utf-8" : `${a.contentType || "text/plain"}; charset=utf-8`, json: false };
  }
  return { body: JSON.stringify(a.content, null, 2), contentType: "application/json; charset=utf-8", json: true };
}

/** How to serve one artifact: its stored bytes, its stored JSON / text, a data: URL, or its blob URL. */
export function downloadPlan(a: ServableArtifact): DownloadPlan {
  const name = (json: boolean) => artifactFileName({ kind: a.kind, title: a.title, version: a.version, contentType: a.contentType, url: a.url, json });
  if (a.hasBlob) return { source: "blob", filename: name(false), contentType: a.contentType || "application/octet-stream" };
  if (a.content !== null && a.content !== undefined) {
    const c = contentBody(a);
    return { source: "content", filename: c.json ? name(true) : name(false), contentType: c.contentType, body: c.body };
  }
  if (a.url?.startsWith("data:")) {
    const d = decodeDataUrl(a.url);
    if (d) return { source: "data-url", filename: name(false), contentType: a.contentType || d.contentType, body: d.data };
  }
  if (a.url && /^https?:\/\//i.test(a.url)) return { source: "proxy", filename: name(false), contentType: a.contentType, url: a.url };
  return { source: "none", filename: name(false) };
}

export interface ArchiveDeps {
  /** The stored bytes of an artifact (ArtifactBlob), fetched when its entry is written. */
  blobOf(id: string): Promise<Uint8Array | null>;
  /** A stored file's body from its URL (SSRF-guarded), or null when it cannot be fetched. */
  openUrl(url: string): Promise<ReadableStream<Uint8Array> | null>;
}

export interface ManifestEntry {
  id: string;
  kind: string;
  title: string;
  version: number;
  sourceKey: string;
  sourceField: string;
  url: string | null;
  contentType: string | null;
  bytes: number | null;
  sha256: string | null;
  producedAt: string | null;
  archivedAt: string;
  /** Path inside the ZIP; null when the file is not in it (see note). */
  path: string | null;
  note?: string;
}

/**
 * ZIP entries for "download all": each artifact under <kind>/<file>, then manifest.json listing every
 * artifact with its path in the archive (or why it is not in it). Files whose recorded size would push
 * the archive past `maxBytes` are listed with their URL only.
 */
export function archiveEntries(project: { id: string; name: string }, rows: ServableArtifact[], deps: ArchiveDeps, opts: { maxBytes?: number; now?: Date } = {}): AsyncIterable<StreamZipEntry> {
  const maxBytes = opts.maxBytes ?? 1.5 * 1024 ** 3;
  const now = opts.now ?? new Date();
  return (async function* () {
    const manifest: ManifestEntry[] = [];
    const used = new Set<string>();
    let total = 0;
    for (const a of rows) {
      const plan = downloadPlan(a);
      let path = `${safeFileName(a.kind, 40)}/${plan.filename}`;
      if (used.has(path)) path = path.replace(/(\.[^./]+)?$/, (ext) => `-${a.id.slice(-6)}${ext}`);
      const m: ManifestEntry = { id: a.id, kind: a.kind, title: a.title, version: a.version, sourceKey: a.sourceKey, sourceField: a.sourceField, url: a.url?.startsWith("data:") ? "(inline data URL)" : a.url, contentType: a.contentType, bytes: a.bytes, sha256: a.sha256, producedAt: a.producedAt ? a.producedAt.toISOString() : null, archivedAt: a.createdAt.toISOString(), path: null };
      manifest.push(m);
      const date = a.producedAt ?? a.createdAt;
      if (plan.source === "none") {
        m.note = "no stored bytes, content or URL";
        continue;
      }
      if (plan.source === "proxy" && a.bytes && total + a.bytes > maxBytes) {
        m.note = `not included: the archive is capped at ${Math.round(maxBytes / 1024 ** 2)} MB — download it on its own`;
        continue;
      }
      used.add(path);
      if (plan.source === "content") {
        total += Buffer.byteLength(plan.body);
        m.path = path;
        yield { name: path, data: plan.body, date };
      } else if (plan.source === "data-url") {
        total += plan.body.length;
        m.path = path;
        yield { name: path, data: plan.body, date };
      } else {
        let opened = false;
        const entryName = path;
        yield {
          name: entryName,
          date,
          data: async () => {
            const body = plan.source === "blob" ? await deps.blobOf(a.id).then((b) => (b ? singleChunk(b) : a.url && /^https?:/i.test(a.url) ? deps.openUrl(a.url) : null)) : await deps.openUrl(plan.url);
            opened = !!body;
            return body;
          },
        };
        if (opened) {
          m.path = entryName;
          total += a.bytes ?? 0;
        } else {
          used.delete(entryName);
          m.note = "file could not be fetched (missing or broken URL)";
        }
      }
    }
    yield { name: "manifest.json", data: JSON.stringify({ project, generatedAt: now.toISOString(), count: manifest.length, artifacts: manifest }, null, 2), date: now };
  })();
}

function singleChunk(b: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      c.enqueue(b);
      c.close();
    },
  });
}

/** Open a stored file's URL for streaming (SSRF-guarded); null on any failure. */
export async function openStoredUrl(url: string): Promise<ReadableStream<Uint8Array> | null> {
  const { assertSafeUrl } = await import("@/lib/safe-fetch");
  try {
    await assertSafeUrl(url);
    const res = await fetch(url, { signal: AbortSignal.timeout(300_000) });
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    return res.body;
  } catch {
    return null;
  }
}

/** Columns of a listed artifact (no content, no bytes — those come from the download route). */
export const LIST_SELECT = {
  id: true,
  projectId: true,
  kind: true,
  title: true,
  runId: true,
  jobId: true,
  storyboardId: true,
  sourceField: true,
  sourceKey: true,
  version: true,
  url: true,
  contentType: true,
  bytes: true,
  sha256: true,
  meta: true,
  producedAt: true,
  createdAt: true,
  blob: { select: { artifactId: true } },
} as const;

export interface ArtifactListItem {
  id: string;
  kind: string;
  title: string;
  runId: string | null;
  jobId: string | null;
  storyboardId: string | null;
  sourceField: string;
  sourceKey: string;
  version: number;
  url: string | null;
  contentType: string | null;
  bytes: number | null;
  sha256: string | null;
  meta: unknown;
  producedAt: string | null;
  createdAt: string;
  hasBlob: boolean;
  /** A text / JSON document (stored in the DB) rather than a file. */
  isDocument: boolean;
  downloadUrl: string;
}

export function toListItem(projectId: string, r: { id: string; kind: string; title: string; runId: string | null; jobId: string | null; storyboardId: string | null; sourceField: string; sourceKey: string; version: number; url: string | null; contentType: string | null; bytes: number | null; sha256: string | null; meta: unknown; producedAt: Date | null; createdAt: Date; blob: { artifactId: string } | null }): ArtifactListItem {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    runId: r.runId,
    jobId: r.jobId,
    storyboardId: r.storyboardId,
    sourceField: r.sourceField,
    sourceKey: r.sourceKey,
    version: r.version,
    // A data: URL can be megabytes: the download route serves it.
    url: r.url?.startsWith("data:") ? null : r.url,
    contentType: r.contentType,
    bytes: r.bytes,
    sha256: r.sha256,
    meta: r.meta,
    producedAt: r.producedAt ? r.producedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    hasBlob: !!r.blob,
    isDocument: !r.url && !r.blob,
    downloadUrl: `/api/projects/${projectId}/artifacts/${r.id}/download`,
  };
}
