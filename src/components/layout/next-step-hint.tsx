import { ArrowDown, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Says what to do next, in the place where you would do it. Pair it with
 * `cta-attention` on the one control it refers to — the banner explains, the
 * glow points.
 */
export function NextStepHint({
  step,
  title,
  detail,
  className,
}: {
  /** e.g. "Step 2" — omit for a hint that is not part of a numbered flow. */
  step?: string;
  title: string;
  detail?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-md border border-[var(--status-ai-fg)]/25 bg-[var(--status-ai-bg)] px-3 py-2.5",
        className
      )}
    >
      <Sparkles className="h-4 w-4 shrink-0 mt-0.5 text-[var(--status-ai-fg)]" />
      <div className="min-w-0 text-xs text-[var(--status-ai-fg)]">
        <p className="font-semibold">
          {step ? `${step} — ` : ""}
          {title}
        </p>
        {detail && <p className="mt-0.5 opacity-90">{detail}</p>}
      </div>
      <ArrowDown className="h-4 w-4 shrink-0 mt-0.5 ml-auto text-[var(--status-ai-fg)] opacity-70" />
    </div>
  );
}
