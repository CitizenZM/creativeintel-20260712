import { failJob } from "./job-progress";
import { send } from "@vercel/queue";
import { prisma } from "@/lib/db";
import { acquireSharedSlot } from "@/services/shared-lease";
import { runResearch, type ResearchCheckpoint } from "./runner";
import { ResearchWaiting, withWorkerDeferral } from "./worker-await";

export const RESEARCH_TOPIC = "creativeintel-research";
export async function enqueueResearch(jobId: string, delaySeconds = 0) {
  await send(RESEARCH_TOPIC, { jobId }, { delaySeconds, retentionSeconds: 86_400,
    idempotencyKey: `research:${jobId}:${Math.floor((Date.now() + delaySeconds * 1000) / 15_000)}` });
}
export async function startResearch(projectId: string, jobId: string) {
  await prisma.researchContinuation.create({ data: { projectId, jobId, checkpoint: { phase: "crawl" } } });
  await enqueueResearch(jobId);
}
export async function processResearch({ jobId }: { jobId: string }) {
  if (typeof jobId !== "string") return;
  const release = await acquireSharedSlot(`research:${jobId}`, 1, 330_000, 0);
  if (!release) { await enqueueResearch(jobId, 30); return; }
  try {
    const row = await prisma.researchContinuation.findUnique({ where: { jobId } });
    if (!row || ["complete", "failed"].includes(row.status)) return;
    const job = await prisma.researchJob.findUnique({ where: { id: jobId }, select: { status: true } });
    if (!job || ["complete", "error", "cancelled"].includes(job.status)) {
      await prisma.researchContinuation.update({ where: { jobId }, data: { status: job?.status === "complete" ? "complete" : "failed" } }); return;
    }
    let checkpoint = (row.checkpoint ?? { phase: "crawl" }) as unknown as ResearchCheckpoint;
    const waitingIds = Array.isArray(row.waitingTaskIds) ? row.waitingTaskIds.filter((id): id is string => typeof id === "string") : [];
    const waiting = waitingIds.length ? await prisma.workerTask.findMany({ where: { id: { in: waitingIds } }, select: { status: true, payload: true } }) : [];
    const waitingSince = checkpoint.waitingSince ? Date.parse(checkpoint.waitingSince) : row.createdAt.getTime();
    const expired = Date.now() - waitingSince > 30 * 60_000;
    if (!expired && waiting.some((t) => !["completed", "failed"].includes(t.status))) {
      await enqueueResearch(jobId, 30); return;
    }
    const ignored = [...(checkpoint.ignoredWorkerHashes ?? []), ...waiting.filter((t) => t.status === "failed" || (expired && t.status !== "completed")).flatMap((t) => {
      const hash = (t.payload as { hash?: string } | null)?.hash;
      return hash ? [hash] : [];
    })];
    await prisma.researchContinuation.update({ where: { jobId }, data: { status: "running", waitingTaskIds: [] } });
    const save = async (next: ResearchCheckpoint) => {
      checkpoint = { ...next, ignoredWorkerHashes: ignored };
      await prisma.researchContinuation.update({ where: { jobId }, data: { checkpoint: checkpoint as never, status: next.phase === "complete" ? "complete" : "queued" } });
    };
    try {
      await withWorkerDeferral(() => runResearch(row.projectId, jobId, { checkpoint, save }), ignored);
    } catch (error) {
      if (!(error instanceof ResearchWaiting)) {
        const attempts = (checkpoint.phaseAttempts ?? 0) + 1;
        console.error(`[research] phase ${checkpoint.phase} attempt ${attempts} failed`, error);
        if (attempts < 3) {
          await prisma.researchContinuation.update({ where: { jobId }, data: { checkpoint: { ...checkpoint, phaseAttempts: attempts } as never, status: "queued" } });
          throw error;
        }
        await failJob(jobId, "Research could not finish after three attempts. Start a new run to retry.");
        await prisma.project.updateMany({ where: { id: row.projectId, status: "RESEARCHING" }, data: { status: "ERROR" } });
        await prisma.researchContinuation.update({ where: { jobId }, data: { status: "failed" } });
        return;
      }
      await prisma.researchContinuation.update({ where: { jobId }, data: { status: "waiting", waitingTaskIds: error.taskIds, checkpoint: { ...checkpoint, ignoredWorkerHashes: ignored, waitingSince: new Date().toISOString() } as never } });
    }
    const updated = await prisma.researchContinuation.findUnique({ where: { jobId }, select: { status: true } });
    if (updated && !["complete", "failed"].includes(updated.status)) await enqueueResearch(jobId, 30);
  } finally { await release(); }
}
/** Worker callbacks wake matching research immediately; periodic recovery covers lost callbacks. */
export async function wakeProjectResearch(projectId: string) {
  const rows = await prisma.researchContinuation.findMany({ where: { projectId, status: "waiting" }, select: { jobId: true } });
  await Promise.all(rows.map((r) => enqueueResearch(r.jobId)));
}
export async function recoverResearchQueue(limit = 100) {
  const rows = await prisma.researchContinuation.findMany({ where: { status: { in: ["queued", "waiting", "running"] } }, select: { jobId: true }, orderBy: { updatedAt: "asc" }, take: limit });
  await Promise.all(rows.map((r) => enqueueResearch(r.jobId)));
  return rows.length;
}
