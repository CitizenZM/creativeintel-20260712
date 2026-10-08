/**
 * Backfill of the content-history archive: walk every project (or one), collect everything it already
 * produced (services/artifacts/collect.ts — including old masters kept in qcReport.autofix, variants and
 * exports) and record it. Dry run by default: nothing is written or downloaded, the result says what would
 * be archived. A real run downloads each new file once (rate-limited) for its size, sha256 and — up to
 * ARTIFACT_BLOB_MAX_BYTES — its bytes.
 *
 * Resumable: projects go in id order and the result carries `nextCursor` (the last project done) when it
 * stopped at its project / time budget; pass it back as `after`. Re-running is safe anyway — recording is
 * idempotent. `headSample` HEAD-checks up to that many file URLs over the whole run (review mode: broken
 * links and measured sizes).
 */
import { collectSnapshot, type ProjectSnapshot } from "./collect";
import { recordArtifacts, type ArtifactStore, type FileFetcher } from "./record";

export interface HeadResult {
  ok: boolean;
  status: number;
  bytes?: number;
  contentType?: string;
  error?: string;
}

export interface BackfillDeps {
  /** Projects in id order after `after` (exclusive). */
  listProjects(after: string | null, limit: number): Promise<{ id: string; name: string }[]>;
  loadSnapshot(projectId: string): Promise<ProjectSnapshot | null>;
  store: ArtifactStore;
  fetch?: FileFetcher;
  head?: (url: string) => Promise<HeadResult>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface BackfillOptions {
  projectId?: string;
  all?: boolean;
  /** Default true. */
  dryRun?: boolean;
  /** Resume after this project id. */
  after?: string | null;
  /** Stop after this many projects (returns nextCursor). */
  maxProjects?: number;
  /** Stop starting new projects after this long (ms). */
  deadlineMs?: number;
  /** Minimum spacing between downloads / HEAD requests (ms, default 250). */
  downloadIntervalMs?: number;
  /** HEAD-check at most this many file URLs in total (default 0). */
  headSample?: number;
  /** …and at most this many per project (default 25). */
  headPerProject?: number;
  onProject?: (summary: ProjectBackfillSummary) => void | Promise<void>;
}

export interface BrokenUrl {
  url: string;
  kind: string;
  sourceField: string;
  status: number;
  error?: string;
}

export interface ProjectBackfillSummary {
  projectId: string;
  name: string;
  artifacts: number;
  byKind: Record<string, number>;
  files: number;
  documents: number;
  /** Bytes of the JSON / text documents (stored in the DB). */
  documentBytes: number;
  created: number;
  exists: number;
  enriched: number;
  wouldCreate: number;
  failed: number;
  headChecked: number;
  broken: BrokenUrl[];
  /** Sizes measured: HEAD Content-Length of the sample (dry run) or the downloads (real run). */
  bytesMeasured: number;
  filesMeasured: number;
  /** bytesMeasured extrapolated to every file of the project by kind (null when nothing was measured). */
  bytesEstimated: number | null;
  errors: string[];
}

export interface BackfillResult {
  dryRun: boolean;
  projects: ProjectBackfillSummary[];
  nextCursor: string | null;
  done: boolean;
  totals: { projects: number; artifacts: number; files: number; documents: number; documentBytes: number; created: number; exists: number; enriched: number; wouldCreate: number; failed: number; headChecked: number; broken: number; bytesMeasured: number; bytesEstimated: number };
}

/** Wrap an async function so successive calls start at least `intervalMs` apart. */
export function rateLimited<A extends unknown[], R>(fn: (...a: A) => Promise<R>, intervalMs: number, clock: { now?: () => number; sleep?: (ms: number) => Promise<void> } = {}): (...a: A) => Promise<R> {
  const now = clock.now ?? (() => Date.now());
  const sleep = clock.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let last: number | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  return (...a: A) => {
    const run = chain.then(async () => {
      if (last !== null) {
        const wait = last + intervalMs - now();
        if (wait > 0) await sleep(wait);
      }
      last = now();
      return fn(...a);
    });
    chain = run.catch(() => undefined);
    return run;
  };
}

/** Evenly spread pick of `n` items (keeps the first: slot files such as masters come first). */
function sample<T>(items: T[], n: number): T[] {
  if (n <= 0) return [];
  if (items.length <= n) return items;
  const out: T[] = [];
  const step = items.length / n;
  for (let i = 0; i < n; i++) out.push(items[Math.floor(i * step)]);
  return out;
}

const docBytes = (v: unknown) => (v === undefined || v === null ? 0 : Buffer.byteLength(typeof v === "string" ? v : JSON.stringify(v)));

export async function runBackfill(deps: BackfillDeps, opts: BackfillOptions): Promise<BackfillResult> {
  if (!opts.projectId && !opts.all) throw new Error("Pass projectId or all: true");
  const dryRun = opts.dryRun !== false;
  const started = (deps.now ?? Date.now)();
  const clock = { now: deps.now, sleep: deps.sleep };
  const interval = opts.downloadIntervalMs ?? 250;
  const fetch = !dryRun && deps.fetch ? rateLimited(deps.fetch, interval, clock) : null;
  const head = deps.head ? rateLimited(deps.head, interval, clock) : null;
  let headBudget = Math.max(0, opts.headSample ?? 0);
  const perProject = opts.headPerProject ?? 25;

  const result: BackfillResult = {
    dryRun,
    projects: [],
    nextCursor: null,
    done: true,
    totals: { projects: 0, artifacts: 0, files: 0, documents: 0, documentBytes: 0, created: 0, exists: 0, enriched: 0, wouldCreate: 0, failed: 0, headChecked: 0, broken: 0, bytesMeasured: 0, bytesEstimated: 0 },
  };

  const queue = opts.projectId ? [{ id: opts.projectId, name: opts.projectId }] : null;
  let cursor = opts.after ?? null;
  const max = opts.maxProjects ?? Infinity;

  for (;;) {
    const batch = queue ?? (await deps.listProjects(cursor, 50));
    if (!batch.length) break;
    for (const p of batch) {
      if (result.projects.length >= max || (opts.deadlineMs !== undefined && (deps.now ?? Date.now)() - started > opts.deadlineMs)) {
        result.done = false;
        result.nextCursor = cursor;
        return finish(result);
      }
      result.projects.push(await backfillProject(p, deps, { dryRun, fetch, head, perProject, takeHead: (n) => { const k = Math.min(n, headBudget); headBudget -= k; return k; } }));
      await opts.onProject?.(result.projects[result.projects.length - 1]);
      cursor = p.id;
    }
    if (queue) break;
  }
  return finish(result);
}

function finish(r: BackfillResult): BackfillResult {
  for (const p of r.projects) {
    const t = r.totals;
    t.projects++;
    t.artifacts += p.artifacts;
    t.files += p.files;
    t.documents += p.documents;
    t.documentBytes += p.documentBytes;
    t.created += p.created;
    t.exists += p.exists;
    t.enriched += p.enriched;
    t.wouldCreate += p.wouldCreate;
    t.failed += p.failed;
    t.headChecked += p.headChecked;
    t.broken += p.broken.length;
    t.bytesMeasured += p.bytesMeasured;
    t.bytesEstimated += p.bytesEstimated ?? 0;
  }
  return r;
}

async function backfillProject(
  p: { id: string; name: string },
  deps: BackfillDeps,
  ctx: { dryRun: boolean; fetch: FileFetcher | null; head: ((url: string) => Promise<HeadResult>) | null; perProject: number; takeHead: (n: number) => number }
): Promise<ProjectBackfillSummary> {
  const s: ProjectBackfillSummary = { projectId: p.id, name: p.name, artifacts: 0, byKind: {}, files: 0, documents: 0, documentBytes: 0, created: 0, exists: 0, enriched: 0, wouldCreate: 0, failed: 0, headChecked: 0, broken: [], bytesMeasured: 0, filesMeasured: 0, bytesEstimated: null, errors: [] };
  let snap: ProjectSnapshot | null;
  try {
    snap = await deps.loadSnapshot(p.id);
  } catch (err) {
    s.errors.push(`load: ${err instanceof Error ? err.message : String(err)}`);
    return s;
  }
  if (!snap) {
    s.errors.push("project not found");
    return s;
  }
  s.name = snap.project.name || snap.project.brandName || p.name;
  const cands = collectSnapshot(snap);
  s.artifacts = cands.length;
  for (const c of cands) {
    s.byKind[c.kind] = (s.byKind[c.kind] ?? 0) + 1;
    if (c.url) s.files++;
    else {
      s.documents++;
      s.documentBytes += docBytes(c.content);
    }
  }

  const res = await recordArtifacts(deps.store, p.id, cands, { dryRun: ctx.dryRun, fetch: ctx.fetch });
  s.created = res.created;
  s.exists = res.exists;
  s.enriched = res.enriched;
  s.wouldCreate = res.wouldCreate;
  s.failed = res.failed;
  for (const i of res.items) if (i.action === "failed" && i.error) s.errors.push(`${i.sourceKey}: ${i.error}`);

  // Sizes by kind, for the estimate.
  const measured = new Map<string, { n: number; bytes: number }>();
  const note = (kind: string, bytes: number | null | undefined) => {
    if (typeof bytes !== "number") return;
    const m = measured.get(kind) ?? { n: 0, bytes: 0 };
    m.n++;
    m.bytes += bytes;
    measured.set(kind, m);
    s.bytesMeasured += bytes;
    s.filesMeasured++;
  };
  if (!ctx.dryRun) for (const i of res.items) if (i.url && (i.action === "created" || i.action === "enriched")) note(i.kind, i.bytes);

  const httpFiles = cands.filter((c) => c.url && /^https?:/i.test(c.url));
  if (ctx.head && httpFiles.length) {
    const n = ctx.takeHead(Math.min(ctx.perProject, httpFiles.length));
    for (const c of sample(httpFiles, n)) {
      s.headChecked++;
      let h: HeadResult;
      try {
        h = await ctx.head(c.url!);
      } catch (err) {
        h = { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
      }
      if (!h.ok) s.broken.push({ url: c.url!, kind: c.kind, sourceField: c.sourceField, status: h.status, ...(h.error ? { error: h.error } : {}) });
      else if (ctx.dryRun) note(c.kind, h.bytes);
    }
  }

  if (s.filesMeasured) {
    const all = s.filesMeasured ? s.bytesMeasured / s.filesMeasured : 0;
    let est = 0;
    for (const c of cands) if (c.url) {
      const m = measured.get(c.kind);
      est += m && m.n ? m.bytes / m.n : all;
    }
    s.bytesEstimated = Math.round(est);
  }
  return s;
}

/** HEAD a file; hosts that refuse HEAD get a one-byte ranged GET. */
export async function headFile(url: string): Promise<HeadResult> {
  const { assertSafeUrl } = await import("@/lib/safe-fetch");
  try {
    await assertSafeUrl(url);
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : "Unsafe URL" };
  }
  try {
    let res = await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(20_000) });
    if (res.status === 405 || res.status === 403 || res.status === 501) {
      res = await fetch(url, { headers: { Range: "bytes=0-0" }, redirect: "follow", signal: AbortSignal.timeout(20_000) });
      await res.body?.cancel().catch(() => undefined);
      const total = res.headers.get("content-range")?.split("/")[1];
      return { ok: res.ok, status: res.status, bytes: total && total !== "*" ? Number(total) : undefined, contentType: res.headers.get("content-type") ?? undefined };
    }
    const len = Number(res.headers.get("content-length"));
    return { ok: res.ok, status: res.status, bytes: Number.isFinite(len) && len > 0 ? len : undefined, contentType: res.headers.get("content-type") ?? undefined };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : "Request failed" };
  }
}
