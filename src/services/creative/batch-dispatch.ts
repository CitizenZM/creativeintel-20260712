import { send } from "@vercel/queue";
import { prisma } from "@/lib/db";
import { acquireSharedSlot } from "@/services/shared-lease";
import { auditContext, loadScriptContext, type ScriptAngle } from "@/app/api/projects/[projectId]/creative/_script-context";
import { getScriptTemplate, isVideoType, type ScriptTemplate } from "@/services/ai/prompts/script-templates";
import { getBrandTruthForPrompts } from "@/services/brand-kit";
import { renderVisualDirection } from "@/lib/visual-direction";
import { safePublicError } from "@/lib/public-error";
import { LIVE } from "@/services/creative-library";
import { failJob, runJobItems, type JobStep } from "@/services/jobs";
import { writeBatchScript, writeBatchStoryboard } from "./batch-workers";

export const CREATIVE_BATCH_TOPIC = "creativeintel-creative-batch";

export async function enqueueCreativeBatch(jobId: string, delaySeconds = 0) {
  await send(CREATIVE_BATCH_TOPIC, { jobId }, {
    delaySeconds,
    retentionSeconds: 86_400,
    idempotencyKey: `creative-batch:${jobId}:${Math.floor((Date.now() + delaySeconds * 1000) / 15_000)}`,
  });
}

type ScriptInput = {
  templateIds?: string[];
  angles?: ScriptAngle[];
  videoType?: string | null;
  totalDurationSec?: number;
  customBrief?: string | null;
};
type StoryboardInput = {
  visualDirection?: { lighting?: string; style?: string; notes?: string };
};

/** A database checkpoint and lease make Queue's at-least-once delivery resumable. */
export async function processCreativeBatch(message: { jobId: string }) {
  if (!message || typeof message.jobId !== "string") return;
  const release = await acquireSharedSlot(`creative-batch:${message.jobId}`, 1, 330_000, 0);
  if (!release) {
    await enqueueCreativeBatch(message.jobId, 30);
    return;
  }
  try {
    const job = await prisma.job.findUnique({ where: { id: message.jobId } });
    if (!job || !["queued", "running"].includes(job.status)) return;
    const keys = ((job.steps as unknown as JobStep[] | null) ?? []).map((step) => step.key);
    let status: string;
    if (job.kind === "scripts") {
      const input = (job.input ?? {}) as ScriptInput;
      const ctx = await loadScriptContext(job.projectId);
      if (!ctx) throw new Error("Project not found");
      const templates = keys.map(getScriptTemplate).filter((item): item is ScriptTemplate => item !== null);
      if (templates.length !== keys.length) throw new Error("A script template is no longer available");
      const requestedType = (input.videoType ?? "").toUpperCase();
      const options = {
        angles: Array.isArray(input.angles) ? input.angles : [],
        overrideType: isVideoType(requestedType) ? requestedType : null,
        totalDurationSec: Number(input.totalDurationSec) || ctx.totalDurationSec,
        customBrief: input.customBrief ?? undefined,
      };
      const claimsAudit = auditContext(ctx);
      status = await runJobItems(job.id, templates, (template) => ({ key: template.id, label: template.name }),
        (template, index) => writeBatchScript(job.projectId, ctx, claimsAudit, template, index, options),
        { concurrency: 4, deadlineMs: 120_000, requeueOnDeadline: true });
    } else if (job.kind === "storyboards") {
      const input = (job.input ?? {}) as StoryboardInput;
      const [project, scripts, campaignSel, brandKit, brandTruth] = await Promise.all([
        prisma.project.findUnique({ where: { id: job.projectId } }),
        prisma.script.findMany({ where: { id: { in: keys }, projectId: job.projectId, ...LIVE } }),
        prisma.campaignSelection.findUnique({ where: { projectId: job.projectId } }).catch(() => null),
        prisma.brandKit.findUnique({ where: { projectId: job.projectId } }).catch(() => null),
        getBrandTruthForPrompts(job.projectId).catch(() => ""),
      ]);
      if (!project) throw new Error("Project not found");
      const byId = new Map(scripts.map((script) => [script.id, script]));
      const ordered = keys.map((key) => byId.get(key));
      if (ordered.some((script) => !script)) throw new Error("A selected script is no longer available");
      const extras = {
        brandTruth: brandTruth || undefined,
        approvedOffer: brandKit?.offerText || undefined,
        visualDirection: renderVisualDirection(input.visualDirection) || undefined,
      };
      status = await runJobItems(job.id, ordered as typeof scripts,
        (script) => ({ key: script.id, label: script.title }),
        (script) => writeBatchStoryboard(job.projectId, script, project, campaignSel, extras),
        { concurrency: 4, deadlineMs: 120_000, requeueOnDeadline: true });
    } else {
      return;
    }
    if (status === "queued") {
      // The DB row is the outbox. Cron will republish it if this send fails.
      await enqueueCreativeBatch(job.id, 10).catch((error: unknown) => {
        console.error(`[creative-batch] republish failed for ${job.id}`, error);
      });
    }
  } catch (error) {
    await failJob(message.jobId, safePublicError(error));
    throw error;
  } finally {
    await release();
  }
}

/** Periodically republish unfinished rows if a send or callback was lost. */
export async function recoverCreativeBatchQueue(limit = 100) {
  const jobs = await prisma.job.findMany({
    where: { kind: { in: ["scripts", "storyboards"] }, status: { in: ["queued", "running"] } },
    select: { id: true }, orderBy: { createdAt: "asc" }, take: limit,
  });
  const results = await Promise.allSettled(jobs.map((job) => enqueueCreativeBatch(job.id)));
  const failures = results.filter((result) => result.status === "rejected").length;
  if (failures) throw new Error(`Failed to republish ${failures} creative batch jobs`);
  return jobs.length;
}
