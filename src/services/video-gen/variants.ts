/**
 * Hook A/B variants of a finished server run (edit engine v2): the same clips
 * and body with a different first second — contrast (c) and product blast (p)
 * next to the question-led master (q). Rendered on demand (Studio button,
 * operator) and automatically by the hook-variants cron for every new master,
 * one variant per invocation. Results live on LibtvRun.qcReport.variants.
 */
import { prisma } from "@/lib/db";
import { renderHookVariant } from "./glm-assemble";
import { isServerEngine } from "./libtv-pricing";
import { storyboardFrames } from "./server-executor";
import { loadLearning } from "@/services/performance/store";

export type HookStyle = "q" | "c" | "p";
export const AUTO_STYLES: HookStyle[] = ["c", "p"];
/** A claim older than this was killed mid-render: render it again. */
const PENDING_STALE_MS = 8 * 60_000;

export interface VariantEntry {
  hookStyle: string;
  hookText: string | null;
  masterUrl: string;
  previewUrl: string | null;
  passed: number;
  total: number;
  createdAt: string;
  /** A/B-ready ad name, e.g. TCL_TclQm7lSeriesTv_20s_HookC. */
  adName?: string;
}

type Qc = Record<string, unknown> & { variants?: VariantEntry[]; variantsPending?: Record<string, string> };

function qcOf(run: { qcReport: unknown }): Qc {
  return run.qcReport && typeof run.qcReport === "object" ? (run.qcReport as Qc) : {};
}

/** The styles a run still lacks (pending claims younger than the stale limit count as present). */
export function missingStyles(qc: Qc, now = Date.now(), styles?: HookStyle[]): HookStyle[] {
  // Variants cover the hook styles the master doesn't use.
  const master = typeof qc.hookStyle === "string" ? qc.hookStyle : "q";
  styles ??= (["q", "c", "p"] as HookStyle[]).filter((s) => s !== master);
  const done = new Set((qc.variants ?? []).map((v) => v.hookStyle));
  const pending = qc.variantsPending ?? {};
  return styles.filter((s) => !done.has(s) && !(pending[s] && now - Date.parse(pending[s]) < PENDING_STALE_MS));
}

/** A/B-ready file name: Brand_Script_20s_HookC. */
export function variantAdName(parts: { brand?: string | null; title?: string | null; durationSec?: number | null; hookStyle: string }): string {
  const slug = (t: string) =>
    t
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .split(/\s+/)
      .slice(0, 4)
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join("");
  return [slug(parts.brand ?? "Ad"), slug(parts.title ?? "Script"), parts.durationSec ? `${Math.round(parts.durationSec)}s` : null, `Hook${parts.hookStyle.toUpperCase()}`]
    .filter(Boolean)
    .join("_");
}

async function setPending(runId: string, style: HookStyle, at: string | null) {
  const run = await prisma.libtvRun.findUnique({ where: { id: runId }, select: { qcReport: true } });
  const qc = qcOf(run ?? { qcReport: null });
  const pending = { ...(qc.variantsPending ?? {}) };
  if (at) pending[style] = at;
  else delete pending[style];
  await prisma.libtvRun.update({ where: { id: runId }, data: { qcReport: { ...qc, variantsPending: pending } as never } });
}

/** Render one hook variant of a completed server run and keep it on the run. */
export async function renderVariantForRun(runId: string, style: HookStyle, hookText?: string | null): Promise<VariantEntry> {
  const run = await prisma.libtvRun.findUnique({ where: { id: runId } });
  if (!run) throw new Error("Run not found");
  if (!isServerEngine(run.executor) || run.status !== "completed") throw new Error(`Only completed server runs can get variants (status ${run.status})`);
  await setPending(runId, style, new Date().toISOString());
  try {
    const jobs = await prisma.libtvJob.findMany({ where: { runId } });
    const frames = await storyboardFrames(run.storyboardId);
    const v = await renderHookVariant({ runId, projectId: run.projectId, aspectRatio: run.aspectRatio, frames, jobs, hookStyle: style, hookText });
    const [project, script] = await Promise.all([
      prisma.project.findUnique({ where: { id: run.projectId }, select: { brandName: true } }),
      run.scriptId ? prisma.script.findUnique({ where: { id: run.scriptId }, select: { title: true, totalDurationSec: true } }) : null,
    ]);
    const entry: VariantEntry = {
      adName: variantAdName({ brand: project?.brandName, title: script?.title?.replace(/^⚠\s*/, ""), durationSec: script?.totalDurationSec, hookStyle: style }),
      hookStyle: v.hookStyle,
      hookText: v.hookText,
      masterUrl: v.masterUrl,
      previewUrl: v.previewUrl,
      passed: v.qc.passed,
      total: v.qc.total,
      createdAt: new Date().toISOString(),
    };
    const fresh = await prisma.libtvRun.findUnique({ where: { id: runId }, select: { qcReport: true } });
    const qc = qcOf(fresh ?? { qcReport: null });
    const pending = { ...(qc.variantsPending ?? {}) };
    delete pending[style];
    const variants = [...(qc.variants ?? []).filter((x) => x.hookStyle !== style), entry];
    await prisma.libtvRun.update({ where: { id: runId }, data: { qcReport: { ...qc, variants, variantsPending: pending } as never } });
    return entry;
  } catch (err) {
    await setPending(runId, style, null).catch(() => {});
    throw err;
  }
}

/**
 * Cron: give the newest finished v2 master (last 3 days) its next missing hook
 * variant. One variant per call — each is a full ~2–3 min render.
 */
export async function advanceAutoVariants(): Promise<{ runId: string; style: HookStyle } | null> {
  if (process.env.AUTO_HOOK_VARIANTS === "off") return null;
  const since = new Date(Date.now() - 3 * 86_400_000);
  const runs = await prisma.libtvRun.findMany({
    where: { status: "completed", completedAt: { gte: since }, executor: { in: ["glm", "matrix", "comfyui", "animatic"] } },
    orderBy: { completedAt: "desc" },
    select: { id: true, projectId: true, qcReport: true },
    take: 20,
  });
  for (const r of runs) {
    const qc = qcOf(r);
    if (qc.engine !== "edit-v2") continue;
    // Evidence first: the style real results favour is rendered before the others.
    const order = (await loadLearning(r.projectId))?.order ?? [];
    const style = missingStyles(qc).sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99))[0];
    if (!style) continue;
    await renderVariantForRun(r.id, style);
    return { runId: r.id, style };
  }
  return null;
}
