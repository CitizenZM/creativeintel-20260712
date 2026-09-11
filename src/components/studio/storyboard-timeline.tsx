"use client";

import { cn } from "@/lib/utils";
import { segmentStyle, SEGMENT_ORDER, SEGMENT_STYLES } from "@/components/creative/segment-styles";
import { CheckCircle2, CircleDashed, Clapperboard, Image as ImageIcon, Loader2, XCircle } from "lucide-react";
import type { LibtvRunView, StoryboardView } from "./types";
import { jobsByNode } from "./types";

const STATUS_ICON: Record<string, typeof CheckCircle2> = {
  completed: CheckCircle2,
  running: Loader2,
  failed: XCircle,
  skipped: Clapperboard,
  queued: CircleDashed,
};

function NodeChip({
  label,
  status,
  credits,
}: {
  label: string;
  status: string | null;
  credits: number | null;
}) {
  const Icon = status ? STATUS_ICON[status] ?? CircleDashed : CircleDashed;
  const tone =
    status === "completed"
      ? "text-emerald-600"
      : status === "failed"
        ? "text-red-600"
        : status === "running"
          ? "text-blue-600"
          : "text-muted-foreground";
  return (
    <span className={cn("flex items-center gap-1 text-[10px] font-medium", tone)}>
      <Icon className={cn("h-3 w-3", status === "running" && "animate-spin")} />
      {label}
      {credits ? <span className="text-muted-foreground">· {credits}</span> : null}
    </span>
  );
}

export function StoryboardTimeline({
  storyboard,
  run,
  onSelectFrame,
  selectedFrame,
}: {
  storyboard: StoryboardView | null;
  run: LibtvRunView | null;
  onSelectFrame?: (frameNumber: number) => void;
  selectedFrame?: number | null;
}) {
  if (!storyboard) {
    return (
      <div className="rounded-lg border border-border bg-card py-12 text-center">
        <ImageIcon className="mx-auto mb-2 h-7 w-7 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">
          No storyboard selected. Generate one on the Create tab first.
        </p>
      </div>
    );
  }

  const nodes = jobsByNode(run);
  const frameSeconds = storyboard.frameSeconds || 2;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">{storyboard.title}</h3>
          <p className="text-xs text-muted-foreground">
            {storyboard.frames.length} frames · {frameSeconds}s grid
            {storyboard.totalDuration ? ` · ${storyboard.totalDuration}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {SEGMENT_ORDER.map((segment) => (
            <span key={segment} className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <span className={cn("h-2 w-2 rounded-full", SEGMENT_STYLES[segment].dot)} />
              {SEGMENT_STYLES[segment].label}
            </span>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto pb-2">
        <div className="flex min-w-max gap-2">
          {storyboard.frames.map((frame, i) => {
            const n = frame.frameNumber ?? i + 1;
            const style = segmentStyle(frame.segment);
            const keyframe = nodes.get(`K${n}`);
            const clip = nodes.get(`V${n}`);
            const thumb = keyframe?.resultUrl?.startsWith("http") ? keyframe.resultUrl : frame.imageUrl || null;
            const credits = (keyframe?.creditsEstimated ?? 0) + (clip?.creditsEstimated ?? 0);
            const start = frame.startSec ?? i * frameSeconds;
            const end = frame.endSec ?? start + frameSeconds;

            return (
              <button
                key={n}
                type="button"
                onClick={() => onSelectFrame?.(n)}
                className={cn(
                  "w-[132px] shrink-0 overflow-hidden rounded-md border bg-background text-left transition-colors",
                  selectedFrame === n ? "border-foreground" : style.border,
                  "hover:border-foreground/60"
                )}
              >
                <div className={cn("h-1 w-full", style.bar)} />
                <div className="relative aspect-[9/16] bg-muted">
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <ImageIcon className="h-5 w-5 text-muted-foreground/40" />
                    </div>
                  )}
                  <span className="absolute left-1.5 top-1.5 rounded-full bg-foreground/80 px-1.5 py-0.5 text-[9px] font-bold text-background">
                    F{n}
                  </span>
                  <span className="absolute right-1.5 top-1.5 rounded-full bg-foreground/80 px-1.5 py-0.5 text-[9px] font-medium text-background">
                    {start}–{end}s
                  </span>
                </div>
                <div className="space-y-1 p-2">
                  <p className="line-clamp-2 text-[11px] leading-snug">{frame.scene || frame.textOverlay || "—"}</p>
                  <div className="flex items-center justify-between gap-1">
                    <NodeChip label={`K${n}`} status={keyframe?.status ?? null} credits={keyframe?.creditsEstimated ?? null} />
                    {clip ? (
                      <NodeChip label={`V${n}`} status={clip.status} credits={clip.creditsEstimated} />
                    ) : (
                      <span className="text-[10px] text-muted-foreground">local card</span>
                    )}
                  </div>
                  {credits > 0 && (
                    <p className="text-[10px] text-muted-foreground">{credits} credits</p>
                  )}
                  {(keyframe?.error || clip?.error) && (
                    <p className="line-clamp-2 text-[10px] text-red-600">{keyframe?.error || clip?.error}</p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
