"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Circle,
  Play,
  KeyRound,
  Laptop,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { formatDuration } from "@/components/jobs/job-progress";
import { cn } from "@/lib/utils";

/** Fired by anything that starts a research run, so this panel starts polling. */
export const RESEARCH_STARTED_EVENT = "research:started";

type Status = "idle" | "running" | "complete" | "error";

interface JobStep {
  name: string;
  status: "pending" | "running" | "complete" | "error";
  progress: number;
  message?: string;
  subSteps?: JobStep[];
}

interface SourceStatus {
  name: string;
  status: "ran" | "skipped_no_key" | "failed" | "pending_worker" | "blocked";
  count: number;
  note?: string;
}

interface StatusPayload {
  jobId?: string;
  status?: string;
  progress?: number;
  steps?: JobStep[];
  sources?: SourceStatus[];
  error?: string | null;
  etaSeconds?: number | null;
  startedAt?: string | null;
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
  blocked: "bg-muted text-muted-foreground",
};

const SOURCE_STATUS_LABEL: Record<SourceStatus["status"], string> = {
  ran: "ran",
  skipped_no_key: "skipped — no key",
  failed: "failed",
  pending_worker: "pending local worker",
  blocked: "blocked — login/CAPTCHA",
};

function StepIcon({ status, small }: { status: JobStep["status"]; small?: boolean }) {
  const size = small ? "h-3 w-3" : "h-4 w-4";
  if (status === "complete") return <CheckCircle2 className={cn(size, "text-[var(--status-healthy-fg)]")} />;
  if (status === "running") return <Loader2 className={cn(size, "text-[var(--status-ai-fg)] animate-spin")} />;
  if (status === "error") return <XCircle className={cn(size, "text-[var(--status-urgent-fg)]")} />;
  return <Circle className={cn(size, "text-muted-foreground/40")} />;
}

/**
 * Research progress, shown at the top of the Research (content) page.
 *
 * A new project starts its first run here automatically. While a run is going
 * this shows percent, ETA, steps and the source ledger; once finished it
 * collapses to a one-line coverage summary that expands to the full ledger.
 */
