/**
 * Performance Agent (DB side): load a project's imported results + the element mapping table,
 * learn per creative element, feed bias back into creative selection, and answer questions about
 * the data. The math lives in attribution.ts / stats.ts / bias.ts / ask.ts (pure).
 */
import { prisma } from "@/lib/db";
import { askAnswerSchema, askPrompts, buildStatsTable, uncitedNumbers, type AskLlm, type StatsTableRow } from "./ask";
import { learnElements, type ElementLearning, type LearnOptions, type PerfInputRow } from "./attribution";
import { computeBias, type BiasOptions } from "./bias";
import { elementResolver, type ElementMapEntry } from "./elements";

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Imported rows + mapping entries (PerfElementMap, then ad names kept on runs' variants). */
export async function loadPerfData(projectId: string): Promise<{ rows: PerfInputRow[]; maps: ElementMapEntry[] }> {
  const [raw, maps, runs] = await Promise.all([
    prisma.adPerformance.findMany({
      where: { projectId },
      select: { adName: true, platform: true, impressions: true, views3s: true, thruplays: true, clicks: true, spend: true, conversions: true, perfRevenue: true, dateFrom: true, dateTo: true },
    }),
    prisma.perfElementMap.findMany({ where: { projectId } }).catch(() => []),
    prisma.libtvRun.findMany({ where: { projectId }, select: { id: true, qcReport: true }, orderBy: { createdAt: "desc" }, take: 200 }).catch(() => []),
  ]);
  const rows: PerfInputRow[] = raw.map(({ perfRevenue, ...r }) => ({ ...r, revenue: perfRevenue }));
  const entries: ElementMapEntry[] = maps.map((m) => ({ ...m }));
  // Variant entries may carry their elements (hookId, endCardId, voice, aspect, durationSec…).
  for (const run of runs) {
    const variants = (run.qcReport as { variants?: unknown[] } | null)?.variants;
    if (!Array.isArray(variants)) continue;
    for (const v of variants as Record<string, unknown>[]) {
      const adName = str(v?.adName);
      if (!adName) continue;
      entries.push({ adName, hookId: str(v.hookId), endCardId: str(v.endCardId), voice: str(v.voice), aspect: str(v.aspect), durationSec: numOrNull(v.durationSec), sellingPointId: str(v.sellingPointId), platform: str(v.platform) });
    }
  }
  return { rows, maps: entries };
}

export async function loadElementLearning(projectId: string, opts: LearnOptions = {}): Promise<ElementLearning | null> {
  try {
    const { rows, maps } = await loadPerfData(projectId);
    return rows.length ? learnElements(rows, elementResolver(maps), opts) : null;
  } catch {
    return null;
  }
}

/** Score adjustments for selectCreative (`bias`), {} without data or on any error. */
export async function performanceBias(projectId: string, opts: BiasOptions = {}): Promise<Partial<Record<string, number>>> {
  try {
    const { rows, maps } = await loadPerfData(projectId);
    return rows.length ? computeBias(rows, elementResolver(maps), opts).bias : {};
  } catch {
    return {};
  }
}

/** Upsert mapping-table entries (ad name → elements). */
export async function saveElementMaps(projectId: string, entries: (ElementMapEntry & { runId?: string | null })[]): Promise<number> {
  let n = 0;
  for (const e of entries) {
    const adName = e.adName.trim().slice(0, 300);
    if (!adName) continue;
    const data = { runId: e.runId ?? null, hookId: e.hookId ?? null, endCardId: e.endCardId ?? null, voice: e.voice ?? null, aspect: e.aspect ?? null, durationSec: e.durationSec ?? null, sellingPointId: e.sellingPointId ?? null, platform: e.platform ?? null };
    await prisma.perfElementMap.upsert({ where: { projectId_adName: { projectId, adName } }, create: { projectId, adName, ...data }, update: data });
    n++;
  }
  return n;
}

export interface AskResult {
  answer: string;
  /** The aggregated table the model saw (never raw rows, ≤ 200 lines). */
  table: StatsTableRow[];
  tableText: string;
  truncated: boolean;
  /** Numbers in the answer not found in the table (should be empty). */
  uncited: string[];
  source: "llm" | "no-data" | "error";
  error?: string;
}

const defaultLlm: AskLlm = async ({ system, user }) => {
  const { analyzeWithClaude } = await import("@/services/ai/claude-client");
  return analyzeWithClaude({ systemPrompt: system, userPrompt: user, responseSchema: askAnswerSchema, maxTokens: 900 });
};

export async function askPerformance(projectId: string, question: string, opts: { llm?: AskLlm; seed?: number } = {}): Promise<AskResult> {
  const learning = await loadElementLearning(projectId, { seed: opts.seed ?? 1 });
  if (!learning) {
    return { answer: "No ad results imported for this project yet — import a Meta or TikTok Ads export first.", table: [], tableText: "", truncated: false, uncited: [], source: "no-data" };
  }
  const { rows, text, truncated } = buildStatsTable(learning);
  try {
    const raw = await (opts.llm ?? defaultLlm)(askPrompts(question, text));
    const answer = askAnswerSchema.parse(raw ?? {}).answer.trim();
    if (!answer) throw new Error("model returned no answer");
    return { answer, table: rows, tableText: text, truncated, uncited: uncitedNumbers(answer, text), source: "llm" };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { answer: "The analyst model is unavailable — the table below is the full aggregated picture.", table: rows, tableText: text, truncated, uncited: [], source: "error", error };
  }
}
