"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { GOAL_TYPE_INFO, isGoalType, type StyleCategory } from "@/lib/style-categories";

export interface StyleEvidence {
  id: string;
  title: string;
  url: string;
  thumbnailUrl: string | null;
  overallScore: number | null;
  platform: string | null;
}

export interface StyleCategoryView extends StyleCategory {
  recommended: boolean;
  patterns: { id: string; name: string; avgPerformance: number | null }[];
  evidence: StyleEvidence[];
  adCount: number;
  avgScore: number | null;
}

const MAX_STYLES = 3;

/**
 * "Pick a style": the analysed ads grouped into style categories, each with
 * the patterns and best-scoring example ads behind it. The pick is saved and
 * every angle and script is written in the chosen styles.
 */
export function StylePicker({
  projectId,
  goalType,
  categories,
  initial,
}: {
  projectId: string;
  goalType: string | null;
  categories: StyleCategoryView[];
  initial: string[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(initial);
  const [error, setError] = useState<string | null>(null);

  async function toggle(id: string) {
    const prev = selected;
    const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(-MAX_STYLES);
    setSelected(next);
    setError(null);
    const res = await fetch(`/api/projects/${projectId}/campaign-selection`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ styleCategories: next }),
    }).catch(() => null);
    if (!res?.ok) {
      setSelected(prev);
      setError("Couldn't save the style — try again.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">Pick your ad style</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Choose up to {MAX_STYLES}. Angles and scripts are written only in the styles you pick.
            {isGoalType(goalType)
              ? ` Recommended for ${GOAL_TYPE_INFO[goalType].label.toLowerCase()}.`
              : " Set a creative goal on Setup to get recommendations."}
          </p>
        </div>
        <p className="text-xs text-muted-foreground num">
          {selected.length} of {MAX_STYLES} picked
        </p>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {categories.map((c) => {
          const on = selected.includes(c.id);
          return (
            <div
              key={c.id}
              className={cn(
                "rounded-xl border bg-card p-4 flex flex-col gap-3",
                on ? "border-foreground ring-1 ring-foreground/20" : "border-border"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold flex items-center gap-2 flex-wrap">
                    {c.label}
                    {c.recommended && isGoalType(goalType) && goalType !== "hybrid" && (
                      <span className="rounded-full bg-[var(--status-ai-bg)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--status-ai-fg)]">
                        Recommended
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{c.description}</p>
                </div>
                <button
                  type="button"
                  onClick={() => toggle(c.id)}
                  aria-pressed={on}
                  className={cn(
                    "shrink-0 inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium border",
                    on ? "bg-foreground text-background border-foreground" : "border-border hover:bg-muted"
                  )}
                >
                  {on && <Check className="h-3 w-3" />}
                  {on ? "Using" : "Use this style"}
                </button>
              </div>

              <p className="text-[11px] text-muted-foreground num">
                {c.adCount} analysed ad{c.adCount !== 1 ? "s" : ""}
                {c.avgScore != null ? ` · avg score ${Math.round(c.avgScore)}` : ""}
                {c.patterns.length ? ` · ${c.patterns.map((p) => p.name).join(", ")}` : ""}
              </p>

              {c.evidence.length > 0 ? (
                <ul className="space-y-1.5" aria-label={`Best ${c.label} examples`}>
                  {c.evidence.map((e) => (
                    <li key={e.id} className="flex items-center gap-2">
                      {e.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={e.thumbnailUrl} alt="" className="h-9 w-9 rounded object-cover shrink-0 bg-muted" />
                      ) : (
                        <span className="h-9 w-9 rounded bg-muted shrink-0" />
                      )}
                      <Link
                        href={`/projects/${projectId}/insights/${e.id}`}
                        className="min-w-0 flex-1 text-xs hover:underline truncate"
                      >
                        {e.title}
                      </Link>
                      <span className="text-[11px] num text-muted-foreground shrink-0">
                        {e.overallScore != null ? Math.round(e.overallScore) : "—"}
                      </span>
                      <a
                        href={e.url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Open ${e.title} on ${e.platform ?? "the platform"}`}
                        className="text-muted-foreground hover:text-foreground shrink-0"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-muted-foreground">No analysed competitor ads in this style yet.</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
