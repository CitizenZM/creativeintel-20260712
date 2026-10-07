/**
 * Client campaign report — one model of everything a client needs to see for a project, rendered as
 * self-contained HTML (report-html.ts) and as .docx (report-docx.ts):
 *   executive summary   LLM narrative over the model's own numbers (validated: it must cite them and
 *                       may not invent dollar figures; otherwise a deterministic summary is used)
 *   product brief       big idea, audience, top selling points with their proof shots
 *   campaign plan       per platform: hooks, end card, beat map
 *   production          runs, hook variants, QC scores, preflight / director scores when present
 *   spend vs budget     from the SpendEntry ledger (services/ops/budget-guard.ts)
 *   performance         hook-style learnings from imported results (performance/learn.ts), when present
 *   next actions        rule-based, from the gaps in the above
 *
 * buildCampaignReportModel is pure apart from the injected narrator; loadReportInputs reads the DB.
 */
import { z } from "zod";
import type { CampaignPlan } from "@/services/creative/campaign-plan.types";
import type { ProductBrief } from "@/services/creative/product-brief";
import type { Learning } from "@/services/performance/learn";
import { HOOK_STYLE_NAME } from "@/services/performance/learn";
import { summarizeSpend, type SpendEntryRecord, type SpendSummary } from "@/services/ops/budget-guard";

// ─── inputs ──────────────────────────────────────────────────────────────────

export interface ReportJob {
  nodeName: string;
  kind: string;
  status: string;
  resultUrl?: string | null;
  settings?: unknown;
}
export interface ReportRun {
  id: string;
  status: string;
  executor: string;
  imageModel?: string | null;
  videoModel?: string | null;
  aspectRatio?: string | null;
  createdAt: Date | string;
  completedAt?: Date | string | null;
  isFinal?: boolean;
  masterMp4Url?: string | null;
  previewMp4Url?: string | null;
  contactSheetUrl?: string | null;
  qcReport?: unknown;
  approvedBudgetUsd?: number | null;
  error?: string | null;
  jobs?: ReportJob[];
}
export interface ReportInputs {
  project: {
    id: string;
    name: string;
    brandName: string;
    productName?: string | null;
    productUrl?: string | null;
    category?: string | null;
    budgetUsd?: number | null;
  };
  brief?: ProductBrief | null;
  plan?: CampaignPlan | null;
  runs: ReportRun[];
  spend: SpendEntryRecord[];
  learning?: Learning | null;
  performanceTotals?: { impressions: number; spend: number; clicks: number; conversions: number } | null;
}

// ─── model ───────────────────────────────────────────────────────────────────

export interface KeyNumber {
  key: string;
  label: string;
  value: string;
}
export interface ReportRunView {
  id: string;
  label: string;
  status: string;
  engine: string;
  models: string;
  createdAt: string;
  isFinal: boolean;
  masterUrl: string | null;
  previewUrl: string | null;
  contactSheetUrl: string | null;
  qc: { passed: number; total: number; pct: number; failed: string[] } | null;
  preflight: { score: number; label: string } | null;
  director: { score: number; summary: string; flagged: number } | null;
  variants: { hookStyle: string; name: string; adName: string; passed: number | null; total: number | null; url: string | null }[];
  keyframes: { node: string; url: string; qcOk: boolean | null; issues: string[] }[];
  keyframeQc: { reviewed: number; passed: number; rerolled: number };
  spentUsd: number;
  approvedBudgetUsd: number | null;
  error: string | null;
}
export interface CampaignReportModel {
  generatedAt: string;
  project: ReportInputs["project"] & { title: string };
  keyNumbers: KeyNumber[];
  executiveSummary: { text: string; source: "llm" | "template"; cited: string[]; note?: string };
  brief: {
    bigIdea: string | null;
    alternates: string[];
    audience: string | null;
    job: string | null;
    sellingPoints: { claim: string; benefit: string; proof: string; evidence: string; score: number | null }[];
    objections: { objection: string; answer: string }[];
    keywords: string[];
  } | null;
  plan: {
    goal: string;
    bigIdea: string;
    platforms: {
      platform: string;
      label: string;
      durationSec: number;
      aspect: string;
      hooks: { name: string; family: string; openingText: string; openingVO: string }[];
      endCard: { name: string; button: string; headline: string | null };
      beats: { t0: number; t1: number; purpose: string; visual: string; onScreenText: string | null }[];
    }[];
  } | null;
  production: {
    runs: ReportRunView[];
    totals: { runs: number; completed: number; failed: number; variants: number; avgQcPct: number | null; keyframeQcPassPct: number | null };
  };
  spend: SpendSummary & { budgetUsd: number | null; usedPct: number | null; byKindLabelled: { label: string; usd: number; calls: number }[] };
  performance: {
    styles: { name: string; ads: number; impressions: number; hookRatePct: number; ctrPct: number; spend: number }[];
    hookWinner: string | null;
    ctrWinner: string | null;
    totals: ReportInputs["performanceTotals"];
  } | null;
  nextActions: string[];
}

