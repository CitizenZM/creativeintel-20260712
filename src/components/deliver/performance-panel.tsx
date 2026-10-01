"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BarChart3, Loader2, Upload } from "lucide-react";

interface StyleStats {
  hookStyle: string;
  ads: number;
  impressions: number;
  hookRate: number;
  ctr: number;
  spend: number;
}

interface Learning {
  styles: StyleStats[];
  hookWinner: { hookStyle: string; lift: number; z: number } | null;
  ctrWinner: { hookStyle: string; lift: number; z: number } | null;
}

interface Row {
  id: string;
  platform: string;
  adName: string;
  hookStyle: string | null;
  format: string | null;
  impressions: number;
  views3s: number;
  clicks: number;
  spend: number;
}

const NAME: Record<string, string> = { q: "Question", c: "Contrast", p: "Product blast" };
const pct = (n: number, d = 1) => `${(n * 100).toFixed(d)}%`;

/**
 * A/B results: import a Meta / TikTok Ads export, see which hook style wins on
 * hook rate (thumb-stop) and CTR. Winners feed script writing and the hook
 * style of new masters automatically.
 */
export function PerformancePanel({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [learning, setLearning] = useState<Learning | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/performance`, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { rows: Row[]; learning: Learning | null };
    setRows(data.rows);
    setLearning(data.learning);
  }, [projectId]);

  useEffect(() => {
    let alive = true;
    fetch(`/api/projects/${projectId}/performance`, { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<{ rows: Row[]; learning: Learning | null }>) : null))
      .then((data) => {
        if (!alive || !data) return;
        setRows(data.rows);
        setLearning(data.learning);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [projectId]);

  async function upload(file: File) {
    setBusy(true);
    setNote(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/projects/${projectId}/performance`, { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as { error?: string; saved?: number; matched?: number; platform?: string };
      if (!res.ok) throw new Error(data.error ?? `Import failed (${res.status})`);
      setNote(`Imported ${data.saved} ${data.platform} rows — ${data.matched} matched to our hook variants.`);
      await load();
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  const verdict = learning?.ctrWinner ?? learning?.hookWinner;
  return (
    <section className="rounded-xl border border-border bg-card p-4" data-testid="performance-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <BarChart3 className="h-4 w-4" /> A/B results
          </h3>
          <p className="mt-1 max-w-prose text-xs text-muted-foreground">
            Run the hook variants with equal budgets, then import the Ads Manager (Meta) or TikTok Ads export at the ad level.
            Rows match by ad name (…_HookQ / _HookC / _HookP). A significant winner leads new masters and script writing.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => input.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Import CSV
        </button>
        <input ref={input} type="file" accept=".csv,.tsv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      </div>
      {note && <p className="mt-2 text-xs">{note}</p>}
      {learning && learning.styles.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 pr-3 font-medium">Hook style</th>
                <th className="py-1 pr-3 font-medium">Ads</th>
                <th className="py-1 pr-3 font-medium">Impressions</th>
                <th className="py-1 pr-3 font-medium">Hook rate (3 s)</th>
                <th className="py-1 pr-3 font-medium">CTR</th>
                <th className="py-1 font-medium">Spend</th>
              </tr>
            </thead>
            <tbody>
              {learning.styles.map((s) => (
                <tr key={s.hookStyle} className="border-t border-border/60">
                  <td className="py-1 pr-3 font-medium">
                    {NAME[s.hookStyle] ?? s.hookStyle}
                    {verdict?.hookStyle === s.hookStyle && <span className="ml-1.5 rounded bg-[var(--status-healthy-bg)] px-1 text-[10px] text-[var(--status-healthy-fg)]">winner</span>}
                  </td>
                  <td className="py-1 pr-3 num">{s.ads}</td>
                  <td className="py-1 pr-3 num">{s.impressions.toLocaleString("en-US")}</td>
                  <td className="py-1 pr-3 num">{pct(s.hookRate)}</td>
                  <td className="py-1 pr-3 num">{pct(s.ctr, 2)}</td>
                  <td className="py-1 num">${s.spend.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted-foreground">
            {verdict
              ? `${NAME[verdict.hookStyle]} wins (+${verdict.lift}% vs the runner-up, z = ${verdict.z}). New masters lead with it; the others stay as variants.`
              : "No significant winner yet (needs about 95 % confidence) — keep the test running."}
          </p>
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">{rows.length ? "Imported rows don't carry our hook-variant names yet." : "No results imported yet."}</p>
      )}
    </section>
  );
}
