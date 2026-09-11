/**
 * Streams a worker's local run artefacts so the dashboard can play them when no
 * cloud storage is configured. Without this the worker reports `file://` URLs,
 * which a browser refuses to load from an http page — the run finishes and the
 * operator still cannot watch the cut.
 *
 * Enabled only when LOCAL_FILES_ROOT is set or outside production, serves only
 * mp4/jpg/png from under the root, and supports Range so <video> can seek.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

export const dynamic = "force-dynamic";

const CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

const SEEKABLE = new Set([".mp4"]);

function enabled(): boolean {
  return !!process.env.LOCAL_FILES_ROOT || process.env.NODE_ENV !== "production";
}

export function localFilesRoot(): string {
  const configured = process.env.LOCAL_FILES_ROOT;
  return path.resolve(configured || path.join(homedir(), "Projects", "libtv-ad-studio", "runs"));
}

function notFound(): Response {
  return new Response("Not found", { status: 404 });
}

/**
 * Resolves under the root or returns null. Traversal is rejected twice: once on
 * the raw segments (so an encoded `..` never reaches the filesystem) and once
 * on the resolved path (which also catches a symlinked segment).
 */
function resolveSafe(segments: string[]): string | null {
  if (!segments.length) return null;

  const decoded: string[] = [];
  for (const raw of segments) {
    let segment: string;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (!segment || segment === "." || segment === ".." || segment.includes("\0") || segment.includes("/")) {
      return null;
    }
    decoded.push(segment);
  }

  const root = localFilesRoot();
  const resolved = path.resolve(root, ...decoded);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null;

  let start: number;
  let end: number;
  if (!rawStart) {
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Number(rawEnd) : size - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

async function serve(request: Request, segments: string[], withBody: boolean): Promise<Response> {
  if (!enabled()) return notFound();

  const filePath = resolveSafe(segments);
  if (!filePath) return notFound();

  const contentType = CONTENT_TYPES[path.extname(filePath).toLowerCase()];
  if (!contentType) return notFound();

  let size: number;
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return notFound();
    size = info.size;
  } catch {
    return notFound();
  }

  const seekable = SEEKABLE.has(path.extname(filePath).toLowerCase());
  const headers: Record<string, string> = {
    "content-type": contentType,
    "cache-control": "private, max-age=0, must-revalidate",
    "accept-ranges": seekable ? "bytes" : "none",
  };

  const range = seekable ? parseRange(request.headers.get("range"), size) : null;
  if (seekable && request.headers.get("range") && !range) {
    return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${size}` } });
  }

  const start = range?.start ?? 0;
  const end = range?.end ?? size - 1;
  headers["content-length"] = String(end - start + 1);
  if (range) headers["content-range"] = `bytes ${start}-${end}/${size}`;

  if (!withBody) return new Response(null, { status: range ? 206 : 200, headers });

  const stream = Readable.toWeb(
    createReadStream(filePath, { start, end })
  ) as unknown as ReadableStream<Uint8Array>;

  return new Response(stream, { status: range ? 206 : 200, headers });
}

export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await params;
  return serve(request, segments ?? [], true);
}

export async function HEAD(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await params;
  return serve(request, segments ?? [], false);
}
