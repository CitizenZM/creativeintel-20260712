/**
 * Pre-flight auto-fix loop: after an edit-v2 render, read its QC + pre-flight result and, for the
 * issues a re-edit can fix, render once more from the same clips with the corrections — no
 * generation, so it costs nothing:
 *
 *   safe-zone     text in the platform UI (TikTok's right rail) → lay out in the platform safe box, tighter
 *   first-frame   black / dim frame 1 → no fade (already gone) and start 0.1–0.3 s into the first clip
 *   loudness      mix off −14 LUFS → offset the loudnorm target by the miss
 *   captions      voiceover without captions → caption every spoken group
 *   cta           no CTA in the last second → hold the CTA button over it
 *
 * Before / after scores are kept on qcReport.autofix; a better re-render replaces the run's master
 * (the old URL is kept for rollback). Late product, a missing offer and other script / shot problems
 * are not re-edit fixes and are left to the pre-flight report.
 */
import type { PlatformId } from "@/services/creative/types";
import type { EditFixes } from "./edit/render-v2";

export type FixKind = "first-frame" | "safe-zone" | "loudness" | "captions" | "cta";
const ORDER: FixKind[] = ["first-frame", "safe-zone", "loudness", "captions", "cta"];

export interface FixIssue {
  kind: FixKind;
  /** The QC / pre-flight check that failed. */
  key: string;
  value: number | string | null;
}

interface CheckLike {
  key: string;
  value: number | string | null;
  pass: boolean | null;
  /** Pre-flight partial credit (0–1). */
  score?: number | null;
}

/** The parts of a QcReport (edit/qc.ts, with its preflight section) the loop reads. */
export interface QcLike {
  passed: number;
  total: number;
  checks: CheckLike[];
  preflight?: { score: number; platform: string; checks: CheckLike[] } | null;
  layout?: { platform: string | null; inset: number } | null;
  fixes?: EditFixes | null;
}

/** QC check / pre-flight check → the re-edit fix for it (dark first frame only: a blown-out one needs a grade). */
const MAP: { key: string; source: "qc" | "preflight"; kind: FixKind; when?: (v: CheckLike["value"]) => boolean }[] = [
  { key: "first_frame_brightness", source: "preflight", kind: "first-frame", when: (v) => typeof v !== "number" || v < 0.3 },
  { key: "safe_zone", source: "preflight", kind: "safe-zone" },
  { key: "loudness_lufs", source: "qc", kind: "loudness", when: (v) => typeof v === "number" },
  { key: "loudness_lufs", source: "preflight", kind: "loudness", when: (v) => typeof v === "number" },
  { key: "caption_coverage", source: "qc", kind: "captions" },
  { key: "captions", source: "preflight", kind: "captions" },
  { key: "cta_end", source: "preflight", kind: "cta" },
];

/** The failed checks a re-edit can fix, one per kind, in fix order. Pure. */
export function fixableIssues(qc: QcLike): FixIssue[] {
  const found = new Map<FixKind, FixIssue>();
  for (const m of MAP) {
    const list = m.source === "qc" ? qc.checks : (qc.preflight?.checks ?? []);
    const c = list.find((x) => x.key === m.key);
    if (!c || c.pass !== false || found.has(m.kind)) continue;
    if (m.when && !m.when(c.value)) continue;
    found.set(m.kind, { kind: m.kind, key: c.key, value: c.value });
  }
  return ORDER.filter((k) => found.has(k)).map((k) => found.get(k)!);
}

/**
 * The corrections for these issues. `prev` = fixes the render already had; `prevPlatform` = the
 * platform it was already laid out for (then a safe-zone miss tightens the box further). Pure.
 */
export function correctionsFor(issues: FixIssue[], prev: EditFixes = {}, prevPlatform: string | null = null): EditFixes {
  const out: EditFixes = {};
  for (const i of issues) {
    if (i.kind === "safe-zone") out.layoutInset = Math.round(((prev.layoutInset ?? 0) + (prevPlatform ? 0.025 : 0.01)) * 1000) / 1000;
    if (i.kind === "first-frame") out.brightOpen = true;
    if (i.kind === "loudness" && typeof i.value === "number") out.loudnessTarget = Math.min(-9, Math.max(-20, Math.round(((prev.loudnessTarget ?? -14) + (-14 - i.value)) * 10) / 10));
    if (i.kind === "captions") out.allCaptions = true;
    if (i.kind === "cta") out.forceCta = true;
  }
  return out;
}

/** 0–100: the pre-flight score when the render has one, else the QC pass rate. */
export function qcScore(qc: QcLike): number {
  if (qc.preflight && Number.isFinite(qc.preflight.score)) return qc.preflight.score;
  return qc.total ? Math.round((100 * qc.passed) / qc.total) : 0;
}

export interface AutoFixRecord {
  status: "clean" | "fixed" | "no-better";
  platform: PlatformId | null;
  issues: FixIssue[];
  fixes: EditFixes;
  before: { score: number; issues: FixKind[] };
  after?: { score: number; issues: FixKind[]; masterUrl: string; previewUrl: string | null };
  promoted: boolean;
  previousMasterUrl?: string | null;
  at: string;
}