export const KIND_LABEL: Record<string, string> = {
  image: "Keyframes (image gen / edit)",
  video: "Video clips",
  vision_qc: "Vision QC & director review",
  llm: "Text LLM",
  tts: "Voiceover (TTS)",
};

const usd = (n: number) => `$${n.toFixed(2)}`;
const pct = (n: number) => `${Math.round(n)}%`;
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : "");
const str = (v: unknown) => (typeof v === "string" ? v : "");
const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function runView(run: ReportRun, spend: SpendEntryRecord[], index: number): ReportRunView {
  const qc = obj(run.qcReport);
  const passed = numOrNull(qc.passed);
  const total = numOrNull(qc.total);
  const checks = Array.isArray(qc.checks) ? (qc.checks as { label?: string; pass?: boolean }[]) : [];
  // Preflight: written by the pre-render gate when present — {score} or {passed,total}.
  const pf = obj(qc.preflight);
  const pfScore = numOrNull(pf.score) ?? (numOrNull(pf.passed) !== null && numOrNull(pf.total) ? (100 * (pf.passed as number)) / (pf.total as number) : null);
  const dir = obj(qc.director);
  const variants = Array.isArray(qc.variants) ? (qc.variants as Record<string, unknown>[]) : [];
  const jobs = run.jobs ?? [];
  const keyframes = jobs
    .filter((j) => j.kind === "image" && j.status === "completed" && j.resultUrl && /^K\d+$/.test(j.nodeName))
    .sort((a, b) => Number(a.nodeName.slice(1)) - Number(b.nodeName.slice(1)))
    .map((j) => {
      const s = obj(j.settings);
      return { node: j.nodeName, url: j.resultUrl!, qcOk: typeof s.qcOk === "boolean" ? s.qcOk : null, issues: Array.isArray(s.qcIssues) ? (s.qcIssues as string[]).slice(0, 3) : [] };
    });
  const images = jobs.filter((j) => j.kind === "image" && !obj(j.settings).compositeLocally);
  const reviewed = images.filter((j) => typeof obj(j.settings).qcOk === "boolean");
  const spentUsd = spend.filter((e) => e.runId === run.id).reduce((s, e) => s + (e.actualUsd ?? e.estUsd), 0);
  return {
    id: run.id,
    label: `Run ${index + 1}${run.isFinal ? " (final)" : ""}`,
    status: run.status,
    engine: run.executor,
    models: [run.imageModel, run.videoModel].filter(Boolean).join(" + "),
    createdAt: iso(run.createdAt),
    isFinal: !!run.isFinal,
    masterUrl: run.masterMp4Url ?? null,
    previewUrl: run.previewMp4Url ?? null,
    contactSheetUrl: run.contactSheetUrl ?? null,
    qc: passed !== null && total ? { passed, total, pct: (100 * passed) / total, failed: checks.filter((c) => c.pass === false).map((c) => str(c.label)).filter(Boolean) } : null,
    preflight: pfScore !== null ? { score: Math.round(pfScore), label: str(pf.label) || "Preflight" } : null,
    director: numOrNull(dir.score) !== null ? { score: dir.score as number, summary: str(dir.summary), flagged: Array.isArray(dir.shotIndexes) ? dir.shotIndexes.length : 0 } : null,
    variants: variants.map((v) => ({
      hookStyle: str(v.hookStyle),
      name: HOOK_STYLE_NAME[str(v.hookStyle)] ?? str(v.hookStyle),
      adName: str(v.adName),
      passed: numOrNull(v.passed),
      total: numOrNull(v.total),
      url: str(v.masterUrl) || null,
    })),
    keyframes,
    keyframeQc: { reviewed: reviewed.length, passed: reviewed.filter((j) => obj(j.settings).qcOk === true).length, rerolled: images.filter((j) => Number(obj(j.settings).qcAttempts) > 0).length },
    spentUsd: Math.round(spentUsd * 10000) / 10000,
    approvedBudgetUsd: run.approvedBudgetUsd ?? null,
    error: run.error ?? null,
  };
}

