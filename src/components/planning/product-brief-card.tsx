"use client";

import { AlertTriangle, Clapperboard, Loader2, RefreshCw, ShieldQuestion, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MiniScoreBar, SectionLabel } from "./score-bar";
import { PLACEMENT_LABEL, type BriefView } from "./view-model";

export function ProductBriefCard({
  view,
  at,
  busy,
  error,
  canRegenerate,
  onRegenerate,
}: {
  view: BriefView | null;
  at: string | null;
  busy: boolean;
  error?: string | null;
  canRegenerate: boolean;
  onRegenerate: () => void;
}) {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[var(--status-ai-fg)]" />
          Product brief {view ? <span className="font-normal text-muted-foreground">— {view.productName}</span> : null}
        </CardTitle>
        <CardDescription>
          Ranked, filmable selling points, keywords and objections from the product page
          {at ? ` · updated ${new Date(at).toLocaleString()}` : ""}
        </CardDescription>
        <CardAction>
          <Button size="sm" variant="outline" onClick={onRegenerate} disabled={busy || !canRegenerate} title={canRegenerate ? "One model call" : "Set the product URL in Setup first"}>
            {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {view ? "Regenerate brief" : "Generate brief"}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-5">
        {error && (
          <p className="flex items-start gap-1.5 rounded-md bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
          </p>
        )}
        {!view ? (
          <p className="text-sm text-muted-foreground">
            No brief yet. {canRegenerate ? "Generate it to see the key selling points and keywords." : "Add the product URL in Setup, then generate the brief."}
          </p>
        ) : (
          <>
            <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
              <div>
                <SectionLabel>Big idea</SectionLabel>
                <p className="text-lg font-semibold leading-snug tracking-tight">{view.bigIdea || "—"}</p>
                {view.alternates.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                    {view.alternates.map((a, i) => (
                      <li key={i} className="flex gap-1.5">
                        <span className="font-medium text-foreground/70">Alt {i + 1}</span> {a}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <SectionLabel>Audience</SectionLabel>
                <p className="text-sm">{view.audiencePrimary || "—"}</p>
                {view.audienceSecondary.length > 0 && <p className="mt-1 text-xs text-muted-foreground">Also: {view.audienceSecondary.join(" · ")}</p>}
                <div className="mt-1.5 flex flex-wrap gap-1">
                  <Badge variant="secondary">{view.category}</Badge>
                  {view.awareness && <Badge variant="outline">{view.awareness}</Badge>}
                </div>
              </div>
            </div>

            <div>
              <SectionLabel>Selling points (ranked)</SectionLabel>
              <ol className="divide-y divide-border rounded-lg border">
                {view.points.map((p) => (
                  <li key={p.id} className="grid gap-2 px-3 py-2.5 sm:grid-cols-[2rem_1fr_1fr_1fr_auto] sm:items-start">
                    <span className="text-sm font-semibold tabular-nums text-muted-foreground">#{p.rank}</span>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground sm:hidden">Claim</p>
                      <p className="text-sm font-medium">{p.claim}</p>
                      {p.evidence && <p className="mt-0.5 text-[10px] text-muted-foreground">{p.evidence.replace(/_/g, " ")}</p>}
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground sm:hidden">Benefit</p>
                      <p className="text-xs text-muted-foreground">→ {p.benefit || "—"}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground sm:hidden">Proof shot</p>
                      <Badge variant="outline" className="font-mono">{p.proofShot.replace(/_/g, " ") || "—"}</Badge>
                      {p.overlayText && <p className="mt-1 text-xs italic text-muted-foreground">&ldquo;{p.overlayText}&rdquo;</p>}
                    </div>
                    <MiniScoreBar value={p.scorePct} />
                  </li>
                ))}
              </ol>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <SectionLabel>Keywords by placement</SectionLabel>
                <div className="space-y-2">
                  {view.keywordGroups.map((g) => (
                    <div key={g.placement} className="flex flex-wrap items-center gap-1">
                      <span className="mr-1 w-24 shrink-0 text-xs text-muted-foreground">{PLACEMENT_LABEL[g.placement] ?? g.placement}</span>
                      {g.terms.map((t) => (
                        <Badge key={t} variant="secondary">{t}</Badge>
                      ))}
                    </div>
                  ))}
                  {view.keywordGroups.length === 0 && <p className="text-xs text-muted-foreground">No keywords in the brief.</p>}
                </div>
              </div>
              <div>
                <SectionLabel>Objections → busting visual</SectionLabel>
                <ul className="space-y-2">
                  {view.objections.map((o, i) => (
                    <li key={i} className="rounded-md border px-2.5 py-2">
                      <p className="flex items-start gap-1.5 text-xs font-medium">
                        <ShieldQuestion className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" /> {o.objection}
                      </p>
                      {o.bustingVisual && <p className="mt-1 flex items-start gap-1.5 pl-5 text-xs text-muted-foreground"><Clapperboard className="mt-0.5 h-3 w-3 shrink-0" /> {o.bustingVisual}</p>}
                    </li>
                  ))}
                  {view.objections.length === 0 && <p className="text-xs text-muted-foreground">No objections listed.</p>}
                </ul>
              </div>
            </div>

            {view.gaps.length > 0 && (
              <div>
                <SectionLabel>Gaps (missing data)</SectionLabel>
                <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                  {view.gaps.map((g, i) => (
                    <li key={i}>{g}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