export interface AutoFixDeps {
  /** The run's current QC (with preflight), its target platform and master. */
  load(runId: string): Promise<{ qc: QcLike | null; platform: PlatformId | null; masterUrl: string | null }>;
  /** Re-edit the run from its clips with these corrections (glm-assemble.renderFromRun). */
  render(runId: string, opts: { platform: PlatformId | null; fixes: EditFixes }): Promise<{ qc: QcLike; masterUrl: string; previewUrl: string | null }>;
  /** Keep the record on qcReport.autofix; `promote` replaces the master and its QC. */
  save(runId: string, record: AutoFixRecord, promote: { masterUrl: string; previewUrl: string | null; qc: QcLike } | null): Promise<void>;
}

export async function autoFixRender(runId: string, deps: AutoFixDeps = prismaDeps()): Promise<AutoFixRecord> {
  const { qc, platform, masterUrl } = await deps.load(runId);
  if (!qc) throw new Error("This run has no QC report to fix from");
  const issues = fixableIssues(qc);
  const before = { score: qcScore(qc), issues: issues.map((i) => i.kind) };
  const at = () => new Date().toISOString();
  if (!issues.length) {
    const record: AutoFixRecord = { status: "clean", platform, issues, fixes: {}, before, promoted: false, at: at() };
    await deps.save(runId, record, null);
    return record;
  }
  // Corrections build on what the last render already had (a second pass tightens further).
  const fixes = { ...(qc.fixes ?? {}), ...correctionsFor(issues, qc.fixes ?? {}, qc.layout?.platform ?? null) };
  const v = await deps.render(runId, { platform, fixes });
  const afterIssues = fixableIssues(v.qc);
  const after = { score: qcScore(v.qc), issues: afterIssues.map((i) => i.kind), masterUrl: v.masterUrl, previewUrl: v.previewUrl };
  const better = after.score > before.score || (after.score === before.score && afterIssues.length < issues.length);
  const record: AutoFixRecord = { status: better ? "fixed" : "no-better", platform, issues, fixes, before, after, promoted: better, previousMasterUrl: better ? masterUrl : undefined, at: at() };
  await deps.save(runId, record, better ? { masterUrl: v.masterUrl, previewUrl: v.previewUrl, qc: v.qc } : null);
  return record;
}

/** Production wiring: the run from the DB, the re-edit through renderFromRun, the record on qcReport. */
export function prismaDeps(opts: { platform?: PlatformId | null } = {}): AutoFixDeps {
  return {
    async load(runId) {
      const { prisma } = await import("@/lib/db");
      const { isServerEngine } = await import("./libtv-pricing");
      const { defaultPlatform } = await import("./preflight/plan");
      const run = await prisma.libtvRun.findUnique({ where: { id: runId }, select: { executor: true, status: true, aspectRatio: true, qcReport: true, masterMp4Url: true } });
      if (!run) throw new Error("Run not found");
      if (!isServerEngine(run.executor) || run.status !== "completed") throw new Error(`Only completed server runs can be auto-fixed (status ${run.status})`);
      const qc = (run.qcReport && typeof run.qcReport === "object" ? run.qcReport : null) as (QcLike & { engine?: string }) | null;
      const platform = (opts.platform ?? qc?.layout?.platform ?? qc?.preflight?.platform ?? defaultPlatform(run.aspectRatio)) as PlatformId;
      return { qc, platform, masterUrl: run.masterMp4Url };
    },
    async render(runId, o) {
      const { prisma } = await import("@/lib/db");
      const { storyboardFrames } = await import("./server-executor");
      const { renderFromRun } = await import("./glm-assemble");
      const run = await prisma.libtvRun.findUnique({ where: { id: runId } });
      if (!run) throw new Error("Run not found");
      const [jobs, frames] = await Promise.all([prisma.libtvJob.findMany({ where: { runId } }), storyboardFrames(run.storyboardId, run.directorPlan)]);
      const qc0 = (run.qcReport ?? {}) as { hookStyle?: string };
      const hookStyle = qc0.hookStyle === "c" || qc0.hookStyle === "p" || qc0.hookStyle === "q" ? qc0.hookStyle : undefined;
      const v = await renderFromRun({ runId, projectId: run.projectId, aspectRatio: run.aspectRatio, frames, jobs, hookStyle, tag: "autofix", platform: o.platform, fixes: o.fixes });
      return { qc: { ...v.qc, ...(hookStyle ? { hookStyle } : {}) } as QcLike, masterUrl: v.masterUrl, previewUrl: v.previewUrl };
    },
    async save(runId, record, promote) {
      const { prisma } = await import("@/lib/db");
      const fresh = await prisma.libtvRun.findUnique({ where: { id: runId }, select: { qcReport: true } });
      const qc = (fresh?.qcReport && typeof fresh.qcReport === "object" ? fresh.qcReport : {}) as Record<string, unknown>;
      // Promotion swaps the measured sections (checks, preflight, layout, fixes) and keeps the rest
      // (variants, exports, director review, covers…).
      const next = promote ? { ...qc, ...(promote.qc as object), autofix: record } : { ...qc, autofix: record };
      // Content history: the master being replaced is archived BEFORE the swap (qcReport keeps only one predecessor).
      const { archiveAround, archiveRun } = await import("@/services/artifacts/archive");
      await archiveAround(
        "auto-fix",
        (o) => archiveRun(runId, { ...o, jobs: false }),
        () =>
          prisma.libtvRun.update({
            where: { id: runId },
            data: { qcReport: next as never, ...(promote ? { masterMp4Url: promote.masterUrl, previewMp4Url: promote.previewUrl } : {}) },
          })
      );
    },
  };
}
