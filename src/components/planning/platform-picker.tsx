"use client";

import { Check, Clock, Ratio, Timer } from "lucide-react";
import { cn } from "@/lib/utils";
import { PLATFORM_PROFILES } from "@/services/creative/platforms.data";
import type { PlatformId } from "@/services/creative/types";
import { SectionLabel } from "./score-bar";
import { PLATFORM_LABELS, profileSummary } from "./view-model";

/** Multi-select chips for the 12 platform profiles; `focused` is the platform whose profile/picks are shown. */
export function PlatformPicker({
  selected,
  focused,
  onToggle,
  onFocus,
}: {
  selected: PlatformId[];
  focused: PlatformId | null;
  onToggle: (id: PlatformId) => void;
  onFocus: (id: PlatformId) => void;
}) {
  const profile = focused ? PLATFORM_PROFILES.find((p) => p.id === focused) : undefined;
  const summary = profile ? profileSummary(profile) : null;

  return (
    <div className="space-y-3">
      <div role="group" aria-label="Platforms" className="flex flex-wrap gap-1.5">
        {PLATFORM_PROFILES.map((p) => {
          const on = selected.includes(p.id);
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={on}
              onClick={() => {
                onToggle(p.id);
                if (!on) onFocus(p.id);
              }}
              className={cn(
                "flex h-8 items-center gap-1 rounded-full border px-3 text-xs font-medium transition-colors",
                on ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
              )}
            >
              {on && <Check className="h-3 w-3" />}
              {PLATFORM_LABELS[p.id]}
              <span className={cn("ml-1 text-[10px] font-normal", on ? "opacity-70" : "opacity-60")}>{p.audience.ageCore}</span>
            </button>
          );
        })}
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 border-b">
          {selected.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => onFocus(id)}
              className={cn(
                "-mb-px border-b-2 px-2.5 py-1.5 text-xs font-medium",
                focused === id ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {PLATFORM_LABELS[id]}
            </button>
          ))}
        </div>
      )}

      {summary && profile ? (
        <div className="grid gap-4 rounded-lg border p-3 lg:grid-cols-[1fr_1fr]">
          <div className="space-y-2">
            <div className="flex flex-wrap gap-3 text-xs">
              <span className="flex items-center gap-1"><Timer className="h-3.5 w-3.5" /> ideal {profile.durationSec.ideal}s</span>
              <span className="flex items-center gap-1"><Ratio className="h-3.5 w-3.5" /> {Array.isArray(profile.aspect) ? profile.aspect.join(" / ") : profile.aspect}</span>
              <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> hook by {profile.hookSec}s</span>
            </div>
            <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1.5 text-xs">
              {summary.rows.map((r) => (
                <div key={r.label} className="contents">
                  <dt className="text-muted-foreground">{r.label}</dt>
                  <dd>{r.value}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="space-y-3">
            <div>
              <SectionLabel>Do — style that works here</SectionLabel>
              <div className="flex flex-wrap gap-1">
                {summary.dos.map((d) => (
                  <span key={d} className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-700 dark:text-emerald-400">{d}</span>
                ))}
              </div>
            </div>
            <div>
              <SectionLabel>Don&apos;t</SectionLabel>
              <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                {summary.donts.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Pick one or more platforms to see each audience and its video rules.</p>
      )}
    </div>
  );
}
