/**
 * Delivery formats of a finished server master (edit engine v2), rendered from
 * the same clips: 4:5 and 1:1 for feeds, 16:9 for YouTube / CTV, and 15 s /
 * 10 s cutdowns with their own beat grid. One format per render (~2–3 min);
 * results live on LibtvRun.qcReport.exports.
 */
import { prisma } from "@/lib/db";
import { renderFromRun } from "./glm-assemble";
import { isServerEngine } from "./libtv-pricing";
import { storyboardFrames } from "./server-executor";
import { variantAdName } from "./variants";

export const EXPORT_FORMATS = {
  "4:5": { label: "4:5 feed", outputAspect: "4:5" },
  "1:1": { label: "1:1 square", outputAspect: "1:1" },
  "16:9": { label: "16:9 YouTube / CTV", outputAspect: "16:9" },
  "15s": { label: "15 s cutdown", cutdownSec: 15 },
  "10s": { label: "10 s cutdown", cutdownSec: 10 },
} as const;

export type ExportFormat = keyof typeof EXPORT_FORMATS;

export function isExportFormat(v: unknown): v is ExportFormat {
  return typeof v === "string" && v in EXPORT_FORMATS;
}

export interface ExportEntry {
  format: ExportFormat;
  label: string;
  masterUrl: string;
  previewUrl: string | null;
  durationSec: number;
  passed: number;
  total: number;
  adName: string;
  createdAt: string;
}

type Qc = Record<string, unknown> & { exports?: ExportEntry[]; exportsPending?: Record<string, string> };

async function patchQc(runId: string, fn: (qc: Qc) => Qc) {
  const run = await prisma.libtvRun.findUnique({ where: { id: runId }, select: { qcReport: true } });
  const qc = (run?.qcReport && typeof run.qcReport === "object" ? run.qcReport : {}) as Qc;
  await prisma.libtvRun.update({ where: { id: runId }, data: { qcReport: fn(qc) as never } });
}

export async function renderExportForRun(runId: string, format: ExportFormat): Promise<ExportEntry> {
  const run = await prisma.libtvRun.findUnique({ where: { id: runId } });
  if (!run) throw new Error("Run not found");
  if (!isServerEngine(run.executor) || run.status !== "completed") throw new Error(`Only completed server runs can be exported (status ${run.status})`);
  const spec = EXPORT_FORMATS[format];
  await patchQc(runId, (qc) => ({ ...qc, exportsPending: { ...(qc.exportsPending ?? {}), [format]: new Date().toISOString() } }));
  try {
    const [jobs, frames, project, script] = await Promise.all([
      prisma.libtvJob.findMany({ where: { runId } }),
      storyboardFrames(run.storyboardId),
      prisma.project.findUnique({ where: { id: run.projectId }, select: { brandName: true } }),
      run.scriptId ? prisma.script.findUnique({ where: { id: run.scriptId }, select: { title: true } }) : null,
    ]);
    const v = await renderFromRun({
      runId,
      projectId: run.projectId,
      aspectRatio: run.aspectRatio,
      frames,
      jobs,
      outputAspect: "outputAspect" in spec ? spec.outputAspect : undefined,
      cutdownSec: "cutdownSec" in spec ? spec.cutdownSec : undefined,
      tag: `export-${format.replace(":", "x")}`,
    });
    const entry: ExportEntry = {
      format,
      label: spec.label,
      masterUrl: v.masterUrl,
      previewUrl: v.previewUrl,
      durationSec: v.durationSec,
      passed: v.qc.passed,
      total: v.qc.total,
      adName: `${variantAdName({ brand: project?.brandName, title: script?.title?.replace(/^⚠\s*/, ""), durationSec: v.durationSec, hookStyle: "q" })}_${format.replace(":", "x")}`,
      createdAt: new Date().toISOString(),
    };
    await patchQc(runId, (qc) => {
      const pending = { ...(qc.exportsPending ?? {}) };
      delete pending[format];
      return { ...qc, exports: [...(qc.exports ?? []).filter((e) => e.format !== format), entry], exportsPending: pending };
    });
    return entry;
  } catch (err) {
    await patchQc(runId, (qc) => {
      const pending = { ...(qc.exportsPending ?? {}) };
      delete pending[format];
      return { ...qc, exportsPending: pending };
    }).catch(() => {});
    throw err;
  }
}
