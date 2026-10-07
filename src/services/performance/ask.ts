/**
 * "Ask the data": a compact aggregated stats table (element level × metrics, never raw rows, never
 * over 200 lines) plus the A/B verdicts, handed to one text-model call that must cite numbers from
 * the table only. Pure — the model call is injected.
 */
import { z } from "zod";
import type { ElementLearning, Metrics, RateMetric } from "./attribution";

export interface StatsTableRow extends Metrics {
  dim: string;
  level: string;
  ads: number;
  impressions: number;
  spend: number;
  conversions: number;
  pBestHookRate: number | null;
  pBestCtr: number | null;
}

export const MAX_TABLE_ROWS = 200;

const pct = (v: number | null, d = 2) => (v == null ? "-" : `${(v * 100).toFixed(d)}%`);
const money = (v: number | null) => (v == null ? "-" : v.toFixed(2));
const int = (v: number) => Math.round(v).toLocaleString("en-US");

export function buildStatsTable(l: ElementLearning, maxRows = MAX_TABLE_ROWS): { rows: StatsTableRow[]; text: string; truncated: boolean } {
  const cap = Math.max(1, Math.min(maxRows, MAX_TABLE_ROWS));
  const t = l.totals;
  const rows: StatsTableRow[] = [
    { dim: "all", level: "all", ads: t.ads, impressions: t.impressions, spend: t.spend, conversions: t.conversions, hookRate: t.hookRate, holdRate: t.holdRate, ctr: t.ctr, cpc: t.cpc, cpm: t.cpm, cvr: t.cvr, cpa: t.cpa, roas: t.roas, pBestHookRate: null, pBestCtr: null },
  ];
  let truncated = false;
  const verdicts: string[] = [];
  for (const d of l.dims) {
    const pb = (m: RateMetric, level: string) => d.tests[m]?.arms.find((a) => a.level === level)?.pBest ?? null;
    for (const s of d.levels) {
      if (rows.length >= cap) {
        truncated = true;
        break;
      }
      rows.push({ dim: d.dim, level: s.level, ads: s.ads, impressions: s.impressions, spend: s.spend, conversions: s.conversions, hookRate: s.hookRate, holdRate: s.holdRate, ctr: s.ctr, cpc: s.cpc, cpm: s.cpm, cvr: s.cvr, cpa: s.cpa, roas: s.roas, pBestHookRate: pb("hookRate", s.level), pBestCtr: pb("ctr", s.level) });
    }
    for (const [metric, r] of Object.entries(d.tests)) {
      if (!r) continue;
      const lead = r.winner
        ? `WINNER ${r.winner.level} (P(best) ${pct(r.winner.pBest, 1)}, ${r.winner.liftVsRunnerUp == null ? "" : `lift vs runner-up ${pct(r.winner.liftVsRunnerUp, 1)}, `}rule ${r.winner.rule})`
        : r.status === "no_winner"
          ? `no winner yet (${r.note})`
          : `insufficient data (${r.note})`;
      verdicts.push(`${d.dim} / ${metric}: ${lead}`);
    }
  }
  const header = "dim | level | ads | impressions | spend | conversions | hook rate | hold rate | CTR | CPC | CPM | CVR | CPA | ROAS | P(best) hook rate | P(best) CTR";
  const lines = rows.map((r) =>
    [r.dim, r.level, r.ads, int(r.impressions), money(r.spend), int(r.conversions), pct(r.hookRate), pct(r.holdRate), pct(r.ctr), money(r.cpc), money(r.cpm), pct(r.cvr), money(r.cpa), r.roas == null ? "-" : r.roas.toFixed(2), pct(r.pBestHookRate, 1), pct(r.pBestCtr, 1)].join(" | ")
  );
  const text = [
    `STATS TABLE (${l.rows} imported ad rows, aggregated; ${rows.length} lines${truncated ? `, truncated at ${cap}` : ""})`,
    header,
    ...lines,
    "",
    "A/B VERDICTS (Bayesian: winner at P(best) ≥ 95% or expected loss < 1% of the rate; min-sample guard per metric)",
    ...(verdicts.length ? verdicts : ["none — fewer than two levels per element"]),
  ].join("\n");
  return { rows, text, truncated };
}

export const askAnswerSchema = z.object({ answer: z.string().catch(""), cited: z.array(z.string()).catch([]) });
export type AskLlm = (args: { system: string; user: string }) => Promise<unknown>;

export function askPrompts(question: string, tableText: string): { system: string; user: string } {
  const system = `You are CreativeIntel's paid-media performance analyst. Answer the advertiser's question from the STATS TABLE and A/B VERDICTS only.
Rules:
- Every number you write must appear in the table exactly as written there (same rounding, same % sign). Never compute new numbers, never bring outside benchmarks.
- Name the element levels (hook ids, end cards, platforms…) the numbers belong to.
- Say whether a difference is a called winner (from the verdicts) or still noise / insufficient data.
- If the table cannot answer, say which data is missing (e.g. no conversion-value column → no ROAS).
- Be direct and commercial: what to scale, what to kill, what to test next. ≤ 150 words.
Output JSON only: {"answer": string, "cited": [the table cells you used, verbatim]}.`;
  return { system, user: `QUESTION: ${question.trim().slice(0, 500)}\n\n${tableText}` };
}

const NUM = /\d[\d,]*(?:\.\d+)?/g;
const normNum = (s: string) => s.replace(/,/g, "").replace(/^0+(?=\d)/, "");

/** Numbers in the answer (2+ significant characters) that don't appear in the table text. */
export function uncitedNumbers(answer: string, tableText: string): string[] {
  const known = new Set((tableText.match(NUM) ?? []).map(normNum));
  const out = new Set<string>();
  for (const m of answer.match(NUM) ?? []) {
    const n = normNum(m);
    if (n.replace(".", "").length < 2) continue;
    if (!known.has(n)) out.add(m);
  }
  return [...out];
}
