"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  CheckCircle2,
  Clapperboard,
  Download,
  ExternalLink,
  Grid2x2,
  KeyRound,
  Loader2,
  Play,
  ShieldCheck,
  Ban,
} from "lucide-react";
import { estimateBoard } from "@/services/video-gen/libtv-pricing";
import type {
  BrandKitReadiness,
  BudgetMode,
  LibtvRunView,
  ModelOptionView,
  RunLimits,
  StoryboardView,
} from "./types";
import { isPlayable, isRunActive } from "./types";

const POLL_MS = 5000;

const BUDGET_MODES: Array<{ value: BudgetMode; label: string; hint: string }> = [
  { value: "economy", label: "Economy", hint: "one clip covers up to 3 frames — cuts made locally" },
  { value: "full", label: "Full", hint: "one clip per frame — 3x the credits" },
];

const STATUS_TONE: Record<string, string> = {
  awaiting_approval: "bg-amber-100 text-amber-800 border-amber-300",
  approved: "bg-blue-100 text-blue-800 border-blue-300",
  claimed: "bg-blue-100 text-blue-800 border-blue-300",
  running: "bg-blue-100 text-blue-800 border-blue-300",
  assembling: "bg-violet-100 text-violet-800 border-violet-300",
  completed: "bg-emerald-100 text-emerald-800 border-emerald-300",
  failed: "bg-red-100 text-red-800 border-red-300",
  cancelled: "bg-slate-100 text-slate-700 border-slate-300",
};

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        STATUS_TONE[status] ?? "bg-slate-100 text-slate-700 border-slate-300"
      )}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

