import { CANVAS, SAFE, parseEndCardLayout, type LayoutKind } from "./view-model";
import { cn } from "@/lib/utils";

const FILL: Record<LayoutKind, string> = {
  logo: "fill-slate-500/70",
  product: "fill-sky-500/45",
  cta: "fill-fuchsia-600/80",
  text: "fill-foreground/25",
  accent: "fill-amber-500/70",
};

/** Lightweight 9:16 wireframe of an end-card layout, with the strict safe box (y 288–1220) shaded. */
export function EndCardMock({ layout, className, title }: { layout: string; className?: string; title?: string }) {
  const boxes = parseEndCardLayout(layout);
  return (
    <svg viewBox={`0 0 ${CANVAS.w} ${CANVAS.h}`} role="img" aria-label={title ? `${title} layout mock` : "End-card layout mock"} className={cn("h-auto w-full rounded-md", className)}>
      <rect x={0} y={0} width={CANVAS.w} height={CANVAS.h} rx={48} className="fill-muted stroke-border" strokeWidth={8} />
      <rect x={0} y={SAFE.y0} width={CANVAS.w} height={SAFE.y1 - SAFE.y0} className="fill-emerald-500/10 stroke-emerald-600/60" strokeWidth={6} strokeDasharray="28 18" />
      <text x={24} y={SAFE.y0 - 20} className="fill-emerald-700 dark:fill-emerald-400" fontSize={44}>safe 288–1220</text>
      {boxes.map((b, i) => (
        <g key={i}>
          <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={b.kind === "cta" ? Math.min(b.h / 2, 56) : 18} className={FILL[b.kind]} />
          {b.h >= 60 && (
            <text x={b.x + b.w / 2} y={b.y + b.h / 2} textAnchor="middle" dominantBaseline="central" fontSize={Math.min(56, b.h * 0.5)} className="fill-foreground font-medium">
              {b.label.length > 18 ? `${b.label.slice(0, 17)}…` : b.label}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
