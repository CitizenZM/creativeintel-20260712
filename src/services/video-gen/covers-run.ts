/**
 * Covers for a finished run: upload the local cover files (edit/covers.ts) with the storage helper,
 * and the operator `covers` action — score and compose covers for the master and every hook variant
 * / delivery export that lacks them, kept on qcReport.covers (master) and on each variant / export
 * entry. Local ffmpeg + sharp only; nothing is generated.
 */
import { readFile } from "node:fs/promises";
import type { CoverSet } from "./edit/qc";
import type { CoversResult } from "./edit/covers";

type Upload = (input: { buffer: Buffer; filename: string; contentType: string; folder?: string }) => Promise<{ url: string; provider: string }>;

/** Upload a CoversResult's files → the CoverSet kept on the QC report (inline-only storage is dropped). */
export async function uploadCovers(r: CoversResult & { headline: string | null }, tag: string, upload?: Upload): Promise<CoverSet> {
  const up: Upload = upload ?? (async (i) => (await import("@/services/storage")).uploadBuffer(i));
  const items: CoverSet["items"] = [];
  for (const c of r.covers) {
    const res = await up({ buffer: await readFile(c.file), filename: `cover-${tag}-${c.aspect.replace(":", "x")}.jpg`, contentType: "image/jpeg", folder: "glm-covers" });
    if (res.provider !== "inline") items.push({ aspect: c.aspect, url: res.url, w: c.w, h: c.h });
  }
  return { frameSec: r.frameSec, score: r.score, headline: r.headline, items, candidates: r.candidates.slice(0, 5), createdAt: new Date().toISOString() };
}

export interface CoverTarget {
  key: string;
  url: string;
  /** Headline override (a variant's own hook); undefined = the run's hook line. */
  headline?: string | null;
}

type QcCovers = {
  covers?: { items?: unknown[] } | null;
  variants?: { hookStyle: string; masterUrl: string; hookText?: string | null; covers?: { items?: unknown[] } | null }[];
  exports?: { format: string; masterUrl: string; covers?: { items?: unknown[] } | null }[];
};

/** Which videos of a run still need covers (all of them with `force`). Pure. */
export function coverTargets(masterUrl: string | null, qc: QcCovers, opts: { force?: boolean } = {}): CoverTarget[] {
  const need = (c: { items?: unknown[] } | null | undefined) => opts.force || !c?.items?.length;
  const out: CoverTarget[] = [];
  if (masterUrl && need(qc.covers)) out.push({ key: "master", url: masterUrl });
  for (const v of qc.variants ?? []) if (v.masterUrl && need(v.covers)) out.push({ key: `variant:${v.hookStyle}`, url: v.masterUrl, headline: v.hookText ?? undefined });
  for (const e of qc.exports ?? []) if (e.masterUrl && need(e.covers)) out.push({ key: `export:${e.format}`, url: e.masterUrl });
  return out;
}

/** The cover headline from the storyboard: the hook frame's on-screen line (shortened like the edit's). */
export function hookHeadlineFromFrames(frames: { segment?: string | null; text?: string | null }[]): string | null {
  return frames.find((f) => (f.segment ?? "").toUpperCase() === "HOOK" && f.text?.trim())?.text?.trim() ?? null;
}

export class CoversError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Operator `covers`: covers for the master and each variant / export without them. */
export async function coversForRun(projectId: string, runId: string, opts: { force?: boolean } = {}): Promise<{ key: string; covers: CoverSet }[]> {
  const { prisma } = await import("@/lib/db");
  const run = await prisma.libtvRun.findFirst({ where: { id: runId, projectId }, select: { id: true, projectId: true, masterMp4Url: true, qcReport: true, storyboardId: true, directorPlan: true } });
  if (!run) throw new CoversError("Run not found", 404);
  if (!run.masterMp4Url) throw new CoversError("This run has no master yet", 409);
  const qc0 = (run.qcReport && typeof run.qcReport === "object" ? run.qcReport : {}) as QcCovers;
  const targets = coverTargets(run.masterMp4Url, qc0, opts);
  if (!targets.length) return [];

  const { storyboardFrames } = await import("./server-executor");
  const { hookHeadline } = await import("./edit/edit-plan");
  const { loadBrandStyle } = await import("./edit/brand-style");
  const { makeCovers } = await import("./edit/covers");
  const { measureCuts } = await import("./edit/qc");
  const { safeFetchBuffer } = await import("@/lib/safe-fetch");
  const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");

  const frames = await storyboardFrames(run.storyboardId, run.directorPlan);
  const line = hookHeadlineFromFrames(frames);
  const runHeadline = line ? (hookHeadline(line) ?? line) : null;
  const look = await loadBrandStyle(run.projectId);
  const cta = frames.find((f) => (f.segment ?? "").toUpperCase() === "CTA");
  const shots = frames.map((f) => ({ startSec: f.startSec, endSec: f.endSec, product: (f.segment ?? "").toUpperCase() === "CTA" || !!f.zoomHit, person: !!f.hasPerson }));

  const done: { key: string; covers: CoverSet }[] = [];
  const dir = await mkdtemp(path.join(tmpdir(), `covers-${run.id}-`));
  try {
    for (const t of targets) {
      const got = await safeFetchBuffer(t.url, { timeoutMs: 120_000, maxBytes: 300 * 1024 * 1024 });
      if (!got.ok || !got.buffer) throw new CoversError(`Download failed for ${t.key}: ${got.error ?? got.status}`, 502);
      const tag = t.key.replace(/[^a-z0-9]+/gi, "-");
      const file = path.join(dir, `${tag}.mp4`);
      await writeFile(file, got.buffer);
      const durationSec = frames.length ? Math.max(...frames.map((f) => f.endSec)) : 15;
      const cutsSec = await measureCuts(file, dir).catch(() => frames.map((f) => f.startSec));
      const headline = t.headline === undefined ? runHeadline : t.headline;
      // Exports and cutdowns keep their own length: without the storyboard timing, sample the whole video.
      const own = t.key === "master" || t.key.startsWith("variant:");
      const r = await makeCovers({ file, dir, headline, look, tag, plan: { durationSec, ctaSec: own ? (cta?.startSec ?? null) : null, cutsSec, shots: own ? shots : [] } });
      done.push({ key: t.key, covers: await uploadCovers({ ...r, headline }, `${tag}-${run.id}`) });
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }

  // Record on the fresh report (other renders may have written meanwhile).
  const fresh = await prisma.libtvRun.findUnique({ where: { id: run.id }, select: { qcReport: true } });
  const qc = (fresh?.qcReport && typeof fresh.qcReport === "object" ? fresh.qcReport : {}) as QcCovers & Record<string, unknown>;
  const by = new Map(done.map((d) => [d.key, d.covers]));
  const next = {
    ...qc,
    ...(by.has("master") ? { covers: by.get("master") } : {}),
    ...(qc.variants ? { variants: qc.variants.map((v) => (by.has(`variant:${v.hookStyle}`) ? { ...v, covers: by.get(`variant:${v.hookStyle}`) } : v)) } : {}),
    ...(qc.exports ? { exports: qc.exports.map((e) => (by.has(`export:${e.format}`) ? { ...e, covers: by.get(`export:${e.format}`) } : e)) } : {}),
  };
  await prisma.libtvRun.update({ where: { id: run.id }, data: { qcReport: next as never } });
  return done;
}
