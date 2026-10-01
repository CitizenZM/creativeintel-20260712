import { prisma } from "@/lib/db";
import type { PerfRow } from "./import";
import { learn, type Learning } from "./learn";

/** Upsert imported rows (same platform + ad name + start date = same row). */
export async function saveRows(projectId: string, rows: PerfRow[], source = "csv"): Promise<number> {
  let n = 0;
  for (const r of rows) {
    const data = {
      platform: r.platform,
      source,
      adName: r.adName.slice(0, 300),
      hookStyle: r.hookStyle,
      format: r.format,
      dateFrom: r.dateFrom,
      dateTo: r.dateTo,
      impressions: r.impressions,
      views3s: r.views3s,
      thruplays: r.thruplays,
      clicks: r.clicks,
      spend: r.spend,
      conversions: r.conversions,
    };
    const existing = await prisma.adPerformance.findFirst({ where: { projectId, platform: r.platform, adName: data.adName, dateFrom: r.dateFrom } });
    if (existing) await prisma.adPerformance.update({ where: { id: existing.id }, data });
    else await prisma.adPerformance.create({ data: { projectId, ...data } });
    n++;
  }
  return n;
}

/** What this project's real results say (null without data). */
export async function loadLearning(projectId: string): Promise<Learning | null> {
  try {
    const rows = await prisma.adPerformance.findMany({ where: { projectId }, select: { hookStyle: true, impressions: true, views3s: true, clicks: true, spend: true } });
    return rows.length ? learn(rows) : null;
  } catch {
    return null;
  }
}

/** The hook style real results favour for new masters (q when nothing is significant). */
export async function winningHookStyle(projectId: string | null | undefined): Promise<"q" | "c" | "p"> {
  if (!projectId) return "q";
  const l = await loadLearning(projectId);
  const w = l?.ctrWinner?.hookStyle ?? l?.hookWinner?.hookStyle;
  return w === "c" || w === "p" ? w : "q";
}
