"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Wrench } from "lucide-react";
import type { BatchMatrix } from "@/services/creative/batch-matrix";
import { isServerEngine } from "@/services/video-gen/libtv-pricing";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { inputCls, Label, Panel } from "./bits";
import { BatchBuilder } from "./batch-builder";
import { ExportPackPanel, type StoredPack } from "./export-pack-panel";
import { LocalizePanel } from "./localize-panel";
import { PreflightPanel } from "./preflight-panel";
import { LOCALE_STALE_MS } from "./view-model";

export interface WorkbenchRunOption {
  id: string;
  label: string;
}

interface RunDetail {
  id: string;
  status: string;
  executor?: string | null;
  masterMp4Url: string | null;
  qcReport?: (Record<string, unknown> & { batches?: BatchMatrix[]; localesPending?: Record<string, string>; exportPack?: StoredPack; preflight?: unknown }) | null;
}

const POLL_MS = 10_000;

/** Something is rendering in the background (a batch variant or a locale claimed recently). */
function isBusy(run: RunDetail | null, now: number): boolean {
  const qc = run?.qcReport;
  if (!qc) return false;
  const batchBusy = (qc.batches ?? []).some((b) => b.variants.some((v) => v.status === "pending"));
  const localeBusy = Object.values(qc.localesPending ?? {}).some((t) => now - Date.parse(t) < LOCALE_STALE_MS);
  return batchBusy || localeBusy;
}

/**
 * The run view's delivery tools: pre-flight score, Batch Mode, localization and the export pack, for a
 * picked run (Studio passes its active run; Deliver lists the finished ones).
 */
export function RunWorkbench({ projectId, runs, selectedRunId, onRunChanged }: { projectId: string; runs: WorkbenchRunOption[]; selectedRunId?: string | null; onRunChanged?: () => void }) {
  const [picked, setPicked] = useState<string | null>(null);
  const runId = (selectedRunId !== undefined ? selectedRunId : picked && runs.some((r) => r.id === picked) ? picked : runs[0]?.id) ?? null;
  const [detail, setDetail] = useState<{ run: RunDetail | null; at: number; error: string | null } | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => {
    setTick((t) => t + 1);
    onRunChanged?.();
  }, [onRunChanged]);

  useEffect(() => {
    if (!runId) return;
    let alive = true;
    fetch(`/api/projects/${projectId}/studio/libtv-runs/${runId}`, { cache: "no-store" })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as { run?: RunDetail; error?: string };
        if (!alive) return;
        setDetail({ run: data.run ?? null, at: Date.now(), error: res.ok ? null : (data.error ?? `Could not load the run (${res.status})`) });
      })
      .catch(() => alive && setDetail({ run: null, at: Date.now(), error: "Could not load the run" }));
    return () => {
      alive = false;
    };
  }, [projectId, runId, tick]);

  const run = detail?.run && detail.run.id === runId ? detail.run : null;
  const busy = isBusy(run, detail?.at ?? 0);
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setTick((n) => n + 1), POLL_MS);
    return () => clearInterval(t);
  }, [busy]);

  if (!runs.length) return null;
  const finishedServer = !!run && run.status === "completed" && isServerEngine(run.executor ?? null);
  const qc = run?.qcReport ?? null;
  const needsServer = <p className="text-xs text-muted-foreground">Needs a finished server-rendered master (GLM / ComfyUI / animatic) — this run is {run?.status ?? "loading"}.</p>;

  return (
    <Panel
      icon={<Wrench className="h-4 w-4" />}
      title="Run tools"
      testId="run-workbench"
      description="Score the master before launch, make free re-edit variants in bulk, localize it and export a launch-ready pack."
      actions={
        selectedRunId === undefined && runs.length > 1 ? (
          <label className="block">
            <Label>Run</Label>
            <select aria-label="Run" className={cn(inputCls, "max-w-xs")} value={runId ?? ""} onChange={(e) => setPicked(e.target.value)}>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
        ) : undefined
      }
    >
      {!run ? (
        detail?.error ? (
          <p className="text-xs text-[var(--status-urgent-fg)]">{detail.error}</p>
        ) : (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading run…
          </p>
        )
      ) : (
        <Tabs defaultValue="preflight">
          <TabsList>
            <TabsTrigger value="preflight">Pre-flight</TabsTrigger>
            <TabsTrigger value="batch">Batch Mode</TabsTrigger>
            <TabsTrigger value="localize">Localize</TabsTrigger>
            <TabsTrigger value="export">Export pack</TabsTrigger>
          </TabsList>
          <TabsContent value="preflight" className="pt-2">
            <PreflightPanel projectId={projectId} runId={run.id} preflight={qc?.preflight} hasMaster={!!run.masterMp4Url} onChanged={refresh} />
          </TabsContent>
          <TabsContent value="batch" className="pt-2">
            {finishedServer ? <BatchBuilder projectId={projectId} runId={run.id} batches={qc?.batches ?? []} onChanged={refresh} /> : needsServer}
          </TabsContent>
          <TabsContent value="localize" className="pt-2">
            {finishedServer ? <LocalizePanel projectId={projectId} runId={run.id} qc={qc as never} now={detail?.at ?? 0} onChanged={refresh} /> : needsServer}
          </TabsContent>
          <TabsContent value="export" className="pt-2">
            {run.masterMp4Url ? <ExportPackPanel projectId={projectId} runId={run.id} stored={qc?.exportPack ?? null} onChanged={refresh} /> : <p className="text-xs text-muted-foreground">Needs a rendered master.</p>}
          </TabsContent>
        </Tabs>
      )}
    </Panel>
  );
}
