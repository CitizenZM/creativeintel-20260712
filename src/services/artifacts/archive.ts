/**
 * Live hooks of the content-history archive: producers call these right after (or, for a value about to
 * be overwritten, right before) they write. Each re-collects the row it touched (services/artifacts/
 * collect.ts) and records it idempotently, so a hook that fires twice, or for an unchanged value, adds
 * nothing. Archiving must never break a render: every entry point catches and logs.
 *
 *   archiveInBackground(label, fn)   after a write — runs past the response (waitUntil); never throws
 *   archiveBeforeReplace(label, fn)  before an overwrite — awaited, URL-only (no download), never throws
 *
 * Off with ARTIFACT_ARCHIVE=off; off under vitest unless ARTIFACT_ARCHIVE=on (unit tests mock the DB).
 */
import { waitUntil } from "@vercel/functions";
import { collectBrandAsset, collectCatalogRun, collectJob, collectProjectFields, collectReportDelivery, collectRun, collectScript, collectStoryboard, collectSnapshot, type ArtifactCandidate, type ProjectFieldsRow } from "./collect";
import { recordArtifacts, streamFetchFile, type RecordResult } from "./record";
import { JOB_SELECT, PROJECT_FIELDS_SELECT, PrismaArtifactStore, RUN_SELECT, loadProjectSnapshot } from "./prisma-store";

export function archivingEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const flag = (env.ARTIFACT_ARCHIVE ?? "").toLowerCase();
  if (flag === "off" || flag === "0" || flag === "false") return false;
  if (env.VITEST && flag !== "on") return false;
  return true;
}

export interface ArchiveOptions {
  /** Download files for size / sha256 / small-file bytes (default true). */
  fetch?: boolean;
}

async function db() {
  return (await import("@/lib/db")).prisma;
}

export async function archiveCandidates(projectId: string, candidates: ArtifactCandidate[], opts: ArchiveOptions = {}): Promise<RecordResult> {
  const prisma = await db();
  return recordArtifacts(new PrismaArtifactStore(prisma), projectId, candidates, { fetch: opts.fetch === false ? null : streamFetchFile });
}

const EMPTY: RecordResult = { created: 0, exists: 0, enriched: 0, wouldCreate: 0, failed: 0, items: [] };

/** A run's master, outputs, qcReport files (variants, exports, locales, covers, auto-fix…) and its jobs. */
export async function archiveRun(runId: string, opts: ArchiveOptions & { jobs?: boolean } = {}): Promise<RecordResult> {
  const prisma = await db();
  const run = await prisma.libtvRun.findUnique({ where: { id: runId }, select: { ...RUN_SELECT, ...(opts.jobs === false ? {} : { jobs: { select: JOB_SELECT } }) } });
  if (!run) return EMPTY;
  return archiveCandidates(run.projectId, collectRun(run, { jobs: opts.jobs }), opts);
}

/** A finished keyframe / clip (and the candidates its QC kept). */
export async function archiveJob(jobId: string, opts: ArchiveOptions = {}): Promise<RecordResult> {
  const prisma = await db();
  const job = await prisma.libtvJob.findUnique({ where: { id: jobId }, select: { ...JOB_SELECT, run: { select: { storyboardId: true } } } });
  if (!job) return EMPTY;
  return archiveCandidates(job.projectId, collectJob(job, job.run), opts);
}

export async function archiveStoryboard(storyboardId: string, opts: ArchiveOptions = {}): Promise<RecordResult> {
  const prisma = await db();
  const b = await prisma.storyboard.findUnique({ where: { id: storyboardId } });
  if (!b) return EMPTY;
  return archiveCandidates(b.projectId, collectStoryboard(b), opts);
}

export async function archiveScript(scriptId: string, opts: ArchiveOptions = {}): Promise<RecordResult> {
  const prisma = await db();
  const s = await prisma.script.findUnique({ where: { id: scriptId } });
  if (!s) return EMPTY;
  return archiveCandidates(s.projectId, collectScript(s), opts);
}

export type ProjectArtifactField = "productBrief" | "campaignPlan" | "testPlan" | "mediaPlan" | "nextRound" | "imageAdSets" | "creativeEditHistory";

