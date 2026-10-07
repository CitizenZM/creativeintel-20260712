import { cn } from "@/lib/utils";

export function MiniScoreBar({ value, className }: { value: number; className?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={cn("flex items-center gap-1.5", className)} title={`priority score ${v}/100`}>
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", v >= 75 ? "bg-emerald-500" : v >= 55 ? "bg-sky-500" : "bg-amber-500")} style={{ width: `${v}%` }} />
      </div>
      <span className="text-[10px] tabular-nums text-muted-foreground">{v}</span>
    </div>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{children}</p>;
}
