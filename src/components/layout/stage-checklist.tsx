import { CheckCircle2, Circle } from "lucide-react";
import type { StageCriterion } from "@/services/project-stages";

/** What this stage needs before it counts as done — shown under the next-step banner. */
export function StageChecklist({ criteria }: { criteria: StageCriterion[] }) {
  if (criteria.length < 2) return null;
  return (
    <ul className="mt-2 space-y-1 px-1" aria-label="What this step needs">
      {criteria.map((c) => (
        <li key={c.label} className="flex items-center gap-2 text-xs">
          {c.met ? (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[var(--status-healthy-fg)]" />
          ) : (
            <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
          )}
          <span className={c.met ? "text-muted-foreground line-through" : "text-foreground"}>{c.label}</span>
        </li>
      ))}
    </ul>
  );
}
