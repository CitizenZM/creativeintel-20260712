/**
 * Pure view-model helpers for the Studio / Deliver workbench: spend + budget, Batch Mode, localization,
 * pre-flight, image ads, test plan and report links. No React, no I/O — tested in view-model.test.ts.
 * Shapes mirror the service types (imported as types only, so client bundles stay light).
 */
import type { BatchMatrix, BatchVariant, BatchVariantStatus } from "@/services/creative/batch-matrix";
import type { Phase } from "@/services/creative/test-plan";
import type { ImageAdItem, ImageAdSet } from "@/services/image-ads/generate";
import type { SpendBucket, SpendSummary } from "@/services/ops/budget-guard";
import type { CostLine, Range, RunCostForecast } from "@/services/ops/cost-model";
import type { PreflightCheck, PreflightReport } from "@/services/video-gen/preflight/types";

// ── Money ───────────────────────────────────────────────────────────────────────────────────────────

/** "$1,234" over $1k, "$12.34" under, "<$0.01" for a non-zero fraction of a cent, "—" when unknown. */
export function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  if (a === 0) return "$0.00";
  if (a < 0.01) return `${sign}<$0.01`;
  if (a >= 1000) return `${sign}$${Math.round(a).toLocaleString("en-US")}`;
  return `${sign}$${a.toFixed(2)}`;
}

/** "$1.20–$3.40" (or one figure when low = high). */
export function fmtRange(r: Range | null | undefined): string {
  if (!r) return "—";
  const lo = fmtUsd(r.low);
  const hi = fmtUsd(r.high);
  return lo === hi ? lo : `${lo}–${hi}`;
}

const fmtQty = (q: Range) => (q.low === q.high ? `${q.expected}` : `${q.low}–${q.high} (≈${+q.expected.toFixed(1)})`);

export interface ForecastRow {
  key: string;
  label: string;
  model: string;
  qty: string;
  unit: string;
  low: string;
  expected: string;
  high: string;
  source: string;
}

export interface ForecastView {
  rows: ForecastRow[];
  totals: { low: string; expected: string; high: string; range: string };
  warnings: string[];
  pricesAsOf: string;
  free: boolean;
}

export function forecastView(f: RunCostForecast | null | undefined): ForecastView | null {
  if (!f) return null;
  const rows = f.lines.map((l: CostLine, i): ForecastRow => ({
    key: `${l.kind}-${i}`,
    label: l.label,
    model: l.model,
    qty: fmtQty(l.qty),
    unit: fmtUsd(l.unitUsd),
    low: fmtUsd(l.usd.low),
    expected: fmtUsd(l.usd.expected),
    high: fmtUsd(l.usd.high),
    source: l.source,
  }));
  return {
    rows,
    totals: { low: fmtUsd(f.totals.low), expected: fmtUsd(f.totals.expected), high: fmtUsd(f.totals.high), range: fmtRange(f.totals) },
    warnings: f.warnings ?? [],
    pricesAsOf: f.pricesAsOf,
    free: f.totals.high === 0,
  };
}

// ── Budget ──────────────────────────────────────────────────────────────────────────────────────────

export type BudgetTone = "none" | "ok" | "warn" | "over";

export interface BudgetView {
  budget: string;
  spent: string;
  remaining: string;
  /** 0–100 (clamped) share of the cap spent; null without a cap. */
  pct: number | null;
  tone: BudgetTone;
  label: string;
}

