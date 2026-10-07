"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Wallet } from "lucide-react";
import type { SpendSummary } from "@/services/ops/budget-guard";
import type { RunCostForecast } from "@/services/ops/cost-model";
import { cn } from "@/lib/utils";
import { btn, btnPrimary, ErrorNote, inputCls, Label, Panel, Pill } from "./bits";
import { budgetView, fmtUsd, forecastView, groupLedger, parseBudgetInput, postJson } from "./view-model";

export interface SpendTarget {
  key: string;
  label: string;
  runId?: string;
  storyboardId?: string;
}

type SpendReport = SpendSummary & { projectSpentUsd: number };
interface Estimate {
  forecast: RunCostForecast;
  remaining?: RunCostForecast;
  recommendedBudgetUsd: number;
}

/**
 * Budget & spend: cost forecast of a storyboard or run (line items low / expected / high), the project's
 * budget and spent amount, a set-budget field with an explicit confirm step, and the spend ledger by
 * kind, model and run. Estimates are free; only the confirmed budget write changes anything.
 */
export function SpendPanel({ projectId, targets, defaultTargetKey, runLabels }: { projectId: string; targets: SpendTarget[]; defaultTargetKey?: string | null; runLabels?: Record<string, string> }) {
  const [report, setReport] = useState<SpendReport | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const targetKey = pickedKey && targets.some((t) => t.key === pickedKey) ? pickedKey : (defaultTargetKey ?? targets[0]?.key ?? null);
  const target = targets.find((t) => t.key === targetKey) ?? null;
  const [estimate, setEstimate] = useState<{ key: string; data: Estimate | null; error: string | null } | null>(null);
  const [draft, setDraft] = useState("");
  const [runScope, setRunScope] = useState(false);
  const [confirming, setConfirming] = useState<{ usd: number | null; runId: string | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [budgetError, setBudgetError] = useState<string | null>(null);

  const [reportKey, setReportKey] = useState(0);
  useEffect(() => {
    let alive = true;
    fetch(`/api/projects/${projectId}/spend`, { cache: "no-store" })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as SpendReport & { error?: string };
        if (!alive) return;
        if (!res.ok) return setReportError(data.error ?? `Could not load spend (${res.status})`);
        setReport(data);
        setReportError(null);
      })
      .catch(() => alive && setReportError("Could not load spend"));
    return () => {
      alive = false;
    };
  }, [projectId, reportKey]);

  // A forecast is a pure estimate — refresh it whenever the target changes.
  const tKey = target?.key ?? null;
  const tRun = target?.runId;
  const tBoard = target?.storyboardId;
  useEffect(() => {
    if (!tKey || (!tRun && !tBoard)) return;
    let alive = true;
    const key = tKey;
    postJson<Estimate>(`/api/projects/${projectId}/spend/estimate`, tRun ? { runId: tRun } : { storyboardId: tBoard })
      .then((data) => alive && setEstimate({ key, data, error: null }))
      .catch((err) => alive && setEstimate({ key, data: null, error: err instanceof Error ? err.message : "Estimate failed" }));
    return () => {
      alive = false;
    };
  }, [projectId, tKey, tRun, tBoard]);

  const current = estimate && estimate.key === target?.key ? estimate : null;
  const fv = useMemo(() => forecastView(current?.data?.forecast), [current]);
  const remaining = useMemo(() => forecastView(current?.data?.remaining), [current]);
  const budget = budgetView({ budgetUsd: report?.projectBudgetUsd ?? null, spentUsd: report?.projectSpentUsd ?? report?.totalUsd ?? 0 });
  const groups = useMemo(() => groupLedger(report, runLabels), [report, runLabels]);

  function review() {
    const parsed = parseBudgetInput(draft);
    if (!parsed.ok) return setBudgetError(parsed.error);
    setBudgetError(null);
    setConfirming({ usd: parsed.usd, runId: runScope && target?.runId ? target.runId : null });
  }

  async function confirm() {
    if (!confirming) return;
    setSaving(true);
    setBudgetError(null);
    try {
      await postJson(`/api/projects/${projectId}/spend`, { usd: confirming.usd, runId: confirming.runId ?? undefined, confirm: true });
      setConfirming(null);
      setDraft("");
      setReportKey((k) => k + 1);
    } catch (err) {
      setBudgetError(err instanceof Error ? err.message : "Could not set the budget");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel
      icon={<Wallet className="h-4 w-4" />}
      title="Budget & spend"
      testId="spend-panel"
      description="Forecast a run before approving it, cap what the project may spend, and see where the money went. Paid calls past a cap are refused before the provider is called."
    >
      {/* Budget */}
      <div className="grid gap-3 md:grid-cols-[1fr_auto]">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
            <span>
              <span className="text-muted-foreground">Budget </span>
              <strong className="num">{budget.budget}</strong>
            </span>
            <span>
              <span className="text-muted-foreground">Spent </span>
              <strong className="num">{budget.spent}</strong>
            </span>
            {report && report.openReservedUsd > 0 && <span className="text-muted-foreground">incl. {fmtUsd(report.openReservedUsd)} not reconciled yet</span>}
            {budget.tone !== "none" && <Pill tone={budget.tone === "over" ? "bad" : budget.tone === "warn" ? "warn" : "ok"}>{budget.pct}% used</Pill>}
          </div>
          {budget.pct != null && (
            <div className="h-1.5 w-full overflow-hidden rounded bg-muted" aria-hidden>
              <div
                className={cn("h-full", budget.tone === "over" ? "bg-[var(--status-urgent-fg)]" : budget.tone === "warn" ? "bg-[var(--status-attention-fg)]" : "bg-[var(--status-healthy-fg)]")}
                style={{ width: `${budget.pct}%` }}
              />
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">{budget.label}</p>
          <ErrorNote>{reportError}</ErrorNote>
        </div>
        <div className="space-y-1.5">
          <Label>Set budget (USD)</Label>
          {confirming ? (
            <div className="space-y-2 rounded-md border border-border p-2 text-xs" role="group" aria-label="Confirm budget">
              <p>
                {confirming.usd == null ? "Remove the cap" : `Cap at ${fmtUsd(confirming.usd)}`} for {confirming.runId ? "this run" : "the whole project"}
                {!confirming.runId && <> (now {budget.budget})</>}?
              </p>
              <div className="flex gap-2">
                <button type="button" className={btnPrimary} onClick={confirm} disabled={saving}>
                  {saving && <Loader2 className="h-3 w-3 animate-spin" />} Confirm
                </button>
                <button type="button" className={btn} onClick={() => setConfirming(null)} disabled={saving}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <input
                aria-label="Budget in USD"
                inputMode="decimal"
                placeholder="e.g. 25 (blank = no cap)"
                className={cn(inputCls, "w-40")}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && review()}
              />
              <button type="button" className={btn} onClick={review}>
                Set budget…
              </button>
            </div>
          )}
          {target?.runId && !confirming && (
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <input type="checkbox" checked={runScope} onChange={(e) => setRunScope(e.target.checked)} /> Only for the selected run
            </label>
          )}
          <ErrorNote>{budgetError}</ErrorNote>
        </div>
      </div>

      {/* Forecast */}
      {targets.length > 0 && (
        <div className="space-y-2 border-t border-border pt-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <label className="block">
              <Label>Cost forecast for</Label>
              <select aria-label="Forecast target" className={cn(inputCls, "max-w-xs")} value={targetKey ?? ""} onChange={(e) => setPickedKey(e.target.value)}>
                {targets.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            {fv && (
              <div className="text-right text-xs">
                <p>
                  <span className="text-muted-foreground">Expected </span>
                  <strong className="num">{fv.totals.expected}</strong>
                  <span className="text-muted-foreground"> · range {fv.totals.range}</span>
                </p>
                {current?.data && current.data.recommendedBudgetUsd > 0 && (
                  <button type="button" className="text-[11px] underline underline-offset-2 text-muted-foreground hover:text-foreground" onClick={() => setDraft(String(current.data!.recommendedBudgetUsd))}>
                    Use worst case {fmtUsd(current.data.recommendedBudgetUsd)} as the budget
                  </button>
                )}
              </div>
            )}
          </div>
          {!current && target && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Estimating…
            </p>
          )}
          <ErrorNote>{current?.error}</ErrorNote>
          {fv && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Line item</th>
                    <th className="py-1 pr-3 font-medium">Model</th>
                    <th className="py-1 pr-3 font-medium">Qty</th>
                    <th className="py-1 pr-3 font-medium">Unit</th>
                    <th className="py-1 pr-3 font-medium text-right">Low</th>
                    <th className="py-1 pr-3 font-medium text-right">Expected</th>
                    <th className="py-1 font-medium text-right">High</th>
                  </tr>
                </thead>
                <tbody>
                  {fv.rows.map((r) => (
                    <tr key={r.key} className="border-t border-border/60" title={r.source}>
                      <td className="py-1 pr-3">{r.label}</td>
                      <td className="py-1 pr-3 font-mono text-[11px] text-muted-foreground">{r.model}</td>
                      <td className="py-1 pr-3 num">{r.qty}</td>
                      <td className="py-1 pr-3 num">{r.unit}</td>
                      <td className="py-1 pr-3 num text-right">{r.low}</td>
                      <td className="py-1 pr-3 num text-right font-medium">{r.expected}</td>
                      <td className="py-1 num text-right">{r.high}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-border font-semibold">
                    <td className="py-1 pr-3" colSpan={4}>
                      Total
                    </td>
                    <td className="py-1 pr-3 num text-right">{fv.totals.low}</td>
                    <td className="py-1 pr-3 num text-right">{fv.totals.expected}</td>
                    <td className="py-1 num text-right">{fv.totals.high}</td>
                  </tr>
                </tbody>
              </table>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {fv.free ? "This run is free (no paid calls). " : ""}
                {remaining ? `Still to spend on this run: ${remaining.totals.range}. ` : ""}
                Prices as of {fv.pricesAsOf}.
              </p>
              {fv.warnings.map((w) => (
                <p key={w} className="text-[11px] text-[var(--status-attention-fg)]">
                  {w}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Ledger */}
      <div className="space-y-2 border-t border-border pt-3">
        <p className="text-xs font-semibold">
          Spend ledger <span className="font-normal text-muted-foreground">{report ? `${report.calls} paid calls · ${fmtUsd(report.totalUsd)}` : ""}</span>
        </p>
        {groups.length === 0 ? (
          <p className="text-xs text-muted-foreground">{report ? "No paid calls recorded for this project yet." : "Loading…"}</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-3">
            {groups.map((g) => (
              <div key={g.id} className="overflow-x-auto">
                <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{g.title}</p>
                <table className="w-full text-left text-xs">
                  <tbody>
                    {g.rows.map((r) => (
                      <tr key={r.key} className="border-t border-border/60">
                        <td className="max-w-[10rem] truncate py-1 pr-2" title={r.key}>
                          {r.label}
                        </td>
                        <td className="py-1 pr-2 num text-muted-foreground">{r.calls}×</td>
                        <td className="py-1 pr-2 num text-right" title={r.estimate ? `Estimated ${r.estimate}` : undefined}>
                          {r.usd}
                        </td>
                        <td className="py-1 num text-right text-muted-foreground">{r.share}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}