function briefView(b: ProductBrief | null | undefined): CampaignReportModel["brief"] {
  if (!b) return null;
  const points = [...(b.sellingPoints ?? [])]
    .sort((x, y) => ((y as { priorityScore?: number }).priorityScore ?? 0) - ((x as { priorityScore?: number }).priorityScore ?? 0) || x.priority - y.priority)
    .slice(0, 5);
  return {
    bigIdea: b.bigIdea?.proposition || null,
    alternates: (b.bigIdea?.alternates ?? []).slice(0, 3),
    audience: b.audience?.primary || null,
    job: b.primaryJob?.statement || null,
    sellingPoints: points.map((p) => ({
      claim: p.claim,
      benefit: p.benefit,
      proof: [p.proofVisual?.device, p.proofVisual?.shot].filter(Boolean).join(": ").replace(/_/g, " "),
      evidence: p.evidenceStrength,
      score: (p as { priorityScore?: number }).priorityScore ?? null,
    })),
    objections: (b.objections ?? []).slice(0, 4).map((o) => ({ objection: o.objection, answer: o.answer })),
    keywords: (b.keywords ?? []).slice(0, 10).map((k) => k.term),
  };
}

function planView(p: CampaignPlan | null | undefined): CampaignReportModel["plan"] {
  if (!p?.platforms?.length) return null;
  return {
    goal: p.goal,
    bigIdea: p.bigIdea,
    platforms: p.platforms.map((pl) => ({
      platform: pl.platform,
      label: pl.label,
      durationSec: pl.durationSec,
      aspect: pl.aspect,
      hooks: pl.hookVariants.map((h) => ({ name: h.name, family: h.family, openingText: h.openingText, openingVO: h.openingVO })),
      endCard: { name: pl.endCard.name, button: pl.endCard.button, headline: pl.endCard.headline ?? null },
      beats: pl.beats.map((b) => ({ t0: b.t0, t1: b.t1, purpose: b.purpose, visual: b.visual, onScreenText: b.onScreenText ?? null })),
    })),
  };
}

function nextActions(m: Omit<CampaignReportModel, "nextActions" | "executiveSummary">): string[] {
  const out: string[] = [];
  const runs = m.production.runs;
  const done = runs.filter((r) => r.status === "completed");
  if (!m.brief) out.push("Extract the product brief (operator action product-brief) so scripts sell the right points.");
  if (!m.plan) out.push("Plan the campaign per platform (plan-campaign): hooks, end card and beat map.");
  if (m.spend.budgetUsd == null) out.push("Set a project budget (set-budget) before the next paid render — paid calls are only capped when one is set.");
  else if ((m.spend.usedPct ?? 0) >= 80) out.push(`Budget ${pct(m.spend.usedPct!)} used (${usd(m.spend.totalUsd)} of ${usd(m.spend.budgetUsd)}) — get the owner's approval before more paid renders.`);
  if (!done.length) out.push("Compile and approve a first run (estimate-run first, then set-budget at the forecast's high total).");
  for (const r of done) {
    if (r.qc && r.qc.failed.length) out.push(`${r.label}: fix QC failures — ${r.qc.failed.slice(0, 3).join(", ")}.`);
    if (!r.director) out.push(`${r.label}: run the AI director review before delivery.`);
    else if (r.director.flagged) out.push(`${r.label}: re-render the ${r.director.flagged} shot(s) the director flagged (rerender-shots).`);
  }
  const final = done.find((r) => r.isFinal) ?? done[done.length - 1];
  if (final && final.variants.length < 2) out.push(`${final.label}: render the other hook variants (render-variant q / c / p) for an A/B test.`);
  if (!m.performance) {
    if (done.length) out.push("Launch the A/B variants and import Meta / TikTok results after 3–5 days to find the winning hook style.");
  } else {
    const w = m.performance.ctrWinner ?? m.performance.hookWinner;
    out.push(w ? `Lead new masters with ${w} hooks — the significant winner in real results.` : "No significant hook winner yet — keep all three hook styles in rotation and collect more impressions.");
  }
  return out.slice(0, 8);
}

