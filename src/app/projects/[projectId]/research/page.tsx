"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Circle,
  ArrowRight,
  Play,
  KeyRound,
  Laptop,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Status = "idle" | "running" | "complete" | "error";

interface JobStep {
  name: string;
  status: "pending" | "running" | "complete" | "error";
  progress: number;
  message?: string;
}

interface SourceStatus {
  name: string;
  status: "ran" | "skipped_no_key" | "failed" | "pending_worker";
  count: number;
  note?: string;
}

const SOURCE_LABELS: Record<string, string> = {
  youtube_shorts: "YouTube Shorts",
  youtube_long: "YouTube (long-form)",
  meta_ad_library: "Meta Ad Library API",
  tiktok_cc: "TikTok Creative Center",
  tiktok_cc_for_you: "TikTok top ads (feed)",
  tiktok_organic: "TikTok organic",
  ig_reels: "Instagram Reels",
  ad_classifier: "Ad vs UGC classifier",
  meta_ad_library_browser: "Meta Ad Library (worker)",
  tiktok_ad_library_browser: "TikTok Ad Library (worker)",
  google_ads_transparency_browser: "Google Ads Transparency (worker)",
};

const SOURCE_STATUS_STYLE: Record<SourceStatus["status"], string> = {
  ran: "bg-[var(--status-healthy-bg)] text-[var(--status-healthy-fg)]",
  skipped_no_key: "bg-muted text-muted-foreground",
  failed: "bg-[var(--status-urgent-bg)] text-[var(--status-urgent-fg)]",
  pending_worker: "bg-[var(--status-ai-bg)] text-[var(--status-ai-fg)]",
};

const SOURCE_STATUS_LABEL: Record<SourceStatus["status"], string> = {
  ran: "ran",
  skipped_no_key: "skipped — no key",
  failed: "failed",
  pending_worker: "pending local worker",
};

