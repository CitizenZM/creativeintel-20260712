/**
 * P4 — Ad Studio results back into Xark.
 *   - Deliver: completed runs are listed with the ad name to upload under (adStudioAdName), so the
 *     performance import can tie Meta/TikTok results back to the hook type (`_AS<HookType>` → hookStyle "as:<type>").
 *   - Insights: each finished run's review becomes one Insight (category "adstudio_review"), upserted by run id.
 *   - Next suggestion: hookWinRates() turns AdPerformance rows into click-through rate per Ad Studio hook type;
 *     adstudio-context.ts adds those as votes on top of what research suggested.
 * The pure parts are here (tested); reportDone() and loadXarkContext() call them.
 */
import { prisma } from "@/lib/db";

type J = Record<string, unknown>;
const slug = (t: string) =>
  t.replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).filter(Boolean).slice(0, 4).map((w) => w[0].toUpperCase() + w.slice(1)).join("");
const cap1 = (t: string) => (t ? t[0].toUpperCase() + t.slice(1) : t);

/** Brand_Title_24s_ASResult_EAuto — same shape as the LibTV variant names (variants.ts variantAdName) */
export function adStudioAdName(p: { brand?: string | null; title?: string | null; durationSec?: number | null; hookType: string; engine: string; runId?: string | null }) {
  // R<last 6 of the run id>: ad results can be traced to the exact video (opening, engine, sound), not only its hook type
  return [slug(p.brand ?? "Ad") || "Ad", slug((p.title ?? "Script").replace(/^⚠\s*/, "")) || "Script", p.durationSec ? `${Math.round(p.durationSec)}s` : null, `AS${cap1(p.hookType)}`, `E${cap1(p.engine)}`, p.runId ? `R${p.runId.slice(-6)}` : null]
    .filter(Boolean)
    .join("_");
}

/** "as:result" from an Ad Studio ad name, null otherwise (performance/import.ts parseAdName) */
export const adStudioHookOf = (name: string) => {
  const m = /_AS([A-Za-z]+)(?:_|$)/.exec(name);
  return m ? `as:${m[1].toLowerCase()}` : null;
};

/** LibTV's own hook styles mapped onto Ad Studio hook types: question-led master, contrast, product blast */
const LIBTV_STYLE: Record<string, string> = { q: "question", c: "interrupt", p: "result" };
export const MIN_IMPRESSIONS = 500;

export interface PerfRow { hookStyle: string | null; impressions: number; clicks: number; conversions: number }
export interface HookRate { hookType: string; ads: number; impressions: number; ctr: number; cvr: number }

/** click-through and conversion rate per Ad Studio hook type; types under MIN_IMPRESSIONS are left out (too little data) */
export function hookWinRates(rows: PerfRow[]): HookRate[] {
  const by = new Map<string, { ads: number; impressions: number; clicks: number; conversions: number }>();
  for (const r of rows) {
    const st = (r.hookStyle ?? "").toLowerCase();
    const type = st.startsWith("as:") ? st.slice(3) : LIBTV_STYLE[st];
    if (!type) continue;
    const a = by.get(type) ?? { ads: 0, impressions: 0, clicks: 0, conversions: 0 };
    a.ads += 1; a.impressions += r.impressions || 0; a.clicks += r.clicks || 0; a.conversions += r.conversions || 0;
    by.set(type, a);
  }
  return [...by.entries()]
    .filter(([, a]) => a.impressions >= MIN_IMPRESSIONS)
    .map(([hookType, a]) => ({ hookType, ads: a.ads, impressions: a.impressions, ctr: +(a.clicks / a.impressions).toFixed(4), cvr: a.clicks ? +(a.conversions / a.clicks).toFixed(4) : 0 }))
    .sort((a, b) => b.ctr - a.ctr);
}

/** the Insight row for a finished run's AI review */
export function reviewInsight(run: { id: string; hookType: string; engine: string }, review: unknown) {
  const r = (review ?? {}) as J;
  const scores = (r.scores ?? {}) as Record<string, number>;
  const nums = Object.entries(scores).filter(([, v]) => typeof v === "number");
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a[1] - b[1]);
  const weak = sorted.slice(0, 2).map(([k, v]) => `${k} ${v}`).join(", ");
  const strong = sorted.slice(-2).reverse().map(([k, v]) => `${k} ${v}`).join(", ");
  const avg = nums.reduce((a, [, v]) => a + v, 0) / nums.length;
  return {
    category: "adstudio_review",
    title: `Ad Studio · ${cap1(run.hookType)} hook: strongest ${strong}; weakest ${weak}`,
    description: typeof r.verdict === "string" && r.verdict ? r.verdict.slice(0, 1000) : `AI review of the ${run.hookType} hook video (${run.engine}).`,
    // what to act on next: a weak video teaches more than a strong one (was avg/10, which ranked the worst reviews lowest)
    importance: +Math.max(0.1, 1 - avg / 10).toFixed(2),
    recommendation: `Next video: work on ${sorted[0][0]} (scored ${sorted[0][1]}/10).`,
    evidence: { runId: run.id, hookType: run.hookType, engine: run.engine, scores },
  };
}

/** upsert by run id; never fails the run */
export async function saveReviewInsight(projectId: string, run: { id: string; hookType: string; engine: string }, review: unknown) {
  const row = reviewInsight(run, review);
  if (!row) return null;
  try {
    const old = await prisma.insight.findFirst({ where: { projectId, category: row.category, evidence: { path: ["runId"], equals: run.id } }, select: { id: true } });
    return old
      ? await prisma.insight.update({ where: { id: old.id }, data: row })
      : await prisma.insight.create({ data: { projectId, ...row } });
  } catch {
    return null;
  }
}