export function budgetView(b: { budgetUsd: number | null; spentUsd: number | null | undefined }): BudgetView {
  const spent = b.spentUsd ?? 0;
  if (b.budgetUsd == null) {
    return { budget: "No cap", spent: fmtUsd(spent), remaining: "—", pct: null, tone: "none", label: "No budget set — paid calls are not capped." };
  }
  const ratio = b.budgetUsd > 0 ? spent / b.budgetUsd : spent > 0 ? Infinity : 0;
  const tone: BudgetTone = ratio > 1 - 1e-9 && spent > 0 ? "over" : ratio >= 0.8 ? "warn" : "ok";
  const remaining = b.budgetUsd - spent;
  return {
    budget: fmtUsd(b.budgetUsd),
    spent: fmtUsd(spent),
    remaining: fmtUsd(remaining),
    pct: Math.max(0, Math.min(100, Math.round((Number.isFinite(ratio) ? ratio : 1) * 100))),
    tone,
    label: tone === "over" ? "Budget used up — paid calls are refused until you raise it." : tone === "warn" ? `${fmtUsd(remaining)} left (over 80 % used).` : `${fmtUsd(remaining)} left.`,
  };
}

export type BudgetInput = { ok: true; usd: number | null } | { ok: false; error: string };

/** The set-budget field: blank removes the cap; otherwise 0–10,000 USD, cents precision. */
export function parseBudgetInput(raw: string): BudgetInput {
  const s = raw.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!s) return { ok: true, usd: null };
  if (!/^\d+(\.\d+)?$/.test(s)) return { ok: false, error: "Enter a dollar amount, e.g. 25 or 12.50 (blank removes the cap)." };
  const n = Math.round(Number(s) * 100) / 100;
  if (n > 10_000) return { ok: false, error: "The cap can't be above $10,000." };
  return { ok: true, usd: n };
}

// ── Ledger ──────────────────────────────────────────────────────────────────────────────────────────

export const SPEND_KIND_LABEL: Record<string, string> = {
  image: "Images (keyframes)",
  video: "Video clips",
  vision_qc: "Vision QC",
  llm: "Text model",
  tts: "Voiceover",
};

export interface LedgerRow {
  key: string;
  label: string;
  calls: number;
  usd: string;
  /** Unreconciled part, shown when actual ≠ estimate. */
  estimate: string | null;
  /** Share of the total, 0–100. */
  share: number;
}

export interface LedgerGroup {
  id: "kind" | "model" | "run";
  title: string;
  rows: LedgerRow[];
}

const shortId = (id: string) => (id.length > 12 ? `${id.slice(0, 4)}…${id.slice(-6)}` : id);

function ledgerRows(buckets: SpendBucket[], total: number, label: (k: string) => string): LedgerRow[] {
  return [...buckets]
    .sort((a, b) => b.usd - a.usd || b.calls - a.calls || a.key.localeCompare(b.key))
    .map((b) => ({
      key: b.key,
      label: label(b.key),
      calls: b.calls,
      usd: fmtUsd(b.usd),
      estimate: Math.abs(b.estUsd - b.usd) > 0.005 ? fmtUsd(b.estUsd) : null,
      share: total > 0 ? Math.round((b.usd / total) * 100) : 0,
    }));
}

/** The spend report's buckets as three tables (by kind, model, run), biggest first with a share of total. */
export function groupLedger(s: Pick<SpendSummary, "totalUsd" | "byKind" | "byModel" | "byRun"> | null | undefined, runLabels: Record<string, string> = {}): LedgerGroup[] {
  if (!s) return [];
  return [
    { id: "kind" as const, title: "By kind", rows: ledgerRows(s.byKind, s.totalUsd, (k) => SPEND_KIND_LABEL[k] ?? k) },
    { id: "model" as const, title: "By model", rows: ledgerRows(s.byModel, s.totalUsd, (k) => k) },
    { id: "run" as const, title: "By run", rows: ledgerRows(s.byRun, s.totalUsd, (k) => runLabels[k] ?? (k === "(no run)" ? "Project-level (no run)" : `Run ${shortId(k)}`)) },
  ].filter((g) => g.rows.length > 0);
}

// ── Batch Mode ──────────────────────────────────────────────────────────────────────────────────────

export interface BatchDimsForm {
  hooks: string[];
  endCards: string[];
  ctas: string[];
  voices: string[];
  musicMoods: string[];
  aspects: string[];
  durations: number[];
}

export const EMPTY_DIMS: BatchDimsForm = { hooks: [], endCards: [], ctas: [], voices: [], musicMoods: [], aspects: [], durations: [] };