export default function ResearchPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.projectId as string;

  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [steps, setSteps] = useState<JobStep[]>([]);
  const [sources, setSources] = useState<SourceStatus[]>([]);
  const [error, setError] = useState<string | null>(null);

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}`);
      const data = await res.json().catch(() => null);
      if (!data) return;
      if (data.status === "ANALYZED" || data.status === "COMPLETE") {
        setStatus("complete");
        setProgress(100);
      } else if (data.status === "ERROR") {
        setStatus("error");
        setError("Research failed. Try again.");
      }
    } catch {
      /* ignore */
    }
  }, [projectId]);

  // Step labels come from the runner's STEP_NAMES via the status API — never
  // from a hardcoded list that drifts out of sync (audit §1).
  function applyStatusPayload(data: {
    progress?: number;
    steps?: JobStep[];
    sources?: SourceStatus[];
  }) {
    if (typeof data.progress === "number") setProgress(data.progress);
    if (Array.isArray(data.steps)) setSteps(data.steps);
    if (Array.isArray(data.sources)) setSources(data.sources);
  }

  async function pollStatus(jobId?: string): Promise<void> {
    const qs = jobId ? `?jobId=${encodeURIComponent(jobId)}` : "";
    while (true) {
      const res = await fetch(`/api/projects/${projectId}/research/status${qs}`);
      const data = await res.json().catch(() => null);
      if (!data) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      applyStatusPayload(data);
      if (data.status === "complete") {
        setStatus("complete");
        setProgress(100);
        return;
      }
      if (data.status === "error") {
        setStatus("error");
        setError(data.error || "Research failed");
        return;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  async function startResearch() {
    setStatus("running");
    setProgress(0);
    setError(null);

    try {
      const res = await fetch(`/api/projects/${projectId}/research`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        throw new Error(data?.error || "Failed to start research");
      }
      await pollStatus(data.jobId);
    } catch (err) {
      // Final defensive check — project may have flipped status already
      try {
        const checkRes = await fetch(`/api/projects/${projectId}`);
        const checkData = await checkRes.json().catch(() => null);
        if (checkData?.status === "ANALYZED" || checkData?.status === "COMPLETE") {
          setProgress(100);
          setStatus("complete");
          return;
        }
      } catch { /* ignore */ }
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  useEffect(() => {
    // Render whatever the last job recorded before deciding to start a new one.
    fetch(`/api/projects/${projectId}/research/status`)
      .then((r) => r.json().catch(() => null))
      .then((d) => d && applyStatusPayload(d))
      .catch(() => {});

    checkStatus().then(() => {
      fetch(`/api/projects/${projectId}`)
        .then((r) => r.json().catch(() => null))
        .then((d) => {
          if (!d) return;
          if (d.status === "DRAFT") startResearch();
          else if (d.status === "ANALYZED" || d.status === "COMPLETE") {
            setStatus("complete");
            setProgress(100);
          } else if (d.status === "RESEARCHING") {
            if (d._count?.contentAssets > 0 || d.brandHealthScore) {
              setStatus("complete");
              setProgress(100);
            } else {
              startResearch();
            }
          }
        })
        .catch(() => {});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pendingWorker = sources.filter((s) => s.status === "pending_worker");
  const missingKeys = sources.filter((s) => s.status === "skipped_no_key");

  return (
    <div className="max-w-xl mx-auto">
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-tight">Research Pipeline</h2>
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                status === "complete" && "bg-[var(--status-healthy-bg)] text-[var(--status-healthy-fg)]",
                status === "error" && "bg-[var(--status-urgent-bg)] text-[var(--status-urgent-fg)]",
                (status === "running" || status === "idle") && "bg-[var(--status-ai-bg)] text-[var(--status-ai-fg)]"
              )}
            >
              {status === "complete"
                ? "Complete"
                : status === "error"
                  ? "Error"
                  : status === "running"
                    ? "Running"
                    : "Starting"}
            </span>
          </div>
        </div>

        <div className="px-5 py-5 space-y-5">
          {/* Progress bar */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground font-medium">Overall progress</span>
              <span className="num font-medium">{Math.round(progress)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-foreground transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* Steps — names and states come straight from the job record */}
          <div className="space-y-1">
            {steps.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">Waiting for the job to start…</p>
            ) : (
              steps.map((step) => (
                <div key={step.name} className="flex items-start gap-3 py-2">
                  <div className="shrink-0 mt-0.5">
                    {step.status === "complete" ? (
                      <CheckCircle2 className="h-4 w-4 text-[var(--status-healthy-fg)]" />
                    ) : step.status === "running" ? (
                      <Loader2 className="h-4 w-4 text-[var(--status-ai-fg)] animate-spin" />
                    ) : step.status === "error" ? (
                      <XCircle className="h-4 w-4 text-[var(--status-urgent-fg)]" />
                    ) : (
                      <Circle className="h-4 w-4 text-muted-foreground/40" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p
                      className={cn(
                        "text-sm font-medium",
                        step.status === "pending" ? "text-muted-foreground" : "text-foreground"
                      )}
                    >
                      {step.name}
                    </p>
                    {step.message && (
                      <p className="text-[11px] text-muted-foreground mt-0.5 break-words">
                        {step.message}
                      </p>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Source ledger — what ran, what was skipped, what is queued */}
          {sources.length > 0 && (
            <div className="space-y-2 border-t border-border pt-4">
              <p className="text-xs font-medium text-muted-foreground">Sources</p>
              <ul className="space-y-1.5">
                {sources.map((s) => (
                  <li key={s.name} className="flex items-start justify-between gap-3 text-xs">
                    <div className="min-w-0">
                      <span className="font-medium">{SOURCE_LABELS[s.name] ?? s.name}</span>
                      {s.note && (
                        <span className="block text-[11px] text-muted-foreground break-words">
                          {s.note}
                        </span>
                      )}
                    </div>
                    <span className="flex items-center gap-1.5 shrink-0">
                      <span className="num text-muted-foreground">{s.count}</span>
                      <span
                        className={cn(
                          "rounded-full px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap",
                          SOURCE_STATUS_STYLE[s.status]
                        )}
                      >
                        {SOURCE_STATUS_LABEL[s.status]}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {missingKeys.length > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
              <KeyRound className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                {missingKeys.length} source{missingKeys.length !== 1 ? "s" : ""} skipped for a
                missing API key. Everything else still ran.
              </span>
            </div>
          )}

          {pendingWorker.length > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
              <Laptop className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                {pendingWorker.length} ad-library fetch
                {pendingWorker.length !== 1 ? "es are" : " is"} queued for the local research
                worker. Results appear on the Content page once it runs.
              </span>
            </div>
          )}
        </div>
      </div>

      {status === "complete" && (
        <Button
          onClick={() => router.push(`/projects/${projectId}/overview`)}
          className="w-full mt-4 h-10 rounded-md bg-foreground text-background hover:bg-foreground/90"
        >
          View dashboard
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      )}

      {status === "error" && (
        <div className="mt-4 space-y-3">
          {error && (
            <div className="rounded-md border border-[var(--status-urgent)] bg-[var(--status-urgent-bg)] p-3 text-sm text-[var(--status-urgent-fg)]">
              {error}
            </div>
          )}
          <div className="flex gap-2">
            <Button
              onClick={startResearch}
              variant="outline"
              className="flex-1 h-10 rounded-md"
            >
              <Play className="mr-2 h-4 w-4" />
              Retry
            </Button>
            <Button
              onClick={() => router.push(`/projects/${projectId}/overview`)}
              variant="secondary"
              className="flex-1 h-10 rounded-md"
            >
              View partial results
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