/** The numbers the summary must stand on (and the KPI tiles). */
function keyNumbers(m: Omit<CampaignReportModel, "nextActions" | "executiveSummary" | "keyNumbers">): KeyNumber[] {
  const t = m.production.totals;
  const k: KeyNumber[] = [
    { key: "runs", label: "Runs", value: String(t.runs) },
    { key: "completed", label: "Completed masters", value: String(t.completed) },
    { key: "variants", label: "Hook variants", value: String(t.variants) },
  ];
  if (t.avgQcPct !== null) k.push({ key: "qc", label: "Avg. master QC", value: pct(t.avgQcPct) });
  if (t.keyframeQcPassPct !== null) k.push({ key: "kfqc", label: "Keyframes passing QC", value: pct(t.keyframeQcPassPct) });
  k.push({ key: "spent", label: "Spent", value: usd(m.spend.totalUsd) });
  if (m.spend.budgetUsd != null) k.push({ key: "budget", label: "Budget", value: usd(m.spend.budgetUsd) });
  if (m.performance?.totals?.impressions) k.push({ key: "impressions", label: "Impressions", value: m.performance.totals.impressions.toLocaleString("en-US") });
  return k;
}

export function templateSummary(m: Omit<CampaignReportModel, "executiveSummary">): string {
  const n = Object.fromEntries(m.keyNumbers.map((k) => [k.key, k.value]));
  const parts: string[] = [];
  const title = m.project.title;
  parts.push(
    m.brief?.bigIdea
      ? `${title} is positioned on one idea: “${m.brief.bigIdea.replace(/[.!\s]+$/, "")}”.`
      : `${title}: the product brief has not been extracted yet.`
  );
  if (m.plan) parts.push(`The plan covers ${m.plan.platforms.length} platform(s) (${m.plan.platforms.map((p) => p.label).join(", ")}), each with ${m.plan.platforms[0]?.hooks.length ?? 0} opening hooks and a dedicated end card.`);
  parts.push(`Production: ${n.runs} run(s), ${n.completed} completed master(s) and ${n.variants} hook variant(s)${n.qc ? `, averaging ${n.qc} on the measured master QC` : ""}${n.kfqc ? `; ${n.kfqc} of reviewed keyframes passed vision QC` : ""}.`);
  parts.push(n.budget ? `Spend is ${n.spent} against an approved ${n.budget}.` : `Spend to date is ${n.spent} (no budget cap set).`);
  if (m.performance) {
    const w = m.performance.ctrWinner ?? m.performance.hookWinner;
    parts.push(w ? `Real results favour ${w} hooks.` : `Real results show no significant hook winner yet${n.impressions ? ` over ${n.impressions} impressions` : ""}.`);
  }
  if (m.nextActions[0]) parts.push(`Next: ${m.nextActions[0]}`);
  return parts.join(" ");
}

