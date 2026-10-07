"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { END_CARDS } from "@/services/creative/library";
import type { CreativeChoice, EndCardId } from "@/services/creative/types";
import { EndCardMock } from "./end-card-mock";

/** E01–E12 with a 9:16 layout mock each; the selector's pick + alternates are highlighted, the user can choose. */
export function EndCardGallery({
  platformLabel,
  choice,
  chosen,
  onChoose,
}: {
  platformLabel: string | null;
  choice: CreativeChoice | undefined;
  chosen: EndCardId | undefined;
  onChoose: (id: EndCardId | undefined) => void;
}) {
  const autoId = choice?.endCard.id;
  const alternates = new Set(choice?.alternates.map((a) => a.id) ?? []);
  const skipped = new Map<string, string>();
  for (const n of choice?.notes ?? []) {
    const m = n.match(/^(E\d\d) .* skipped: (.*)$/);
    if (m) skipped.set(m[1], m[2]);
  }
  const effective = chosen ?? autoId;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {platformLabel ? (
          <>
            For <span className="font-medium text-foreground">{platformLabel}</span>: auto pick {autoId ?? "—"}
            {chosen && chosen !== autoId ? `, you chose ${chosen}` : ""}. Shaded band = strict safe box (y 288–1220) — logo, price and CTA stay inside it.
          </>
        ) : (
          "Pick a platform to see which end card fits it."
        )}
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {END_CARDS.map((e) => {
          const isEffective = effective === e.id;
          const isAuto = autoId === e.id;
          const isAlt = alternates.has(e.id);
          const why = skipped.get(e.id);
          return (
            <article
              key={e.id}
              data-end-card-id={e.id}
              className={cn(
                "flex flex-col gap-2 rounded-lg border p-2 text-xs",
                isEffective && "border-foreground ring-2 ring-foreground/70",
                !isEffective && (isAuto || isAlt) && "border-[var(--status-ai-fg)]/50 bg-[var(--status-ai-bg)]/30"
              )}
            >
              <EndCardMock layout={e.layout} title={e.name} className="mx-auto max-w-[140px]" />
              <div className="flex flex-wrap items-center gap-1">
                <span className="font-mono text-[11px] text-muted-foreground">{e.id}</span>
                {isAuto && <Badge>auto pick</Badge>}
                {isAlt && <Badge variant="secondary">alternate</Badge>}
                {why && <Badge variant="outline" title={why}>needs data</Badge>}
              </div>
              <p className="font-medium leading-snug">{e.name}</p>
              <p className="text-[11px] text-muted-foreground">{e.useFor}</p>
              <details className="text-[11px]">
                <summary className="cursor-pointer text-muted-foreground">Layout · animation · copy</summary>
                <p className="mt-1"><span className="text-muted-foreground">Layout:</span> {e.layout}</p>
                <p className="mt-1"><span className="text-muted-foreground">Animation:</span> {e.animation}</p>
                <p className="mt-1"><span className="text-muted-foreground">Fits:</span> {e.platformFit}</p>
                {why && <p className="mt-1 text-amber-700 dark:text-amber-400">Unavailable now: {why}</p>}
              </details>
              <div className="flex flex-wrap gap-1">
                {e.copy.map((c) => (
                  <span key={c} className="rounded-full bg-fuchsia-600/10 px-2 py-0.5 text-[10px] text-fuchsia-700 dark:text-fuchsia-300">{c}</span>
                ))}
              </div>
              {platformLabel && (
                <Button
                  size="xs"
                  variant={isEffective ? "default" : "outline"}
                  className="mt-auto"
                  onClick={() => onChoose(chosen === e.id ? undefined : e.id)}
                >
                  {isEffective ? <><Check /> {chosen === e.id ? "Chosen" : "Auto pick"}</> : "Use this card"}
                </Button>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
