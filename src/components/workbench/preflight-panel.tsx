"use client";

import { useMemo, useState } from "react";
import { Gauge, Loader2 } from "lucide-react";
import { PLATFORM_LABELS } from "@/components/planning/view-model";
import type { PlatformId } from "@/services/creative/types";
import { cn } from "@/lib/utils";
import { btn, ErrorNote, inputCls, Label, Pill } from "./bits";
import { postJson, preflightCards } from "./view-model";

const STATUS_ICON: Record<string, string> = { pass: "✓", partial: "≈", fail: "✗", "n/a": "–" };

/** Per-platform pre-flight score cards (qcReport.preflight) with itemized checks and fixes; re-score for a platform. */
export function PreflightPanel({ projectId, runId, preflight, hasMaster, onChanged }: { projectId: string; runId: string; preflight: unknown; hasMaster: boolean; onChanged: () => void }) {
  const cards = useMemo(() => preflightCards(preflight), [preflight]);
  const [platform, setPlatform] = useState<PlatformId | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function score() {
    setBusy(true);
    setError(null);
    try {
      await postJson(`/api/projects/${projectId}/studio/libtv-runs/${runId}/preflight`, platform ? { platform } : {});
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pre-flight failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3" data-testid="preflight-panel">
      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <Label>Platform</Label>
          <select aria-label="Pre-flight platform" className={inputCls} value={platform} onChange={(e) => setPlatform(e.target.value as PlatformId | "")}>
            <option value="">From the campaign plan</option>
            {(Object.keys(PLATFORM_LABELS) as PlatformId[]).map((id) => (
              <option key={id} value={id}>
                {PLATFORM_LABELS[id]}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className={btn} onClick={score} disabled={busy || !hasMaster} title={hasMaster ? "Measures the master with ffmpeg — no spend" : "Needs a rendered master"}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Gauge className="h-3.5 w-3.5" />} {cards.length ? "Re-score" : "Score pre-flight"}
        </button>
        <span className="text-[11px] text-muted-foreground">Thumb-stop predictor from the file and the render plan. Free.</span>
      </div>
      <ErrorNote>{error}</ErrorNote>
      {cards.length === 0 ? (
        <p className="text-xs text-muted-foreground">No pre-flight score on this run yet{hasMaster ? "." : " — it needs a rendered master."}</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {cards.map((c) => (
            <div key={c.platform} className="rounded-lg border border-border p-3" data-testid="preflight-card">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">{PLATFORM_LABELS[c.platform as PlatformId] ?? c.platform}</p>
                <div className="flex items-center gap-2">
                  <span className="num text-xl font-semibold">{c.score}</span>
                  <Pill tone={c.tone === "ok" ? "ok" : c.tone === "warn" ? "warn" : "bad"}>{c.verdict}</Pill>
                </div>
              </div>
              {c.topFixes.length > 0 && (
                <ol className="mt-2 list-decimal space-y-0.5 pl-4 text-xs">
                  {c.topFixes.slice(0, 3).map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ol>
              )}
              <details className="mt-2">
                <summary className="cursor-pointer text-[11px] text-muted-foreground">{c.checks.length} checks</summary>
                <ul className="mt-1 space-y-1">
                  {c.checks.map((k) => (
                    <li key={k.key} className="text-[11px]">
                      <span className={cn("mr-1 inline-block w-3 text-center font-semibold", k.status === "fail" ? "text-[var(--status-urgent-fg)]" : k.status === "partial" ? "text-[var(--status-attention-fg)]" : k.status === "pass" ? "text-[var(--status-healthy-fg)]" : "text-muted-foreground")}>
                        {STATUS_ICON[k.status]}
                      </span>
                      <span className="font-medium">{k.label}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {k.value ?? "n/a"} (target {k.target})
                      </span>
                      {k.fix && k.status !== "pass" && <span className="block pl-4 text-muted-foreground">Fix: {k.fix}</span>}
                    </li>
                  ))}
                </ul>
              </details>
              <p className="mt-2 text-[10px] text-muted-foreground">Measured {new Date(c.measuredAt).toLocaleString()}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
