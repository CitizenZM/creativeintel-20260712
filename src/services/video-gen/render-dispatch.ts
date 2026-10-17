import { loadAiSettings } from "@/services/settings/ai-settings";
import { acquireSharedSlot } from "@/services/shared-lease";
import { send } from "@vercel/queue";
import { prisma } from "@/lib/db";
import { adapterFor } from "./server-engines";
import { tickRun } from "./server-executor";
import { pollJob } from "./poll";

export const RENDER_TOPIC = "creativeintel-render";
export type RenderMessage = { kind: "run" | "video"; id: string; generation: number };

/** Database rows are the recovery outbox; cron republishes active rows after crashes. */
export async function enqueueRender(kind: RenderMessage["kind"], id: string, delaySeconds = 0) {
  const generation = Math.floor((Date.now() + delaySeconds * 1000) / 15_000);
  await send(RENDER_TOPIC, { kind, id, generation } satisfies RenderMessage, {
    delaySeconds,
    retentionSeconds: 86_400,
    idempotencyKey: `${kind}:${id}:${generation}`,
  });
}

export async function processRender(message: RenderMessage) {
  if (!message || !["run", "video"].includes(message.kind) || typeof message.id !== "string") return;
  const release = await acquireSharedSlot(`render:${message.kind}:${message.id}`, 1, 330_000, 0);
  if (!release) { await enqueueRender(message.kind, message.id, 30); return; }
  try {
  let active = false;
  if (message.kind === "run") {
    const run = await prisma.libtvRun.findUnique({ where: { id: message.id }, select: { executor: true, status: true } });
    if (!run || !["approved", "claimed", "running", "assembling"].includes(run.status)) return;
    await loadAiSettings();
    const adapter = adapterFor(run.executor);
    if (!adapter) return;
    // tickRun owns atomic shot and assembly claims, making duplicate deliveries safe.
    const result = await tickRun(adapter, message.id, { remainingMs: 270_000 });
    active = result === "running" || result === "idle";
  } else {
    const job = await prisma.falVideoJob.findUnique({ where: { id: message.id } });
    if (!job || ["completed", "failed"].includes(job.status)) return;
    const result = await pollJob(job);
    active = !["completed", "failed"].includes(result.status);
  }
  if (active) await enqueueRender(message.kind, message.id, 20);
  } finally { await release(); }
}

export async function recoverRenderQueue(limit = 100) {
  const [runs, videos] = await Promise.all([
    prisma.libtvRun.findMany({ where: { executor: { in: ["glm", "comfyui", "animatic", "matrix", "openrouter"] }, status: { in: ["approved", "claimed", "running", "assembling"] } }, select: { id: true }, orderBy: { updatedAt: "asc" }, take: limit }),
    prisma.falVideoJob.findMany({ where: { status: { in: ["queued", "processing", "generating"] } }, select: { id: true }, orderBy: { createdAt: "asc" }, take: limit }),
  ]);
  const results = await Promise.allSettled([
    ...runs.map((r) => enqueueRender("run", r.id)),
    ...videos.map((v) => enqueueRender("video", v.id)),
  ]);
  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed) throw new Error(`Failed to republish ${failed} render jobs`);
  return { runs: runs.length, videos: videos.length };
}