export function ResearchProgress({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [steps, setSteps] = useState<JobStep[]>([]);
  const [sources, setSources] = useState<SourceStatus[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [eta, setEta] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const polling = useRef(false);
  const alive = useRef(true);

  // Step labels come from the runner's STEP_NAMES via the status API — never
  // from a hardcoded list that drifts out of sync (audit §1).
  const apply = useCallback((data: StatusPayload) => {
    if (typeof data.progress === "number") setProgress(data.progress);
    if (Array.isArray(data.steps)) setSteps(data.steps);
    if (Array.isArray(data.sources)) setSources(data.sources);
    setEta(typeof data.etaSeconds === "number" ? data.etaSeconds : null);
  }, []);

  const poll = useCallback(
    async (jobId?: string) => {
      if (polling.current) return;
      polling.current = true;
      setStatus("running");
      setExpanded(true);
      const qs = jobId ? `?jobId=${encodeURIComponent(jobId)}` : "";
      try {
        while (alive.current) {
          const data: StatusPayload | null = await fetch(`/api/projects/${projectId}/research/status${qs}`)
            .then((r) => r.json())
            .catch(() => null);
          if (data) {
            apply(data);
            if (data.status === "complete") {
              setStatus("complete");
              setProgress(100);
              setEta(null);
              router.refresh();
              return;
            }
            if (data.status === "error") {
              setStatus("error");
              setError(data.error || "Research failed");
              router.refresh();
              return;
            }
          }
          await new Promise((r) => setTimeout(r, 2000));
        }
      } finally {
        polling.current = false;
      }
    },
    [projectId, apply, router]
  );

  const startResearch = useCallback(async () => {
    setStatus("running");
    setProgress(0);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/research`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) throw new Error(data?.error || "Failed to start research");
      await poll(data.jobId);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }, [projectId, poll]);

  useEffect(() => {
    alive.current = true;
    async function bootstrap() {
      const last: StatusPayload | null = await fetch(`/api/projects/${projectId}/research/status`)
        .then((r) => r.json())
        .catch(() => null);
      if (!alive.current) return;
      if (last) apply(last);
      if (last?.status === "running" || last?.status === "pending") {
        void poll(last.jobId);
        return;
      }

      const project = await fetch(`/api/projects/${projectId}`)
        .then((r) => r.json())
        .catch(() => null);
      if (!alive.current || !project) return;

      const hasResults = project._count?.contentAssets > 0 || !!project.brandHealthScore;
      if (project.status === "ERROR") {
        setStatus("error");
        setError(last?.error || "Research failed. Try again.");
      } else if (project.status === "DRAFT" || (project.status === "RESEARCHING" && !hasResults)) {
        // A brand-new project lands here straight from the form: start its
        // first run rather than showing an empty page.
        await startResearch();
      } else if (last?.status) {
        setStatus("complete");
        setProgress(100);
      }
    }
    void bootstrap();

    const onStarted = (e: Event) => void poll((e as CustomEvent<{ jobId?: string }>).detail?.jobId);
    window.addEventListener(RESEARCH_STARTED_EVENT, onStarted);
    return () => {
      alive.current = false;
      window.removeEventListener(RESEARCH_STARTED_EVENT, onStarted);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const pendingWorker = sources.filter((s) => s.status === "pending_worker");
  const missingKeys = sources.filter((s) => s.status === "skipped_no_key");
  const ranCount = sources.filter((s) => s.status === "ran").length;

  // Worker-backed sources finish minutes after the run does. Without this the
  // ledger sits on "pending local worker" until someone re-runs research.
  useEffect(() => {
    if (status !== "complete" || pendingWorker.length === 0) return;
    let cancelled = false;
    let rounds = 0;
    const timer = setInterval(async () => {
      if (cancelled || ++rounds > 30) return clearInterval(timer);
      const data: StatusPayload | null = await fetch(`/api/projects/${projectId}/research/status`)
        .then((r) => r.json())
        .catch(() => null);
      if (cancelled || !data) return;
      apply(data);
      if (!(data.sources || []).some((s) => s.status === "pending_worker")) {
        clearInterval(timer);
        router.refresh();
      }
    }, 10000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [status, pendingWorker.length, projectId, apply, router]);

  if (status === "idle" && sources.length === 0) return null;

  const running = status === "running";

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "rounded-lg border bg-card overflow-hidden",
        running ? "border-[var(--status-ai)]" : status === "error" ? "border-[var(--status-urgent)]" : "border-border"
      )}
    >
      <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-semibold flex items-center gap-2">
            {running && <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--status-ai-fg)]" />}
            {running
              ? "Researching competitors and ads"
              : status === "error"
                ? "Research failed"
                : pendingWorker.length
                  ? "Research partly complete"
                  : "Research complete"}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {running
              ? steps.find((s) => s.status === "running")?.name ?? "Starting…"
              : status === "error"
                ? error
                : `${ranCount} of ${sources.length} sources returned results` +
                  (missingKeys.length ? ` · ${missingKeys.length} skipped for a missing key` : "") +
                  (pendingWorker.length ? ` · ${pendingWorker.length} waiting on the local worker` : "")}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {running && (
            <div className="text-right">
              <p className="text-sm font-semibold num">{Math.round(progress)}%</p>
              <p className="text-[11px] text-muted-foreground num">
                {eta != null ? `~${formatDuration(eta)} left` : "estimating…"}
              </p>
            </div>
          )}
          {!running && (
            <button
              type="button"
              onClick={startResearch}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
              title="Collect fresh data from every source"
            >
              <Play className="h-3 w-3" />
              {status === "error" ? "Retry research" : "Re-run research"}
            </button>
          )}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={expanded ? "Hide research details" : "Show research details"}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {running && <Progress value={progress} className="px-4 pb-3" aria-label="Research progress" />}

      {expanded && (
        <div className="border-t border-border px-4 py-4 space-y-4">
          {steps.length > 0 && (
            <div className="space-y-1">
              {steps.map((step) => (
                <div key={step.name}>
                  <div className="flex items-start gap-3 py-1.5">
                    <div className="shrink-0 mt-0.5">
                      <StepIcon status={step.status} />
                    </div>
                    <div className="min-w-0">
                      <p className={cn("text-sm font-medium", step.status === "pending" && "text-muted-foreground")}>
                        {step.name}
                      </p>
                      {step.message && (
                        <p className="text-[11px] text-muted-foreground mt-0.5 break-words">{step.message}</p>
                      )}
                    </div>
                  </div>
                  {step.subSteps && step.subSteps.length > 0 && (
                    <div className="ml-[1.625rem] space-y-1 pb-1">
                      {step.subSteps.map((sub) => (
                        <div key={sub.name} className="flex items-start gap-2.5 py-0.5">
                          <div className="shrink-0 mt-0.5">
                            <StepIcon status={sub.status} small />
                          </div>
                          <p className={cn("text-xs", sub.status === "pending" ? "text-muted-foreground" : "text-foreground/80")}>
                            {sub.name.split(" · ").slice(1).join(" · ")}
                            {sub.message && (
                              <span className="block text-[10px] text-muted-foreground break-words">{sub.message}</span>
                            )}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {sources.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Sources searched</p>
              <ul className="space-y-1.5">
                {sources.map((s) => (
                  <li key={s.name} className="flex items-start justify-between gap-3 text-xs">
                    <div className="min-w-0">
                      <span className="font-medium">{SOURCE_LABELS[s.name] ?? s.name}</span>
                      {s.note && <span className="block text-[11px] text-muted-foreground break-words">{s.note}</span>}
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
                {missingKeys.length} source{missingKeys.length !== 1 ? "s" : ""} skipped for a missing API key —
                see System status. Everything else still ran.
              </span>
            </div>
          )}

          {pendingWorker.length > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
              <Laptop className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                {pendingWorker.length} ad-library fetch{pendingWorker.length !== 1 ? "es are" : " is"} queued for the
                local research worker. Results appear here once it runs.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