export function LibtvRunPanel({
  projectId,
  storyboard,
  models,
  brandKit,
  runs,
  activeRun,
  limits,
  onSelectRun,
  onRunsChanged,
  onPlanChange,
}: {
  projectId: string;
  storyboard: StoryboardView | null;
  models: { image: ModelOptionView[]; video: ModelOptionView[] };
  brandKit: BrandKitReadiness | null;
  runs: LibtvRunView[];
  activeRun: LibtvRunView | null;
  limits: RunLimits | null;
  onSelectRun: (runId: string) => void;
  onRunsChanged: (run?: LibtvRunView) => void;
  onPlanChange?: (plan: { budgetMode: BudgetMode; clipDurationSec: number }) => void;
}) {
  const [imageModel, setImageModel] = useState("Seedream 4.0");
  const [videoModel, setVideoModel] = useState("Hailuo 2.3 Fast");
  const [clipDurationSec, setClipDurationSec] = useState(6);
  const [budgetMode, setBudgetMode] = useState<BudgetMode>("economy");
  const [allowOverBudget, setAllowOverBudget] = useState(false);
  const [creditCap, setCreditCap] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);

  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const videoOption = useMemo(
    () => models.video.find((m) => m.name === videoModel) ?? models.video[0],
    [models.video, videoModel]
  );
  const imageOption = useMemo(
    () => models.image.find((m) => m.name === imageModel) ?? models.image[0],
    [models.image, imageModel]
  );

  const durations = videoOption?.durations?.length ? videoOption.durations : [6];
  const effectiveDuration = durations.includes(clipDurationSec) ? clipDurationSec : durations[0];

  const frameCount = storyboard?.frames.length ?? 0;
  const maxCredits = limits?.maxRunCredits ?? 120;

  const board = useMemo(() => {
    if (!storyboard || !storyboard.frames.length) return null;
    return estimateBoard({
      frames: storyboard.frames.map((frame, i) => ({
        frameNumber: frame.frameNumber ?? i + 1,
        isCta: (frame.segment || "").toUpperCase() === "CTA",
      })),
      mode: budgetMode,
      clipDurationSec: effectiveDuration,
      frameSeconds: storyboard.frameSeconds || 2,
      imageModel,
      videoModel,
    });
  }, [storyboard, budgetMode, effectiveDuration, imageModel, videoModel]);

  const estimate = board?.total ?? 0;
  // LibTV shows the balance only in its own web UI, so what this panel can
  // honestly report is what the project has already spent.
  const spentSoFar = runs.reduce((sum, r) => sum + (r.creditsSpent || 0), 0);
  const ctaFrames = board?.ctaCount ?? 0;
  const overBudget = estimate > maxCredits;

  useEffect(() => {
    onPlanChange?.({ budgetMode, clipDurationSec: effectiveDuration });
  }, [budgetMode, effectiveDuration, onPlanChange]);

  const refreshRun = useCallback(
    async (runId: string) => {
      const res = await fetch(`/api/projects/${projectId}/studio/libtv-runs/${runId}`);
      const data = await res.json().catch(() => ({}));
      if (data.run) onRunsChanged(data.run as LibtvRunView);
    },
    [projectId, onRunsChanged]
  );

  useEffect(() => {
    const shouldPoll = !!activeRun && isRunActive(activeRun.status);
    if (!shouldPoll) {
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
      return;
    }
    if (pollTimer.current) return;
    const runId = activeRun.id;
    pollTimer.current = setInterval(() => {
      refreshRun(runId).catch(() => null);
    }, POLL_MS);
    return () => {
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    };
  }, [activeRun, refreshRun]);

  async function post(path: string, body?: unknown) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `Request failed (${res.status})`) as Error & { missing?: string[] };
      err.missing = data.missing;
      throw err;
    }
    return data;
  }

  async function compile() {
    if (!storyboard) return;
    setBusy("compile");
    setError(null);
    setMissing([]);
    try {
      const data = await post(`/api/projects/${projectId}/studio/libtv-runs`, {
        storyboardId: storyboard.id,
        scriptId: storyboard.scriptId,
        imageModel,
        videoModel,
        clipDurationSec: effectiveDuration,
        aspectRatio: "9:16",
        budgetMode,
        allowOverBudget,
      });
      onRunsChanged(data.run as LibtvRunView);
      if (data.run?.id) onSelectRun(data.run.id);
    } catch (err) {
      const e = err as Error & { missing?: string[] };
      setError(e.message);
      setMissing(e.missing ?? []);
    } finally {
      setBusy(null);
    }
  }

  async function approve() {
    if (!activeRun) return;
    setBusy("approve");
    setError(null);
    setMissing([]);
    try {
      const cap = creditCap.trim() ? Number(creditCap) : undefined;
      const data = await post(
        `/api/projects/${projectId}/studio/libtv-runs/${activeRun.id}/approve`,
        cap ? { creditCap: cap } : {}
      );
      onRunsChanged(data.run as LibtvRunView);
    } catch (err) {
      const e = err as Error & { missing?: string[] };
      setError(e.message);
      setMissing(e.missing ?? []);
    } finally {
      setBusy(null);
    }
  }

  async function cancel() {
    if (!activeRun) return;
    setBusy("cancel");
    try {
      const data = await post(`/api/projects/${projectId}/studio/libtv-runs/${activeRun.id}/cancel`);
      onRunsChanged(data.run as LibtvRunView);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const needsLogin = !!activeRun?.error?.startsWith("needs libtv login");
  const unplayableMaster = !!activeRun?.masterMp4Url && !isPlayable(activeRun.masterMp4Url);
  const failedJobs = (activeRun?.jobs ?? []).filter((j) => j.status === "failed" && j.error);
  const done = (activeRun?.jobs ?? []).filter((j) => j.status === "completed" || j.status === "skipped").length;
  const total = activeRun?.jobs.length ?? 0;

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <Clapperboard className="h-4 w-4 text-muted-foreground" />
            LibTV production run
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Keyframes and clips render on LibTV; text, CTA cards and the final cut are built locally.
          </p>
        </div>
        {activeRun && <StatusPill status={activeRun.status} />}
      </div>

      {brandKit && !brandKit.ready.studio && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-900">
            <AlertTriangle className="h-3.5 w-3.5" />
            Brand kit {brandKit.score}/100 — approval is blocked until it is studio-ready
          </p>
          <ul className="mt-1.5 space-y-0.5 pl-5 text-[11px] text-amber-900">
            {brandKit.missing.slice(0, 6).map((m) => (
              <li key={m} className="list-disc">{m}</li>
            ))}
          </ul>
        </div>
      )}

      {needsLogin && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-red-900">
            <KeyRound className="h-3.5 w-3.5" />
            LibTV needs a new login
          </p>
          <p className="mt-1 text-[11px] text-red-900">
            The worker&apos;s token expired mid-run. Run{" "}
            <code className="rounded bg-red-100 px-1">~/.libtv/libtv login web</code> on the operator&apos;s Mac,
            restart the worker, then re-approve this run.
          </p>
        </div>
      )}

      {/* Model pickers */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Keyframe model
          </span>
          <select
            value={imageModel}
            onChange={(e) => setImageModel(e.target.value)}
            className="h-9 w-full rounded-md border border-border bg-background px-2 text-xs"
          >
            {models.image.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name} — {m.credits} {m.unit}
                {m.verified ? "" : " (unverified)"}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Clip model
          </span>
          <select
            value={videoModel}
            onChange={(e) => setVideoModel(e.target.value)}
            className="h-9 w-full rounded-md border border-border bg-background px-2 text-xs"
          >
            {models.video.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name} — {m.credits} {m.unit}
                {m.verified ? "" : " (unverified)"}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Clip duration
          </span>
          <select
            value={effectiveDuration}
            onChange={(e) => setClipDurationSec(Number(e.target.value))}
            className="h-9 w-full rounded-md border border-border bg-background px-2 text-xs"
          >
            {durations.map((d) => (
              <option key={d} value={d}>
                {d}s
              </option>
            ))}
          </select>
        </label>
      </div>

      {imageOption?.note && <p className="text-[10px] text-muted-foreground">{imageOption.note}</p>}
      {videoOption?.note && <p className="text-[10px] text-muted-foreground">{videoOption.note}</p>}

      {/* Budget mode */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Budget mode</span>
        <div className="inline-flex overflow-hidden rounded-md border border-border">
          {BUDGET_MODES.map((mode) => (
            <button
              key={mode.value}
              type="button"
              onClick={() => setBudgetMode(mode.value)}
              title={mode.hint}
              className={cn(
                "px-2.5 py-1 text-[11px] font-medium transition-colors",
                budgetMode === mode.value
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {mode.label}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-muted-foreground">
          {BUDGET_MODES.find((m) => m.value === budgetMode)?.hint}
          {board ? ` · ${board.perClip} frame${board.perClip === 1 ? "" : "s"} per clip` : ""}
        </span>
      </div>

      {/* Estimate + compile */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/30 p-3">
        <div className="text-xs">
          <p className="font-semibold">
            {frameCount} frames · {board?.keyframeCount ?? 0} keyframes + {board?.clipCount ?? 0} clips
          </p>
          <p className="text-muted-foreground">
            {ctaFrames} CTA frame{ctaFrames === 1 ? "" : "s"} composited locally · estimate{" "}
            <span className={cn("font-semibold", overBudget ? "text-red-700" : "text-foreground")}>
              {estimate} credits
            </span>{" "}
            of {maxCredits} allowed
          </p>
          <p className="text-muted-foreground">
            {/* LibTV shows the balance only in its own web UI, so the honest
                thing to surface here is what this project has already spent. */}
            Spent on this project so far:{" "}
            <span className="font-semibold text-foreground">{spentSoFar} credits</span>
            {" "}across {runs.length} run{runs.length === 1 ? "" : "s"} · balance is only visible at{" "}
            <a
              href="https://www.liblib.tv/"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-foreground"
            >
              liblib.tv
            </a>
          </p>
          {overBudget && (
            <label className="mt-1 flex items-center gap-1.5 text-[11px] font-medium text-red-700">
              <input
                type="checkbox"
                checked={allowOverBudget}
                onChange={(e) => setAllowOverBudget(e.target.checked)}
                className="h-3 w-3"
              />
              Over the {maxCredits}-credit ceiling — compile anyway
            </label>
          )}
        </div>
        <Button
          onClick={compile}
          disabled={!storyboard || busy === "compile" || (overBudget && !allowOverBudget)}
          size="sm"
          data-testid="compile-run"
          className={cn(
            "h-9 rounded-md bg-foreground text-xs font-medium text-background hover:bg-foreground/90",
            // Only when compiling is genuinely the next move: a board is
            // picked, the kit allows it, and no run is already waiting.
            !!storyboard &&
              !activeRun &&
              busy !== "compile" &&
              !(overBudget && !allowOverBudget) &&
              !(brandKit && !brandKit.ready.studio) &&
              "cta-attention"
          )}
        >
          {busy === "compile" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Grid2x2 className="mr-1.5 h-3.5 w-3.5" />}
          Compile run
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3">
          <p className="text-xs font-semibold text-red-900">{error}</p>
          {missing.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 pl-5 text-[11px] text-red-900">
              {missing.map((m) => (
                <li key={m} className="list-disc">{m}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Run list */}
      {runs.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {runs.slice(0, 8).map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onSelectRun(r.id)}
              className={cn(
                "rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
                activeRun?.id === r.id
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {new Date(r.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} · {r.status}
            </button>
          ))}
        </div>
      )}

      {/* Active run */}
      {activeRun && (
        <div className="space-y-3 rounded-md border border-border p-3">
          <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Estimated</p>
              <p className="font-semibold">{activeRun.creditsEstimated} credits</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Spent</p>
              <p className="font-semibold">{activeRun.creditsSpent} credits</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Cap</p>
              <p className="font-semibold">{activeRun.creditCap ?? "—"}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Nodes</p>
              <p className="font-semibold">
                {done}/{total}
              </p>
            </div>
          </div>

          {activeRun.status === "awaiting_approval" && (
            <div className="flex flex-wrap items-end gap-2">
              <label className="block">
                <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Credit cap (optional)
                </span>
                <input
                  type="number"
                  min={activeRun.creditsEstimated}
                  value={creditCap}
                  onChange={(e) => setCreditCap(e.target.value)}
                  placeholder={String(activeRun.creditsEstimated)}
                  className="h-9 w-32 rounded-md border border-border bg-background px-2 text-xs"
                />
              </label>
              <Button
                onClick={approve}
                disabled={busy === "approve" || !!(brandKit && !brandKit.ready.studio)}
                size="sm"
                data-testid="approve-run"
                className={cn(
                  "h-9 rounded-md bg-foreground text-xs font-medium text-background hover:bg-foreground/90",
                  busy !== "approve" && !(brandKit && !brandKit.ready.studio) && "cta-attention"
                )}
              >
                {busy === "approve" ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
                )}
                Approve {activeRun.creditsEstimated} credits
              </Button>
              <Button onClick={cancel} disabled={busy === "cancel"} size="sm" variant="outline" className="h-9 rounded-md text-xs">
                <Ban className="mr-1.5 h-3.5 w-3.5" />
                Discard
              </Button>
            </div>
          )}

          {activeRun.status === "approved" && (
            <p className="flex items-center gap-1.5 text-xs text-blue-700">
              <Play className="h-3.5 w-3.5" />
              Approved — waiting for the local worker to claim it (<code className="rounded bg-muted px-1">npm run worker:libtv</code>).
            </p>
          )}

          {isRunActive(activeRun.status) && activeRun.status !== "approved" && (
            <p className="flex items-center gap-1.5 text-xs text-blue-700">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {activeRun.status === "assembling" ? "Assembling the cut locally…" : "Rendering on LibTV…"} polling every 5s
            </p>
          )}

          {activeRun.error && !needsLogin && (
            <p className="text-xs text-red-700">{activeRun.error}</p>
          )}

          {failedJobs.length > 0 && (
            <div className="rounded-md border border-red-200 bg-red-50 p-2">
              <p className="text-[11px] font-semibold text-red-900">Failed nodes</p>
              <ul className="mt-1 space-y-0.5 text-[11px] text-red-900">
                {failedJobs.map((j) => (
                  <li key={j.id}>
                    <span className="font-mono">{j.nodeName}</span> — {j.error}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {activeRun.canvasUuid && (
              <a
                href={activeRun.canvasUrl || `https://www.liblib.tv/canvas?projectId=${activeRun.canvasUuid}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center rounded-md border border-border px-2.5 text-xs font-medium hover:border-foreground/40"
              >
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                Open in LibTV
              </a>
            )}
            {activeRun.masterMp4Url && (
              <a
                href={activeRun.masterMp4Url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center rounded-md bg-foreground px-2.5 text-xs font-medium text-background hover:bg-foreground/90"
              >
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Download master
              </a>
            )}
            {activeRun.previewMp4Url && (
              <a
                href={activeRun.previewMp4Url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center rounded-md border border-border px-2.5 text-xs font-medium hover:border-foreground/40"
              >
                720p preview
              </a>
            )}
            {activeRun.contactSheetUrl && (
              <a
                href={activeRun.contactSheetUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center rounded-md border border-border px-2.5 text-xs font-medium hover:border-foreground/40"
              >
                <Grid2x2 className="mr-1.5 h-3.5 w-3.5" />
                Contact sheet
              </a>
            )}
            {activeRun.status === "completed" && (
              <span className="inline-flex h-8 items-center gap-1.5 text-xs text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {activeRun.creditsSpent} credits spent
              </span>
            )}
          </div>

          {(isPlayable(activeRun.previewMp4Url) || isPlayable(activeRun.masterMp4Url)) && (
            <video
              src={isPlayable(activeRun.previewMp4Url) ? activeRun.previewMp4Url : activeRun.masterMp4Url!}
              controls
              playsInline
              preload="metadata"
              className="max-h-96 w-full rounded-md border border-border bg-black object-contain"
            />
          )}

          {unplayableMaster && (
            <p className="text-[11px] text-amber-700">
              The worker reported a <code className="rounded bg-muted px-1">file://</code> path, which the browser
              cannot load. Configure <code className="rounded bg-muted px-1">CLOUDINARY_URL</code> /{" "}
              <code className="rounded bg-muted px-1">BLOB_READ_WRITE_TOKEN</code>, or point{" "}
              <code className="rounded bg-muted px-1">LOCAL_FILES_ROOT</code> at the worker&apos;s runs directory.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