/** "Shop now, Get yours" → ["Shop now", "Get yours"] (trimmed, unique, ≤ 40 chars, ≤ 8). */
export function parseList(raw: string, max = 8, maxLen = 40): string[] {
  return [...new Set(raw.split(/[,\n]/).map((s) => s.trim().slice(0, maxLen)).filter(Boolean))].slice(0, max);
}

/** Only the dimensions the user varied (an empty one keeps the master's own level). */
export function dimsPayload(d: BatchDimsForm): Partial<BatchDimsForm> {
  const out: Partial<BatchDimsForm> = {};
  for (const k of Object.keys(d) as (keyof BatchDimsForm)[]) if (d[k].length) (out as Record<string, unknown>)[k] = d[k];
  return out;
}

export interface MatrixEstimate {
  /** Levels per dimension (an unvaried dimension counts as 1). */
  counts: number[];
  full: number;
  /** All-pairs lower bound: the product of the two largest dimensions. */
  pairwiseMin: number;
  /** What the plan will hold: the design's size, capped by max. */
  expected: number;
  capped: boolean;
}

/** Variant count before planning (the server's matrix is authoritative; this sizes the request). */
export function estimateMatrix(d: BatchDimsForm, design: "pairwise" | "full", max: number): MatrixEstimate {
  const counts = [d.hooks, d.endCards, d.ctas, d.voices, d.musicMoods, d.aspects, d.durations].map((l) => Math.max(1, l.length));
  const full = counts.reduce((a, b) => a * b, 1);
  const [a, b] = [...counts].sort((x, y) => y - x);
  const pairwiseMin = Math.min(full, a * (b ?? 1));
  const size = design === "full" ? full : pairwiseMin;
  const cap = Math.max(1, Math.floor(max));
  return { counts, full, pairwiseMin, expected: Math.min(size, cap), capped: size > cap };
}

export const VARIANT_STATUS_LABEL: Record<BatchVariantStatus, string> = {
  planned: "Planned",
  needs_generation: "Needs new hook clip",
  pending: "Rendering",
  rendered: "Rendered",
  failed: "Failed",
};

export interface BatchSummary {
  id: string;
  total: number;
  byStatus: Record<BatchVariantStatus, number>;
  /** Free re-edits not rendered yet (planned + failed). */
  renderable: number;
  /** 0–100 of the free variants. */
  progress: number;
  costLabel: string;
  coverageLabel: string;
  rendering: boolean;
}

export function summarizeBatch(b: BatchMatrix): BatchSummary {
  const byStatus: Record<BatchVariantStatus, number> = { planned: 0, needs_generation: 0, pending: 0, rendered: 0, failed: 0 };
  for (const v of b.variants) byStatus[v.status] = (byStatus[v.status] ?? 0) + 1;
  const free = b.variants.length - byStatus.needs_generation;
  const c = b.cost;
  const costLabel = !c
    ? "Cost not estimated"
    : c.needsGenerationVariants === 0
      ? `All ${c.reEditVariants} are free re-edits ($0)`
      : `${c.reEditVariants} free re-edits · ${c.needsGenerationVariants} need ${c.newHookClips} new hook clip${c.newHookClips === 1 ? "" : "s"} (${c.unit === "usd" ? fmtUsd(c.totalUsd) : `${c.totalCredits} credits`}, not rendered here)`;
  const cov = b.coverage;
  return {
    id: b.id,
    total: b.variants.length,
    byStatus,
    renderable: byStatus.planned + byStatus.failed,
    progress: free > 0 ? Math.round((byStatus.rendered / free) * 100) : 0,
    costLabel,
    coverageLabel: cov ? `${cov.pairsCovered}/${cov.pairsTotal} level pairs · ${cov.levelsCovered}/${cov.levelsTotal} levels` : "",
    rendering: byStatus.pending > 0,
  };
}

