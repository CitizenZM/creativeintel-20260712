/** Is the Mac adstudio-worker polling? It records itself in WorkerHeartbeat as "adstudio:<workerId>" on every call. */
import { prisma } from "@/lib/db";

export const ADSTUDIO_WORKER_PREFIX = "adstudio:";
const ONLINE_MS = 3 * 60 * 1000;

export async function isWorkerOnline(now = Date.now()): Promise<boolean> {
  const beat = await prisma.workerHeartbeat
    .findFirst({ where: { workerId: { startsWith: ADSTUDIO_WORKER_PREFIX }, lastSeenAt: { gte: new Date(now - ONLINE_MS) } }, select: { workerId: true } })
    .catch(() => null);
  return !!beat;
}
