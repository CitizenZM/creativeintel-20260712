/**
 * recordArtifact — the idempotent writer of the content-history archive.
 *
 * Every candidate fills a slot (sourceKey). Its value is identified by a fingerprint: the sha256 of the
 * URL for a file, else of the (key-order independent) JSON / text content or of the bytes. Recording a
 * value the slot already holds is a no-op; a new value becomes the slot's next version, so nothing a
 * producer overwrites is ever lost. Versions number per (projectId, sourceKey) — a slot belongs to one
 * kind — and a concurrent writer that took the same version is retried.
 *
 * Storage split: text / JSON values live in ProjectArtifact.content. Files stay in blob storage — the row
 * holds the URL, size, sha256 and content type — and files up to ARTIFACT_BLOB_MAX_BYTES (default 2 MB)
 * also keep their bytes in ArtifactBlob, so images, SRTs, small JSON and DOCX reports survive the loss of
 * blob storage. Large videos are hashed while streaming (up to ARTIFACT_HASH_MAX_BYTES) but not copied.
 */
import { createHash } from "node:crypto";
import type { ArtifactCandidate } from "./collect";

export interface ArtifactConfig {
  /** Files up to this size also keep their bytes in the DB (ArtifactBlob). */
  blobMaxBytes: number;
  /** Files up to this size are streamed through sha256; larger ones keep only their size. */
  hashMaxBytes: number;
}

const DEFAULT_BLOB_MAX = 2 * 1024 * 1024;
const DEFAULT_HASH_MAX = 200 * 1024 * 1024;

function positiveInt(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && v !== undefined && v !== "" ? Math.floor(n) : fallback;
}

export function artifactConfig(env: Record<string, string | undefined> = process.env): ArtifactConfig {
  return { blobMaxBytes: positiveInt(env.ARTIFACT_BLOB_MAX_BYTES, DEFAULT_BLOB_MAX), hashMaxBytes: positiveInt(env.ARTIFACT_HASH_MAX_BYTES, DEFAULT_HASH_MAX) };
}

// ─── Fingerprints ────────────────────────────────────────────────────────────

