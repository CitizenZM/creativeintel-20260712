/**
 * LibtvRun.qcReport is one JSON document that many writers extend: hook variants, batches, locales,
 * exports, the export pack, covers, the AI director, pre-flight. A plain read → spread → write loses
 * whatever another writer stored in between, so every partial writer goes through patchQcReport:
 * an optimistic read → mutate → write conditional on the run's updatedAt (bumped by every write),
 * re-applying the mutation to the fresh report on a conflict.
 */
import { prisma } from "@/lib/db";

export type QcReportDoc = Record<string, unknown>;

/** Conflicting writes are retried this many times after the first try. */
export const QC_PATCH_RETRIES = 3;

export function qcReportOf(value: unknown): QcReportDoc {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as QcReportDoc) : {};
}

/**
 * Apply `mutate` to the run's current qcReport and write it only if nobody wrote the run meanwhile.
 * `mutate` may run more than once (once per conflict): keep it a function of the report it is given.
 * Return null from it to write nothing. Resolves to the report written (the current one when nothing
 * was written), or null when the run does not exist.
 */
export async function patchQcReport<T extends QcReportDoc = QcReportDoc>(runId: string, mutate: (qc: T) => T | null, opts: { retries?: number } = {}): Promise<T | null> {
  const tries = 1 + (opts.retries ?? QC_PATCH_RETRIES);
  for (let i = 0; i < tries; i++) {
    const run = await prisma.libtvRun.findUnique({ where: { id: runId }, select: { qcReport: true, updatedAt: true } });
    if (!run) return null;
    const qc = qcReportOf(run.qcReport) as T;
    const next = mutate(qc);
    if (next === null) return qc;
    const { count } = await prisma.libtvRun.updateMany({ where: { id: runId, updatedAt: run.updatedAt }, data: { qcReport: next as never } });
    if (count === 1) return next;
  }
  throw new Error(`qcReport of run ${runId} kept changing — gave up after ${tries} attempts`);
}

/**
 * A re-assembled master's report: the assembly's own keys (checks, layout, preflight, covers… of the
 * new cut) replace the old ones; everything else — variants, batches, locales, exports, the export
 * pack, auto-fix, the director review — is kept. Pure.
 */
export function mergeReassembledQc(previous: unknown, assembled: QcReportDoc): QcReportDoc {
  return { ...qcReportOf(previous), ...assembled };
}
