import { cn } from "@/lib/utils";
import type { PlanBeat } from "@/services/creative/campaign-plan.types";
import { PURPOSE_STYLE, beatTimeline, fmtSec, timelineTotal } from "./view-model";

/** Horizontal beat bar (t0/t1, colored by purpose) + the beat sheet underneath. */
export function BeatTimeline({ beats, durationSec, compact }: { beats: PlanBeat[]; durationSec?: number; compact?: boolean }) {
  const segs = beatTimeline(beats, durationSec);
  const total = timelineTotal(beats, durationSec);
  if (!segs.length) return <p className="text-xs text-muted-foreground">No beats.</p>;
  const purposes = [...new Set(segs.map((s) => s.purpose))];
  return (
    <div className="space-y-2">
      <div className="relative h-8 w-full overflow-hidden rounded-md bg-muted" role="img" aria-label="Beat timeline">
        {segs.map((s, i) => (
          <div
            key={i}
            className={cn("absolute top-0 flex h-full items-center overflow-hidden border-r border-background px-1 text-[10px] font-medium text-white", PURPOSE_STYLE[s.purpose]?.bar ?? "bg-slate-500")}
            style={{ left: `${s.leftPct}%`, width: `${s.widthPct}%` }}
            title={`${fmtSec(s.t0)}–${fmtSec(s.t1)} ${s.purpose}: ${s.onScreenText ?? s.visual}`}
          >
            <span className="truncate">{PURPOSE_STYLE[s.purpose]?.label ?? s.purpose}</span>
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[10px] tabular-nums text-muted-foreground">
        <span>0s</span>
        <span>{fmtSec(Math.round(total * 10) / 10)}</span>
      </div>
      <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
        {purposes.map((p) => (
          <span key={p} className="flex items-center gap-1">
            <span className={cn("h-2 w-2 rounded-sm", PURPOSE_STYLE[p]?.bar)} /> {PURPOSE_STYLE[p]?.label ?? p}
          </span>
        ))}
      </div>
      {!compact && (
        <ol className="divide-y divide-border rounded-md border text-xs">
          {segs.map((s, i) => (
            <li key={i} className="grid gap-1 px-2.5 py-2 sm:grid-cols-[5.5rem_1fr_1fr_1fr]">
              <span className="flex items-center gap-1.5 tabular-nums text-muted-foreground">
                <span className={cn("h-2 w-2 shrink-0 rounded-sm", PURPOSE_STYLE[s.purpose]?.bar)} />
                {fmtSec(s.t0)}–{fmtSec(s.t1)}
              </span>
              <span>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Visual </span>
                {s.visual}
                {s.shotType && <span className="ml-1 font-mono text-[10px] text-muted-foreground">[{s.shotType}]</span>}
              </span>
              <span>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">VO </span>
                {s.vo || "—"}
              </span>
              <span>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">On screen </span>
                {s.onScreenText ? <span className="font-medium">&ldquo;{s.onScreenText}&rdquo;</span> : "—"}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