/** JSON with sorted object keys: equal values give equal strings whatever order they were built in. */
export function stableStringify(v: unknown): string {
  if (v === undefined) return "null";
  if (v === null || typeof v !== "object") return JSON.stringify(v instanceof Date ? v.toISOString() : v) ?? "null";
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(",")}}`;
}

export const sha256Hex = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");

export function fingerprintOf(c: ArtifactCandidate): string {
  if (c.dedupeValue !== undefined) return sha256Hex(`value\n${stableStringify(c.dedupeValue)}`);
  if (c.url) return sha256Hex(`url\n${c.url}`);
  if (c.data) return sha256Hex(c.data);
  return sha256Hex(`json\n${stableStringify(c.content ?? null)}`);
}

// ─── Store ───────────────────────────────────────────────────────────────────

export interface ArtifactRow {
  id: string;
  projectId: string;
  kind: string;
  title: string;
  runId: string | null;
  jobId: string | null;
  storyboardId: string | null;
  sourceField: string;
  sourceKey: string;
  version: number;
  fingerprint: string;
  url: string | null;
  contentType: string | null;
  bytes: number | null;
  sha256: string | null;
  content: unknown;
  meta: Record<string, unknown> | null;
  producedAt: Date | null;
  createdAt: Date;
}

export type NewArtifactRow = Omit<ArtifactRow, "id" | "createdAt"> & { createdAt?: Date };

export interface SlotVersion {
  id: string;
  version: number;
  sha256: string | null;
  bytes: number | null;
  hasBlob: boolean;
  createdAt: Date;
}

export interface SlotState {
  maxVersion: number;
  latestAt: Date | null;
  byFingerprint: Map<string, SlotVersion>;
}

/** Thrown by a store when (projectId, sourceKey, version | fingerprint) is already taken. */
export class SlotConflictError extends Error {
  constructor(message = "artifact slot conflict") {
    super(message);
    this.name = "SlotConflictError";
  }
}

export interface ArtifactStore {
  /** The current state of these slots. */
  slots(projectId: string, sourceKeys: string[]): Promise<Map<string, SlotState>>;
  /** Insert a version (and its bytes). Throws SlotConflictError when the version / value is taken. */
  create(row: NewArtifactRow, blob: Uint8Array | null): Promise<{ id: string }>;
  /** Add what a later download learned to an existing version. */
  enrich(id: string, patch: { sha256?: string | null; bytes?: number | null; contentType?: string | null; meta?: Record<string, unknown> | null }, blob: Uint8Array | null): Promise<void>;
}

/** In-memory store: tests, and the backfill's dry run (which must not touch the DB). */
export class MemoryArtifactStore implements ArtifactStore {
  rows: ArtifactRow[] = [];
  blobs = new Map<string, Uint8Array>();
  private seq = 0;

  async slots(projectId: string, sourceKeys: string[]): Promise<Map<string, SlotState>> {
    const keys = new Set(sourceKeys);
    const out = new Map<string, SlotState>();
    for (const r of this.rows) {
      if (r.projectId !== projectId || !keys.has(r.sourceKey)) continue;
      const s = out.get(r.sourceKey) ?? { maxVersion: 0, latestAt: null, byFingerprint: new Map() };
      s.maxVersion = Math.max(s.maxVersion, r.version);
      if (!s.latestAt || r.createdAt > s.latestAt) s.latestAt = r.createdAt;
      s.byFingerprint.set(r.fingerprint, { id: r.id, version: r.version, sha256: r.sha256, bytes: r.bytes, hasBlob: this.blobs.has(r.id), createdAt: r.createdAt });
      out.set(r.sourceKey, s);
    }
    return out;
  }

  async create(row: NewArtifactRow, blob: Uint8Array | null): Promise<{ id: string }> {
    const taken = this.rows.some((r) => r.projectId === row.projectId && r.sourceKey === row.sourceKey && (r.version === row.version || r.fingerprint === row.fingerprint));
    if (taken) throw new SlotConflictError();
    const id = `art${++this.seq}`;
    this.rows.push({ ...row, id, createdAt: row.createdAt ?? new Date() });
    if (blob) this.blobs.set(id, blob);
    return { id };
  }

  async enrich(id: string, patch: Parameters<ArtifactStore["enrich"]>[1], blob: Uint8Array | null): Promise<void> {
    const r = this.rows.find((x) => x.id === id);
    if (!r) return;
    Object.assign(r, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
    if (blob) this.blobs.set(id, blob);
  }
}

// ─── Files ───────────────────────────────────────────────────────────────────

export interface FetchedFile {
  ok: boolean;
  status: number;
  contentType?: string;
  /** Size from the body (or Content-Length when not read to the end). */
  bytes?: number;
  /** sha256 of the whole body; absent when the file was larger than hashMaxBytes. */
  sha256?: string;
  /** The body, when it was at most keepMaxBytes. */
  data?: Uint8Array;
  truncated?: boolean;
  error?: string;
}

export type FileFetcher = (url: string, opts: { keepMaxBytes: number; hashMaxBytes: number }) => Promise<FetchedFile>;

/** Decode a data: URL (base64 or percent-encoded). */
export function decodeDataUrl(url: string): { contentType: string; data: Uint8Array } | null {
  const m = url.match(/^data:([^;,]*)((?:;[^;,]*)*),([\s\S]*)$/);
  if (!m) return null;
  const base64 = /;base64/i.test(m[2]);
  const data = base64 ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]), "utf8");
  return { contentType: m[1] || "application/octet-stream", data: new Uint8Array(data) };
}

/**
 * GET a stored file once, streaming: sha256 over the whole body (up to hashMaxBytes, then the download is
 * cancelled), the bytes kept only while they fit keepMaxBytes. SSRF-guarded like every other fetch.
 */
export const streamFetchFile: FileFetcher = async (url, { keepMaxBytes, hashMaxBytes }) => {
  const { assertSafeUrl } = await import("@/lib/safe-fetch");
  try {
    await assertSafeUrl(url);
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : "Unsafe URL" };
  }
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : "Request failed" };
  }
  const contentType = res.headers.get("content-type")?.split(";")[0].trim() || undefined;
  const declared = Number(res.headers.get("content-length")) || undefined;
  if (!res.ok || !res.body) {
    await res.body?.cancel().catch(() => undefined);
    return { ok: false, status: res.status, error: `HTTP ${res.status}` };
  }
  if (declared !== undefined && declared > hashMaxBytes) {
    await res.body.cancel().catch(() => undefined);
    return { ok: true, status: res.status, contentType, bytes: declared, truncated: true };
  }
  const hash = createHash("sha256");
  const kept: Uint8Array[] = [];
  let total = 0;
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > hashMaxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: true, status: res.status, contentType, bytes: declared ?? total, truncated: true };
      }
      hash.update(value);
      if (total <= keepMaxBytes) kept.push(value);
    }
  } catch (err) {
    return { ok: false, status: res.status, error: err instanceof Error ? err.message : "Download failed" };
  }
  return { ok: true, status: res.status, contentType, bytes: total, sha256: hash.digest("hex"), data: total <= keepMaxBytes ? Buffer.concat(kept) : undefined };
};

// ─── Recording ───────────────────────────────────────────────────────────────

export interface RecordOptions {
  /** Download files for sha256 / size / bytes; null = record the URL only (fast pre-replace archive). */
  fetch?: FileFetcher | null;
  blobMaxBytes?: number;
  hashMaxBytes?: number;
  /** Compute what would be written; write and download nothing. */
  dryRun?: boolean;
  now?: () => Date;
}

export type RecordAction = "created" | "exists" | "enriched" | "would-create" | "throttled" | "failed";

export interface RecordItem {
  sourceKey: string;
  kind: string;
  title: string;
  url: string | null;
  action: RecordAction;
  version?: number;
  bytes?: number | null;
  error?: string;
}

export interface RecordResult {
  created: number;
  exists: number;
  enriched: number;
  wouldCreate: number;
  failed: number;
  items: RecordItem[];
}

const GENERIC_TYPES = new Set(["application/octet-stream", "binary/octet-stream", ""]);

function contentBytes(c: ArtifactCandidate): Uint8Array | null {
  if (c.content === undefined || c.content === null) return null;
  return new TextEncoder().encode(typeof c.content === "string" ? c.content : JSON.stringify(c.content));
}

interface FileFacts {
  url: string | null;
  contentType: string | null;
  bytes: number | null;
  sha256: string | null;
  blob: Uint8Array | null;
  fetchError?: string;
}

async function fileFacts(c: ArtifactCandidate, cfg: ArtifactConfig, fetch: FileFetcher | null): Promise<FileFacts> {
  const facts: FileFacts = { url: c.url ?? null, contentType: c.contentType ?? null, bytes: null, sha256: null, blob: null };
  const keep = (data: Uint8Array) => (data.length <= cfg.blobMaxBytes ? data : null);
  if (c.data) return { ...facts, bytes: c.data.length, sha256: sha256Hex(c.data), blob: keep(c.data) };
  if (!c.url) {
    const b = contentBytes(c);
    return { ...facts, contentType: c.contentType ?? (typeof c.content === "string" ? "text/plain" : "application/json"), bytes: b?.length ?? null, sha256: b ? sha256Hex(b) : null };
  }
  if (c.url.startsWith("data:")) {
    const d = decodeDataUrl(c.url);
    if (!d) return facts;
    const blob = keep(d.data);
    // Bytes in ArtifactBlob make the inline URL redundant; a too-large one keeps its URL.
    return { url: blob ? null : c.url, contentType: c.contentType ?? d.contentType, bytes: d.data.length, sha256: sha256Hex(d.data), blob };
  }
  if (!fetch) return facts;
  const f = await fetch(c.url, { keepMaxBytes: cfg.blobMaxBytes, hashMaxBytes: cfg.hashMaxBytes });
  if (!f.ok) return { ...facts, fetchError: f.error ?? `HTTP ${f.status}` };
  const sniffed = f.contentType && !GENERIC_TYPES.has(f.contentType) ? f.contentType : null;
  return { ...facts, contentType: facts.contentType ?? sniffed, bytes: f.bytes ?? null, sha256: f.sha256 ?? null, blob: f.data ? keep(f.data) : null };
}

const toDate = (d: Date | string | null | undefined): Date | null => {
  if (!d) return null;
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? null : x;
};

/** Record candidates of one project in order (a slot's versions number in candidate order). */
export async function recordArtifacts(store: ArtifactStore, projectId: string, candidates: ArtifactCandidate[], opts: RecordOptions = {}): Promise<RecordResult> {
  const env = artifactConfig();
  const cfg: ArtifactConfig = { blobMaxBytes: opts.blobMaxBytes ?? env.blobMaxBytes, hashMaxBytes: opts.hashMaxBytes ?? env.hashMaxBytes };
  const fetch = opts.dryRun ? null : (opts.fetch ?? null);
  const now = opts.now ?? (() => new Date());
  const result: RecordResult = { created: 0, exists: 0, enriched: 0, wouldCreate: 0, failed: 0, items: [] };
  if (!candidates.length) return result;
  let slots = await store.slots(projectId, [...new Set(candidates.map((c) => c.sourceKey))]);
  const slotOf = (key: string) => {
    let s = slots.get(key);
    if (!s) slots.set(key, (s = { maxVersion: 0, latestAt: null, byFingerprint: new Map() }));
    return s;
  };

  for (const c of candidates) {
    const fp = fingerprintOf(c);
    const item: RecordItem = { sourceKey: c.sourceKey, kind: c.kind, title: c.title, url: c.url ?? null, action: "exists" };
    result.items.push(item);
    try {
      for (let attempt = 0; ; attempt++) {
        const slot = slotOf(c.sourceKey);
        const existing = slot.byFingerprint.get(fp);
        if (existing) {
          item.version = existing.version;
          // First recorded without a download (dry / pre-replace / failed fetch): complete it now.
          if (fetch && c.url && !c.url.startsWith("data:") && existing.sha256 === null && existing.bytes === null) {
            const f = await fileFacts(c, cfg, fetch);
            if (f.bytes !== null || f.sha256 !== null) {
              await store.enrich(existing.id, { sha256: f.sha256, bytes: f.bytes, contentType: f.contentType }, existing.hasBlob ? null : f.blob);
              Object.assign(existing, { sha256: f.sha256, bytes: f.bytes, hasBlob: existing.hasBlob || !!f.blob });
              item.action = "enriched";
              item.bytes = f.bytes;
              result.enriched++;
              break;
            }
          }
          item.action = "exists";
          result.exists++;
          break;
        }
        if (c.minIntervalMs && slot.latestAt && now().getTime() - slot.latestAt.getTime() < c.minIntervalMs) {
          item.action = "throttled";
          break;
        }
        const version = slot.maxVersion + 1;
        item.version = version;
        if (opts.dryRun) {
          slot.maxVersion = version;
          slot.byFingerprint.set(fp, { id: "", version, sha256: null, bytes: null, hasBlob: false, createdAt: now() });
          item.action = "would-create";
          result.wouldCreate++;
          break;
        }
        const f = await fileFacts(c, cfg, fetch);
        const row: NewArtifactRow = {
          projectId,
          kind: c.kind,
          title: c.title.slice(0, 300),
          runId: c.runId ?? null,
          jobId: c.jobId ?? null,
          storyboardId: c.storyboardId ?? null,
          sourceField: c.sourceField.slice(0, 300),
          sourceKey: c.sourceKey,
          version,
          fingerprint: fp,
          url: f.url,
          contentType: f.contentType,
          bytes: f.bytes,
          sha256: f.sha256,
          content: c.content === undefined ? null : c.content,
          meta: c.meta || f.fetchError ? { ...(c.meta ?? {}), ...(f.fetchError ? { fetchError: f.fetchError } : {}) } : null,
          producedAt: toDate(c.producedAt),
          createdAt: now(),
        };
        try {
          const { id } = await store.create(row, f.blob);
          slot.maxVersion = version;
          slot.latestAt = row.createdAt ?? now();
          slot.byFingerprint.set(fp, { id, version, sha256: f.sha256, bytes: f.bytes, hasBlob: !!f.blob, createdAt: row.createdAt ?? now() });
          item.action = "created";
          item.bytes = f.bytes;
          result.created++;
          break;
        } catch (err) {
          if (!(err instanceof SlotConflictError) || attempt >= 2) throw err;
          // Another writer filled this slot meanwhile: re-read it and try again.
          const fresh = await store.slots(projectId, [c.sourceKey]);
          slots = new Map([...slots, ...fresh]);
          if (!fresh.has(c.sourceKey)) slots.delete(c.sourceKey);
        }
      }
    } catch (err) {
      item.action = "failed";
      item.error = err instanceof Error ? err.message : String(err);
      result.failed++;
    }
  }
  return result;
}

export async function recordArtifact(store: ArtifactStore, projectId: string, candidate: ArtifactCandidate, opts: RecordOptions = {}): Promise<RecordItem> {
  return (await recordArtifacts(store, projectId, [candidate], opts)).items[0];
}
