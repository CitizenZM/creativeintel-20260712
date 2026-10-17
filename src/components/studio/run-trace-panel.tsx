"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

interface RunTrace {
  totalCalls: number;
  usageAvailable: boolean;
  truncated: boolean;
  stages: Record<string, { calls: number; inputTokens: number; outputTokens: number; knownCostUsd: number; unpricedCalls: number; modelLatencyMs: number }>;
  run: { jobs: { nodeName: string; kind: string; status: string; queueMs: number | null; executionMs: number | null }[] } | null;
}

const seconds = (ms: number | null) => ms === null ? "—" : `${(ms / 1000).toFixed(1)}s`;

export function RunTracePanel({ projectId, runId }: { projectId: string; runId: string }) {
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<RunTrace | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch(`/api/projects/${encodeURIComponent(projectId)}/ai-trace/${encodeURIComponent(runId)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Trace request failed (${response.status})`);
        return response.json() as Promise<RunTrace>;
      })
      .then(setReport)
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Trace unavailable"); });
    return () => controller.abort();
  }, [open, projectId, runId]);

  return (
    <div className="w-full rounded-md border border-border p-2 text-xs">
      <Button size="sm" variant="ghost" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        {open ? "Hide" : "View"} generation timeline
      </Button>
      {open && (
        <div className="mt-2 space-y-2">
          {error && <p role="alert" className="text-red-700">{error}</p>}
          {!report && !error && <p className="text-muted-foreground">Loading run timing…</p>}
          {report && (
            <>
              <p>{report.run?.jobs.length ?? 0} jobs · {report.totalCalls} linked AI calls{report.truncated ? " (first 500 shown)" : ""}</p>
              {!report.usageAvailable && <p className="text-amber-700">AI call details are unavailable until the trace schema is migrated.</p>}
              {Object.entries(report.stages).map(([stage, usage]) => (
                <p key={stage} className="text-muted-foreground">{stage}: {usage.calls} calls · {usage.inputTokens + usage.outputTokens} tokens · ${usage.knownCostUsd.toFixed(3)} known cost{usage.unpricedCalls ? ` · ${usage.unpricedCalls} unpriced` : ""}</p>
              ))}
              {!!report.run?.jobs.length && (
                <div className="max-h-48 overflow-auto">
                  <table className="w-full text-left">
                    <thead><tr><th>Job</th><th>Status</th><th>Queue</th><th>Execution</th></tr></thead>
                    <tbody>{report.run.jobs.map((job, index) => (
                      <tr key={`${job.nodeName}-${index}`} className="border-t border-border">
                        <td>{job.nodeName} ({job.kind})</td><td>{job.status}</td>
                        <td>{seconds(job.queueMs)}</td><td>{seconds(job.executionMs)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
