import type { FrameSegment } from "@/lib/storyboard-grid";

export interface SegmentStyle {
  label: string;
  /** Timeline strip fill. */
  bar: string;
  /** Badge on a frame card. */
  badge: string;
  /** Card border accent. */
  border: string;
  /** Legend dot. */
  dot: string;
}

export const SEGMENT_STYLES: Record<FrameSegment, SegmentStyle> = {
  HOOK: {
    label: "Hook",
    bar: "bg-amber-400",
    badge: "bg-amber-100 text-amber-800 border-amber-300",
    border: "border-amber-300",
    dot: "bg-amber-400",
  },
  BODY: {
    label: "Body",
    bar: "bg-slate-400",
    badge: "bg-slate-100 text-slate-700 border-slate-300",
    border: "border-slate-300",
    dot: "bg-slate-400",
  },
  CTA: {
    label: "CTA",
    bar: "bg-emerald-500",
    badge: "bg-emerald-100 text-emerald-800 border-emerald-300",
    border: "border-emerald-300",
    dot: "bg-emerald-500",
  },
};

export const SEGMENT_ORDER: FrameSegment[] = ["HOOK", "BODY", "CTA"];

export function segmentStyle(segment: string | null | undefined): SegmentStyle {
  const key = (segment ?? "").toUpperCase() as FrameSegment;
  return SEGMENT_STYLES[key] ?? SEGMENT_STYLES.BODY;
}