/** Project-level documents: brief, campaign plan (with chat-edit snapshots), test / media plan, next round, image ads. */
export async function archiveProjectFields(projectId: string, fields: ProjectArtifactField[], opts: ArchiveOptions = {}): Promise<RecordResult> {
  const prisma = await db();
  const select: Record<string, true> = { id: true };
  for (const f of fields) {
    select[f] = true;
    const at = `${f}At`;
    if (at in PROJECT_FIELDS_SELECT) select[at] = true;
  }
  const project = (await prisma.project.findUnique({ where: { id: projectId }, select })) as ProjectFieldsRow | null;
  if (!project) return EMPTY;
  return archiveCandidates(projectId, collectProjectFields(project), opts);
}

export async function archiveBrandAssets(projectId: string, opts: ArchiveOptions = {}): Promise<RecordResult> {
  const prisma = await db();
  const assets = await prisma.brandAsset.findMany({ where: { brandKit: { projectId } }, select: { id: true, kind: true, variant: true, url: true, bytes: true, format: true, caption: true, createdAt: true } });
  return archiveCandidates(projectId, assets.flatMap((a) => collectBrandAsset(projectId, a)), opts);
}

export async function archiveCatalogRun(catalogRunId: string, opts: ArchiveOptions = {}): Promise<RecordResult> {
  const prisma = await db();
  const c = await prisma.catalogRun.findUnique({ where: { id: catalogRunId }, select: { id: true, projectId: true, source: true, results: true, createdAt: true } });
  if (!c) return EMPTY;
  return archiveCandidates(c.projectId, collectCatalogRun(c), opts);
}

export async function archiveReportDelivery(deliveryId: string): Promise<RecordResult> {
  const prisma = await db();
  const r = await prisma.reportDelivery.findUnique({ where: { id: deliveryId }, select: { id: true, projectId: true, channel: true, status: true, payload: true, periodFrom: true, periodTo: true, createdAt: true } });
  if (!r) return EMPTY;
  return archiveCandidates(r.projectId, collectReportDelivery(r));
}

/** Everything of one project (what the backfill does, through the live store). */
export async function archiveProject(projectId: string, opts: ArchiveOptions = {}): Promise<RecordResult> {
  const prisma = await db();
  const snap = await loadProjectSnapshot(prisma, projectId);
  if (!snap) return EMPTY;
  return archiveCandidates(projectId, collectSnapshot(snap), opts);
}

/**
 * A generated client report (GET /report?format=html|docx). `dedupeValue` is the report model without its
 * generated-at stamp, so re-downloading an unchanged report adds no version.
 */
export async function archiveReport(projectId: string, input: { format: "html" | "docx"; html?: string; docx?: Uint8Array; title: string; dedupeValue: unknown }): Promise<RecordResult> {
  const base = { kind: "report" as const, sourceKey: `project:${projectId}:report:${input.format}`, sourceField: `GET /api/projects/[projectId]/report?format=${input.format}`, dedupeValue: input.dedupeValue, producedAt: new Date() };
  const candidate: ArtifactCandidate =
    input.format === "html"
      ? { ...base, title: `${input.title} (HTML)`, content: input.html ?? "", contentType: "text/html" }
      : { ...base, title: `${input.title} (DOCX)`, data: input.docx ?? new Uint8Array(), contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
  return archiveCandidates(projectId, [candidate]);
}

function warn(label: string, err: unknown) {
  console.warn(`[artifacts] ${label} failed (archiving is best-effort):`, err instanceof Error ? err.message : err);
}

/** Archive after a write, without delaying the caller (kept alive past the response on Vercel). Never throws. */
export function archiveInBackground(label: string, fn: () => Promise<unknown>): void {
  if (!archivingEnabled()) return;
  let p: Promise<unknown>;
  try {
    p = fn().catch((err) => warn(label, err));
  } catch (err) {
    warn(label, err);
    return;
  }
  try {
    waitUntil(p);
  } catch {
    /* outside a request: the promise still runs */
  }
}

/**
 * Archive the current value before it is overwritten. Awaited but URL-only (no download — the backfill or
 * the next hook fills size / sha256 / bytes in), so it costs a couple of queries. Never throws.
 */
export async function archiveBeforeReplace(label: string, fn: (opts: ArchiveOptions) => Promise<unknown>): Promise<void> {
  if (!archivingEnabled()) return;
  try {
    await fn({ fetch: false });
  } catch (err) {
    warn(label, err);
  }
}

/** archiveBeforeReplace, the write, then archiveInBackground of the new value — for overwrite sites. */
export async function archiveAround<T>(label: string, archive: (opts: ArchiveOptions) => Promise<unknown>, write: () => Promise<T>): Promise<T> {
  await archiveBeforeReplace(label, archive);
  const out = await write();
  archiveInBackground(label, () => archive({}));
  return out;
}
