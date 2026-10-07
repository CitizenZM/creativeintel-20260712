/**
 * Cron heartbeat: each Vercel cron records that it ran (one CronHeartbeat row per cron, upserted), so the
 * ops health monitor and /status can tell a silent cron from an idle one. Never throws.
 */
import { prisma } from "@/lib/db";

export async function cronHeartbeat(name: string, at: Date = new Date()): Promise<void> {
  try {
    await prisma.cronHeartbeat.upsert({ where: { name }, create: { name, lastRunAt: at, runs: 1 }, update: { lastRunAt: at, runs: { increment: 1 } } });
  } catch (err) {
    console.warn(`[cron-heartbeat] ${name}:`, err instanceof Error ? err.message.slice(0, 200) : err);
  }
}
