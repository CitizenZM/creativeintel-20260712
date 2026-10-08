/**
 * Prisma side of the content-history archive: the ArtifactStore over ProjectArtifact / ArtifactBlob, and
 * the loaders that read what a project produced (for the live hooks and the backfill).
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { SlotConflictError, type ArtifactStore, type NewArtifactRow, type SlotState } from "./record";
import type { ProjectSnapshot, RunRow } from "./collect";

type Db = Pick<PrismaClient, "projectArtifact" | "artifactBlob">;

const isUniqueViolation = (err: unknown) => !!err && typeof err === "object" && (err as { code?: string }).code === "P2002";

export class PrismaArtifactStore implements ArtifactStore {
  constructor(private db: Db) {}

  async slots(projectId: string, sourceKeys: string[]): Promise<Map<string, SlotState>> {
    const out = new Map<string, SlotState>();
    for (let i = 0; i < sourceKeys.length; i += 500) {
      const rows = await this.db.projectArtifact.findMany({
        where: { projectId, sourceKey: { in: sourceKeys.slice(i, i + 500) } },
        select: { id: true, sourceKey: true, version: true, fingerprint: true, sha256: true, bytes: true, createdAt: true, blob: { select: { artifactId: true } } },
      });
      for (const r of rows) {
        const s = out.get(r.sourceKey) ?? { maxVersion: 0, latestAt: null, byFingerprint: new Map() };
        s.maxVersion = Math.max(s.maxVersion, r.version);
        if (!s.latestAt || r.createdAt > s.latestAt) s.latestAt = r.createdAt;
        s.byFingerprint.set(r.fingerprint, { id: r.id, version: r.version, sha256: r.sha256, bytes: r.bytes, hasBlob: !!r.blob, createdAt: r.createdAt });
        out.set(r.sourceKey, s);
      }
    }
    return out;
  }

  async create(row: NewArtifactRow, blob: Uint8Array | null): Promise<{ id: string }> {
    const { content, meta, createdAt, ...rest } = row;
    try {
      return await this.db.projectArtifact.create({
        data: {
          ...rest,
          ...(content !== null && content !== undefined ? { content: content as never } : {}),
          ...(meta ? { meta: meta as never } : {}),
          ...(createdAt ? { createdAt } : {}),
          ...(blob ? { blob: { create: { data: new Uint8Array(blob) } } } : {}),
        },
        select: { id: true },
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new SlotConflictError();
      throw err;
    }
  }

  async enrich(id: string, patch: { sha256?: string | null; bytes?: number | null; contentType?: string | null; meta?: Record<string, unknown> | null }, blob: Uint8Array | null): Promise<void> {
    const data: Record<string, unknown> = {};
    if (patch.sha256 !== undefined) data.sha256 = patch.sha256;
    if (patch.bytes !== undefined) data.bytes = patch.bytes;
    if (patch.contentType) data.contentType = patch.contentType;
    if (patch.meta) data.meta = patch.meta;
    if (Object.keys(data).length) await this.db.projectArtifact.update({ where: { id }, data });
    if (blob) await this.db.artifactBlob.upsert({ where: { artifactId: id }, create: { artifactId: id, data: new Uint8Array(blob) }, update: {} });
  }
}

// ─── Loaders ─────────────────────────────────────────────────────────────────

type ReadDb = Pick<PrismaClient, "project" | "script" | "storyboard" | "libtvRun" | "libtvJob" | "brandAsset" | "catalogRun" | "reportDelivery" | "autopilotRun">;

export const PROJECT_FIELDS_SELECT = {
  id: true,
  name: true,
  brandName: true,
  productBrief: true,
  productBriefAt: true,
  campaignPlan: true,
  campaignPlanAt: true,
  testPlan: true,
  testPlanAt: true,
  mediaPlan: true,
  mediaPlanAt: true,
  nextRound: true,
  nextRoundAt: true,
  imageAdSets: true,
  creativeEditHistory: true,
} as const;

export const RUN_SELECT = {
  id: true,
  projectId: true,
  storyboardId: true,
  status: true,
  canvasName: true,
  masterMp4Url: true,
  voiceoverUrl: true,
  subtitlesUrl: true,
  previewMp4Url: true,
  contactSheetUrl: true,
  directorPlan: true,
  qcReport: true,
  createdAt: true,
  completedAt: true,
} as const;

export const JOB_SELECT = { id: true, runId: true, projectId: true, kind: true, nodeName: true, shotIndex: true, status: true, resultUrl: true, settings: true, completedAt: true } as const;

/** Everything a project produced, read in one go (deleted scripts / storyboards included: history). */
export async function loadProjectSnapshot(db: ReadDb, projectId: string): Promise<ProjectSnapshot | null> {
  const project = await db.project.findUnique({ where: { id: projectId }, select: PROJECT_FIELDS_SELECT });
  if (!project) return null;
  const [scripts, storyboards, runs, jobs, brandAssets, catalogRuns, reportDeliveries, autopilotRuns] = await Promise.all([
    db.script.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } }),
    db.storyboard.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } }),
    db.libtvRun.findMany({ where: { projectId }, orderBy: { createdAt: "asc" }, select: RUN_SELECT }),
    db.libtvJob.findMany({ where: { projectId }, orderBy: [{ shotIndex: "asc" }, { nodeName: "asc" }], select: JOB_SELECT }),
    db.brandAsset.findMany({ where: { brandKit: { projectId } }, orderBy: { createdAt: "asc" }, select: { id: true, kind: true, variant: true, url: true, bytes: true, format: true, caption: true, createdAt: true } }),
    db.catalogRun.findMany({ where: { projectId }, orderBy: { createdAt: "asc" }, select: { id: true, projectId: true, source: true, results: true, createdAt: true } }),
    db.reportDelivery.findMany({ where: { projectId }, orderBy: { createdAt: "asc" }, select: { id: true, projectId: true, channel: true, status: true, payload: true, periodFrom: true, periodTo: true, createdAt: true } }),
    db.autopilotRun.findMany({ where: { projectId }, orderBy: { createdAt: "asc" }, select: { id: true, projectId: true, status: true, step: true, input: true, state: true, createdAt: true } }),
  ]);
  const jobsByRun = new Map<string, typeof jobs>();
  for (const j of jobs) jobsByRun.set(j.runId, [...(jobsByRun.get(j.runId) ?? []), j]);
  return {
    project,
    scripts,
    storyboards,
    runs: runs.map((r): RunRow => ({ ...r, jobs: jobsByRun.get(r.id) ?? [] })),
    brandAssets,
    catalogRuns,
    reportDeliveries,
    autopilotRuns,
  };
}

/** Backfill wiring over a Prisma client. `store` defaults to the DB store (a dry run reads it, never writes). */
export async function prismaBackfillDeps(
  db: ReadDb & Db,
  opts: { store?: import("./record").ArtifactStore } = {}
): Promise<import("./backfill").BackfillDeps> {
  const { streamFetchFile } = await import("./record");
  const { headFile } = await import("./backfill");
  return {
    async listProjects(after, limit) {
      const rows = await db.project.findMany({ where: after ? { id: { gt: after } } : {}, orderBy: { id: "asc" }, take: limit, select: { id: true, name: true } });
      return rows;
    },
    loadSnapshot: (id) => loadProjectSnapshot(db, id),
    store: opts.store ?? new PrismaArtifactStore(db),
    fetch: streamFetchFile,
    head: headFile,
  };
}