/** One preview line per variant: the levels that differ from the plan's first variant are flagged. */
export function variantCells(v: BatchVariant): { label: string; value: string }[] {
  return [
    { label: "Hook", value: v.hookKind === "restyle" ? `restyle ${v.hook}` : v.hook },
    { label: "End card", value: v.endCard },
    { label: "CTA", value: v.cta },
    { label: "Voice", value: v.voice.replace(/^([a-z]{2}-[A-Z]{2})-(\w+?)(Multilingual)?Neural$/, "$2 ($1)") },
    { label: "Music", value: v.music },
    { label: "Aspect", value: v.aspect },
    { label: "Length", value: `${v.durationSec}s` },
  ];
}

// ── Localization ────────────────────────────────────────────────────────────────────────────────────

/** Mirrors services/video-gen/localize.ts LOCALES (asserted equal in the test). */
export const LOCALE_OPTIONS = [
  { id: "es-US", label: "Spanish (US)" },
  { id: "es-MX", label: "Spanish (Mexico)" },
  { id: "pt-BR", label: "Portuguese (Brazil)" },
  { id: "fr-FR", label: "French" },
  { id: "de-DE", label: "German" },
  { id: "it-IT", label: "Italian" },
  { id: "ja-JP", label: "Japanese" },
  { id: "ko-KR", label: "Korean" },
  { id: "zh-CN", label: "Chinese (Simplified)" },
  { id: "ar-SA", label: "Arabic (RTL)" },
  { id: "hi-IN", label: "Hindi" },
] as const;

export type LocaleStatus = "done" | "rendering" | "stalled" | "not_started";

export interface LocaleRow {
  id: string;
  label: string;
  status: LocaleStatus;
  statusLabel: string;
  masterUrl: string | null;
  previewUrl: string | null;
  adName: string | null;
  qc: string | null;
  /** Voiceover lines that ran over their beat. */
  overruns: number;
}

interface LocaleQc {
  locales?: { locale: string; masterUrl: string; previewUrl: string | null; adName?: string; passed?: number; total?: number; fits?: { ok: boolean }[] }[];
  localesPending?: Record<string, string>;
}

/** Matches localize.ts PENDING_STALE_MS: a claim older than this was killed mid-render. */
export const LOCALE_STALE_MS = 8 * 60_000;

/** Status per locale from qcReport.locales / localesPending (done wins over a fresh re-render claim). */
export function localeRows(qc: LocaleQc | null | undefined, now = Date.now()): LocaleRow[] {
  const done = new Map((qc?.locales ?? []).map((l) => [l.locale, l]));
  const pending = qc?.localesPending ?? {};
  return LOCALE_OPTIONS.map(({ id, label }) => {
    const d = done.get(id);
    const claimedAt = pending[id] ? Date.parse(pending[id]) : NaN;
    const fresh = Number.isFinite(claimedAt) && now - claimedAt < LOCALE_STALE_MS;
    const status: LocaleStatus = fresh ? "rendering" : d ? "done" : Number.isFinite(claimedAt) ? "stalled" : "not_started";
    return {
      id,
      label,
      status,
      statusLabel: { done: "Ready", rendering: d ? "Re-rendering" : "Rendering", stalled: "Stalled — start again", not_started: "Not started" }[status],
      masterUrl: d?.masterUrl ?? null,
      previewUrl: d?.previewUrl ?? null,
      adName: d?.adName ?? null,
      qc: d && typeof d.passed === "number" && typeof d.total === "number" ? `${d.passed}/${d.total} QC` : null,
      overruns: d?.fits?.filter((f) => !f.ok).length ?? 0,
    };
  });
}

// ── Pre-flight ──────────────────────────────────────────────────────────────────────────────────────

export type PreflightTone = "ok" | "warn" | "bad";

export interface PreflightCard {
  platform: string;
  score: number;
  verdict: PreflightReport["verdict"];
  tone: PreflightTone;
  /** Failing checks first, then by weight. */
  checks: (PreflightCheck & { status: "pass" | "fail" | "partial" | "n/a" })[];
  topFixes: string[];
  measuredAt: string;
}

