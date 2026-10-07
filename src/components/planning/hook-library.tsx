"use client";

import { useMemo, useState } from "react";
import { Pin, PinOff, Search, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HOOKS } from "@/services/creative/library";
import type { HookFamily } from "@/services/creative/types";
import { FAMILY_LABEL, HOOK_FAMILIES, filterHooks, type EffectivePick } from "./view-model";

const FAMILY_TONE: Record<HookFamily, string> = {
  reveal: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  claim: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  native: "bg-pink-500/10 text-pink-700 dark:text-pink-300",
  demo: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
};

/**
 * The 35-hook opening library. The effective picks for the focused platform (auto + pinned) are
 * highlighted with the selector's "why"; pinning overrides the auto picks for that platform.
 */
export function HookLibrary({
  platformLabel,
  picks,
  pins,
  onTogglePin,
}: {
  platformLabel: string | null;
  picks: EffectivePick[];
  pins: string[];
  onTogglePin: (hookId: string) => void;
}) {
  const [family, setFamily] = useState<HookFamily | "all">("all");
  const [query, setQuery] = useState("");
  const [onlyPicked, setOnlyPicked] = useState(false);
  const pickById = useMemo(() => new Map(picks.map((p, i) => [p.hookId, { ...p, slot: i + 1 }])), [picks]);

  const list = useMemo(() => {
    const filtered = filterHooks(HOOKS, family, query).filter((h) => !onlyPicked || pickById.has(h.id));
    // Picked hooks first, in slot order; then library order.
    return filtered.sort((a, b) => (pickById.get(a.id)?.slot ?? 99) - (pickById.get(b.id)?.slot ?? 99) || a.id.localeCompare(b.id));
  }, [family, query, onlyPicked, pickById]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {(["all", ...HOOK_FAMILIES] as const).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={family === f}
              onClick={() => setFamily(f)}
              className={cn(
                "h-7 rounded-full border px-2.5 text-xs",
                family === f ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {f === "all" ? `All (${HOOKS.length})` : `${FAMILY_LABEL[f]} (${HOOKS.filter((h) => h.family === f).length})`}
            </button>
          ))}
        </div>
        <div className="relative ml-auto w-full sm:w-56">
          <Search className="pointer-events-none absolute top-2 left-2 h-4 w-4 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search hooks…" className="pl-7" />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={onlyPicked} onChange={(e) => setOnlyPicked(e.target.checked)} /> picks only
        </label>
      </div>
      {platformLabel ? (
        <p className="text-xs text-muted-foreground">
          Highlighted: the 3 hooks for <span className="font-medium text-foreground">{platformLabel}</span>. Pin a hook to force it into that platform&apos;s plan (max 3).
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">Pick a platform to see its auto-picked hooks.</p>
      )}

      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {list.map((h) => {
          const pick = pickById.get(h.id);
          const pinned = pins.includes(h.id);
          return (
            <article
              key={h.id}
              data-hook-id={h.id}
              className={cn("flex flex-col gap-2 rounded-lg border p-3 text-xs", pick && "border-[var(--status-ai-fg)]/50 bg-[var(--status-ai-bg)]/40 ring-1 ring-[var(--status-ai-fg)]/30")}
            >
              <header className="flex items-start gap-2">
                <span className="font-mono text-[11px] text-muted-foreground">{h.id}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium leading-snug">{h.name}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <span className={cn("rounded px-1.5 py-0.5 text-[10px]", FAMILY_TONE[h.family])}>{FAMILY_LABEL[h.family]}</span>
                    <Badge variant="outline">{h.durationSec[0]}–{h.durationSec[1]}s</Badge>
                    <Badge variant="outline">AI fit {h.aiFit}</Badge>
                  </div>
                </div>
                {platformLabel && (
                  <Button size="icon-xs" variant={pinned ? "default" : "ghost"} onClick={() => onTogglePin(h.id)} aria-label={pinned ? `Unpin ${h.id}` : `Pin ${h.id}`} title={pinned ? "Unpin" : `Pin for ${platformLabel}`}>
                    {pinned ? <PinOff /> : <Pin />}
                  </Button>
                )}
              </header>
              {pick && (
                <div className="rounded-md bg-background/70 px-2 py-1.5">
                  <p className="flex items-center gap-1 font-medium text-[var(--status-ai-fg)]">
                    <Star className="h-3 w-3" /> Pick #{pick.slot} {pick.source === "pinned" ? "(pinned)" : "(auto)"}
                    {pick.score !== undefined && <span className="font-normal opacity-70">· score {pick.score}</span>}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{pick.why.join(" · ")}</p>
                </div>
              )}
              <p className="text-muted-foreground">{h.desc}</p>
              <dl className="grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1">
                <dt className="text-muted-foreground">Keyframe</dt>
                <dd>{h.keyframe}</dd>
                <dt className="text-muted-foreground">Motion</dt>
                <dd>{h.motion}</dd>
                <dt className="text-muted-foreground">Text</dt>
                <dd>{h.text.replace(/`/g, "")}</dd>
                <dt className="text-muted-foreground">SFX</dt>
                <dd>{h.sfx.replace(/`/g, "") || "—"}</dd>
              </dl>
            </article>
          );
        })}
        {list.length === 0 && <p className="text-xs text-muted-foreground">No hooks match.</p>}
      </div>
    </div>
  );
}