/** The narrative must quote the model's numbers and may not introduce dollar or percent figures of its own. */
export function checkNarrative(text: string, numbers: KeyNumber[]): { ok: boolean; cited: string[]; unknown: string[] } {
  const values = numbers.map((n) => n.value);
  const cited = values.filter((v) => text.includes(v));
  const allowed = new Set(values);
  const unknown = (text.match(/\$\d[\d,]*(?:\.\d+)?|\d+(?:\.\d+)?%/g) ?? []).filter((x) => !allowed.has(x));
  const need = Math.min(3, values.length);
  return { ok: cited.length >= need && unknown.length === 0 && text.trim().length >= 80, cited, unknown };
}

export type Narrator = (input: { system: string; user: string }) => Promise<string>;

export const NARRATIVE_SYSTEM = `You write the executive summary of a client report for a paid-social video-ad campaign. 4–6 sentences, plain business English, no headings, no bullet points.
Use ONLY the facts given. Quote every number exactly as written in KEY NUMBERS (same format, e.g. "$8.12", "87%"); never compute, round or invent other figures.
Cover: the positioning idea, what was produced and its quality, spend against budget, what real results say (if any), and the single most important next step.
Return JSON: {"summary": "..."}`;

function narrativePrompt(m: Omit<CampaignReportModel, "executiveSummary">): string {
  return [
    `PROJECT: ${m.project.title}`,
    `KEY NUMBERS:\n${m.keyNumbers.map((k) => `- ${k.label}: ${k.value}`).join("\n")}`,
    m.brief?.bigIdea ? `BIG IDEA: ${m.brief.bigIdea}` : "BIG IDEA: (no brief yet)",
    m.brief?.sellingPoints.length ? `TOP SELLING POINTS: ${m.brief.sellingPoints.slice(0, 3).map((p) => p.claim).join("; ")}` : "",
    m.plan ? `PLATFORMS: ${m.plan.platforms.map((p) => `${p.label} (${p.durationSec}s, end card ${p.endCard.name})`).join("; ")}` : "",
    m.performance ? `RESULTS: hook winner ${m.performance.hookWinner ?? "none significant"}, CTR winner ${m.performance.ctrWinner ?? "none significant"}` : "RESULTS: none imported yet",
    `NEXT ACTIONS:\n${m.nextActions.map((a) => `- ${a}`).join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Default narrator: one text-model call, guarded by the project's budget. */
export const llmNarrator =
  (projectId: string): Narrator =>
  async ({ system, user }) => {
    const { analyzeWithClaude } = await import("@/services/ai/claude-client");
    const { guardLlm } = await import("@/services/ops/spend");
    const out = await guardLlm({ projectId, kind: "llm" }, { inTokens: 1500, outTokens: 500 }, () =>
      analyzeWithClaude({ systemPrompt: system, userPrompt: user, responseSchema: z.object({ summary: z.string() }), maxTokens: 700, tier: "standard" })
    );
    return out.summary;
  };

export async function buildCampaignReportModel(input: ReportInputs, opts: { narrator?: Narrator | null; now?: Date } = {}): Promise<CampaignReportModel> {
  const runs = [...input.runs].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()).map((r, i) => runView(r, input.spend, i));
  const done = runs.filter((r) => r.status === "completed");
  const qcRuns = done.filter((r) => r.qc);
  const kfReviewed = runs.reduce((s, r) => s + r.keyframeQc.reviewed, 0);
  const kfPassed = runs.reduce((s, r) => s + r.keyframeQc.passed, 0);
  const summary = summarizeSpend(input.spend, { projectBudgetUsd: input.project.budgetUsd ?? null });
  const budgetUsd = input.project.budgetUsd ?? null;
  const l = input.learning;
  const base = {
    generatedAt: (opts.now ?? new Date()).toISOString(),
    project: { ...input.project, title: [input.project.brandName, input.project.productName].filter(Boolean).join(" ") || input.project.name },
    brief: briefView(input.brief),
    plan: planView(input.plan),
    production: {
      runs,
      totals: {
        runs: runs.length,
        completed: done.length,
        failed: runs.filter((r) => r.status === "failed").length,
        variants: runs.reduce((s, r) => s + r.variants.length, 0),
        avgQcPct: qcRuns.length ? qcRuns.reduce((s, r) => s + r.qc!.pct, 0) / qcRuns.length : null,
        keyframeQcPassPct: kfReviewed ? (100 * kfPassed) / kfReviewed : null,
      },
    },
    spend: {
      ...summary,
      budgetUsd,
      usedPct: budgetUsd ? (100 * summary.totalUsd) / budgetUsd : null,
      byKindLabelled: summary.byKind.map((b) => ({ label: KIND_LABEL[b.key] ?? b.key, usd: b.usd, calls: b.calls })),
    },
    performance:
      l && l.styles.length
        ? {
            styles: l.styles.map((s) => ({ name: HOOK_STYLE_NAME[s.hookStyle] ?? s.hookStyle, ads: s.ads, impressions: s.impressions, hookRatePct: s.hookRate * 100, ctrPct: s.ctr * 100, spend: s.spend })),
            hookWinner: l.hookWinner ? (HOOK_STYLE_NAME[l.hookWinner.hookStyle] ?? l.hookWinner.hookStyle) : null,
            ctrWinner: l.ctrWinner ? (HOOK_STYLE_NAME[l.ctrWinner.hookStyle] ?? l.ctrWinner.hookStyle) : null,
            totals: input.performanceTotals ?? null,
          }
        : null,
  };
  const withNumbers = { ...base, keyNumbers: keyNumbers(base) };
  const model = { ...withNumbers, nextActions: nextActions(withNumbers as never) };
  const fallback = templateSummary(model);
  let executiveSummary: CampaignReportModel["executiveSummary"] = { text: fallback, source: "template", cited: checkNarrative(fallback, model.keyNumbers).cited };
  if (opts.narrator) {
    try {
      const text = (await opts.narrator({ system: NARRATIVE_SYSTEM, user: narrativePrompt(model) })).trim();
      const check = checkNarrative(text, model.keyNumbers);
      executiveSummary = check.ok
        ? { text, source: "llm", cited: check.cited }
        : { ...executiveSummary, note: `LLM narrative rejected (cited ${check.cited.length} numbers${check.unknown.length ? `, invented ${check.unknown.join(", ")}` : ""})` };
    } catch (err) {
      executiveSummary = { ...executiveSummary, note: `LLM narrative unavailable: ${(err instanceof Error ? err.message : String(err)).slice(0, 160)}` };
    }
  }
  return { ...model, executiveSummary };
}

// ─── loading ─────────────────────────────────────────────────────────────────

export async function loadReportInputs(projectId: string): Promise<ReportInputs | null> {
  const { prisma } = await import("@/lib/db");
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, brandName: true, productName: true, productUrl: true, category: true, productBrief: true, campaignPlan: true, budgetUsd: true },
  });
  if (!project) return null;
  const [runs, spend, learning, perf] = await Promise.all([
    prisma.libtvRun.findMany({
      where: { projectId },
      orderBy: { createdAt: "asc" },
      take: 30,
      include: { jobs: { select: { nodeName: true, kind: true, status: true, resultUrl: true, settings: true } } },
    }),
    (async () => {
      const { spendLedger } = await import("@/services/ops/budget-guard");
      return (await spendLedger()).entries({ projectId }).catch(() => [] as SpendEntryRecord[]);
    })(),
    import("@/services/performance/store").then((m) => m.loadLearning(projectId)).catch(() => null),
    prisma.adPerformance.aggregate({ where: { projectId }, _sum: { impressions: true, spend: true, clicks: true, conversions: true } }).catch(() => null),
  ]);
  const { productBrief, campaignPlan, ...p } = project;
  return {
    project: p,
    brief: (productBrief as ProductBrief | null) ?? null,
    plan: (campaignPlan as CampaignPlan | null) ?? null,
    runs: runs.map((r) => ({ ...r, jobs: r.jobs })),
    spend,
    learning,
    performanceTotals: perf?._sum.impressions ? { impressions: perf._sum.impressions ?? 0, spend: perf._sum.spend ?? 0, clicks: perf._sum.clicks ?? 0, conversions: perf._sum.conversions ?? 0 } : null,
  };
}
