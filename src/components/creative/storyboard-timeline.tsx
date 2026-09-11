"use client";

import { cn } from "@/lib/utils";
import { SEGMENT_STYLES, SEGMENT_ORDER, segmentStyle } from "./segment-styles";

export interface TimelineFrame {
  frameNumber: number;
  duration: string;
  startSec?: number;
  endSec?: number;
  segment?: string;
  scene?: string;
  imageUrl?: string | null;
  approved?: boolean | null;
}

/**
 * Horizontal 2-second timeline strip. One cell per frame, coloured by segment,
 * so the hook / body / CTA split of a board is readable at a glance.
 */
export function StoryboardTimeline({
  frames,
  frameSeconds = 2,
  activeFrame,
  onSelectFrame,
}: {
  frames: TimelineFrame[];
  frameSeconds?: number;
  activeFrame?: number | null;
  onSelectFrame?: (frameNumber: number) => void;
}) {
  if (!frames.length) return null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {SEGMENT_ORDER.map((seg) => (
            <span key={seg} className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <span className={cn("h-2 w-2 rounded-sm", SEGMENT_STYLES[seg].dot)} />
              {SEGMENT_STYLES[seg].label}
            </span>
          ))}
        </div>
        <span className="text-[10px] text-muted-foreground num">
          {frames.length} frames · {frameSeconds}s each
        </span>
      </div>

      <div className="overflow-x-auto">
        <div className="flex gap-0.5 min-w-max">
          {frames.map((f) => {
            const style = segmentStyle(f.segment);
            const isActive = activeFrame === f.frameNumber;
            return (
              <button
                key={f.frameNumber}
                onClick={() => onSelectFrame?.(f.frameNumber)}
                title={`${f.duration} · ${style.label}${f.scene ? ` — ${f.scene}` : ""}`}
                className={cn(
                  "group relative flex flex-col items-stretch w-14 shrink-0 rounded-sm overflow-hidden border transition-all",
                  isActive ? "border-foreground ring-1 ring-foreground/30" : "border-transparent hover:border-foreground/30"
                )}
              >
                <span className={cn("h-1.5 w-full", style.bar)} />
                <span className="bg-muted/60 px-1 py-1 text-left">
                  <span className="block text-[9px] font-semibold num">#{f.frameNumber}</span>
                  <span className="block text-[8px] text-muted-foreground num">{f.duration}</span>
                </span>
                {f.approved === true && (
                  <span className="absolute top-0 right-0 h-1.5 w-1.5 rounded-full bg-emerald-500" />
                )}
                {f.approved === false && (
                  <span className="absolute top-0 right-0 h-1.5 w-1.5 rounded-full bg-red-500" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