const isReport = (v: unknown): v is PreflightReport => !!v && typeof v === "object" && typeof (v as PreflightReport).score === "number" && Array.isArray((v as PreflightReport).checks);

/** qcReport.preflight as cards — one report, an array, or a { platform: report } map; null/garbage → []. */
export function preflightCards(raw: unknown): PreflightCard[] {
  const reports: PreflightReport[] = isReport(raw) ? [raw] : Array.isArray(raw) ? raw.filter(isReport) : raw && typeof raw === "object" ? Object.values(raw).filter(isReport) : [];
  const rank = (c: PreflightCheck) => (c.pass === false ? 0 : c.pass === null ? 2 : (c.score ?? 1) < 1 ? 1 : 3);
  return reports.map((r) => ({
    platform: String(r.platform),
    score: Math.round(r.score),
    verdict: r.verdict,
    tone: r.verdict === "ready" ? "ok" : r.verdict === "fix first" ? "warn" : "bad",
    checks: [...r.checks]
      .sort((a, b) => rank(a) - rank(b) || b.weight - a.weight)
      .map((c) => ({ ...c, status: c.pass === null || c.score === null ? "n/a" : c.pass === false ? "fail" : c.score < 1 ? "partial" : "pass" })),
    topFixes: r.topFixes ?? [],
    measuredAt: r.measuredAt,
  }));
}

// ── Image ads ───────────────────────────────────────────────────────────────────────────────────────

export interface ImageAdGroup {
  format: string;
  label: string;
  items: ImageAdItem[];
}

/** One set's items grouped by format, in the given format order (unknown formats last). */
export function groupImageAds(set: Pick<ImageAdSet, "items"> | null | undefined, formats: { id: string; label: string }[] = []): ImageAdGroup[] {
  if (!set?.items?.length) return [];
  const order = new Map(formats.map((f, i) => [f.id, i]));
  const m = new Map<string, ImageAdItem[]>();
  for (const it of set.items) m.set(it.format, [...(m.get(it.format) ?? []), it]);
  return [...m.entries()]
    .sort(([a], [b]) => (order.get(a) ?? 99) - (order.get(b) ?? 99) || a.localeCompare(b))
    .map(([format, items]) => ({ format, label: formats.find((f) => f.id === format)?.label ?? format, items }));
}

export const fmtBytes = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// ── Test plan ───────────────────────────────────────────────────────────────────────────────────────

export interface PhaseBar {
  name: Phase["name"];
  label: string;
  /** Percent offsets on the campaign timeline. */
  left: number;
  width: number;
  days: string;
  budget: string;
  daily: string;
  goal: string;
}

const PHASE_LABEL: Record<Phase["name"], string> = { test: "Test", iterate: "Iterate", scale: "Scale" };

export function phaseBars(phases: Phase[], totalDays: number): PhaseBar[] {
  const span = Math.max(totalDays, ...phases.map((p) => p.startDay - 1 + p.days), 1);
  return phases.map((p) => ({
    name: p.name,
    label: PHASE_LABEL[p.name] ?? p.name,
    left: Math.round(((p.startDay - 1) / span) * 1000) / 10,
    width: Math.round((p.days / span) * 1000) / 10,
    days: p.days === 1 ? `Day ${p.startDay}` : `Days ${p.startDay}–${p.startDay + p.days - 1}`,
    budget: fmtUsd(p.budget),
    daily: `${fmtUsd(p.dailyBudget)}/day`,
    goal: p.goal,
  }));
}

// ── Reports ─────────────────────────────────────────────────────────────────────────────────────────

export function reportUrl(projectId: string, format: "html" | "docx", aiNarrative: boolean): string {
  const q = new URLSearchParams({ format });
  if (aiNarrative) q.set("narrative", "llm");
  return `/api/projects/${encodeURIComponent(projectId)}/report?${q}`;
}

// ── Small shared ────────────────────────────────────────────────────────────────────────────────────

/** POST JSON and return the body, throwing the route's `error` text on a non-2xx. */
export async function postJson<T = Record<string, unknown>>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
