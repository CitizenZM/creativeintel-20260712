"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { endCardById } from "@/services/creative/library";
import type { CampaignPlan, EndCardPlan, PlatformPlan } from "@/services/creative/campaign-plan.types";
import { BeatTimeline } from "./beat-timeline";
import { EndCardMock } from "./end-card-mock";
import { SectionLabel } from "./score-bar";
import { FAMILY_LABEL, GOALS, PLATFORM_LABELS, fmtSec } from "./view-model";

function EndCardSummary({ card, primary }: { card: EndCardPlan; primary?: boolean }) {
  const def = endCardById(card.id);
  return (
    <div className="flex gap-3 rounded-md border p-2">
      {def && <EndCardMock layout={def.layout} title={card.name} className="w-16 shrink-0" />}
      <div className="min-w-0 text-xs">
        <p className="font-medium">
          <span className="font-mono text-muted-foreground">{card.id}</span> {card.name} {primary && <Badge className="ml-1">chosen</Badge>}
        </p>
        {card.headline && <p className="mt-0.5">{card.headline}</p>}
        <p className="mt-1">
          <span className="rounded-full bg-fuchsia-600/10 px-2 py-0.5 text-[10px] text-fuchsia-700 dark:text-fuchsia-300">{card.button}</span>
        </p>
        {card.data && Object.keys(card.data).length > 0 && (
          <p className="mt-1 text-[10px] text-muted-foreground">{Object.entries(card.data).map(([k, v]) => `${k}: ${v}`).join(" · ")}</p>
        )}
      </div>
    </div>
  );
}

function PlatformPlanPanel({ p }: { p: PlatformPlan }) {
  const [script, setScript] = useState(p.scripts[0]?.hookId ?? "");
  const active = p.scripts.find((s) => s.hookId === script) ?? p.scripts[0];
  const facts = [
    ["Length", fmtSec(p.durationSec)],
    ["Aspect", p.aspect],
    ["Audience", p.audience],
    ["Style", p.styleNotes],
    ["Pacing", p.pacing],
    ["Voice", p.voice],
    ["Captions", p.captionStyle],
    ["Music", p.musicMood],
  ];
  return (
    <div className="space-y-5 pt-3">
      <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-4">
        {facts.map(([k, v]) => (
          <div key={k}>
            <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</dt>
            <dd>{v || "—"}</dd>
          </div>
        ))}
      </dl>

      <div>
        <SectionLabel>Opening hook variants</SectionLabel>
        <div className="grid gap-2 md:grid-cols-3">
          {p.hookVariants.map((h) => (
            <div key={h.hookId} className="rounded-md border p-2.5 text-xs">
              <p className="font-medium">
                <span className="font-mono text-muted-foreground">{h.hookId}</span> {h.name}
              </p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">{FAMILY_LABEL[h.family] ?? h.family} · {fmtSec(h.durationSec)}</p>
              <p className="mt-1.5">{h.openingVisual}</p>
              {h.openingText && <p className="mt-1 font-medium">&ldquo;{h.openingText}&rdquo;</p>}
              {h.openingVO && <p className="mt-1 italic text-muted-foreground">VO: {h.openingVO}</p>}
            </div>
          ))}
        </div>
      </div>

      <div>
        <SectionLabel>Body beats (shared by all hook variants)</SectionLabel>
        <BeatTimeline beats={p.beats} durationSec={p.durationSec} />
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
        <div>
          <SectionLabel>End card</SectionLabel>
          <EndCardSummary card={p.endCard} primary />
        </div>
        {p.endCardAlternates.length > 0 && (
          <div>
            <SectionLabel>Alternates</SectionLabel>
            <div className="space-y-2">
              {p.endCardAlternates.map((c) => (
                <EndCardSummary key={c.id} card={c} />
              ))}
            </div>
          </div>
        )}
      </div>

      {p.scripts.length > 0 && active && (
        <div>
          <SectionLabel>Scripts per hook variant</SectionLabel>
          <div className="mb-2 flex flex-wrap gap-1">
            {p.scripts.map((s) => (
              <button
                key={s.hookId}
                type="button"
                onClick={() => setScript(s.hookId)}
                className={
                  s.hookId === active.hookId
                    ? "rounded-full border border-foreground bg-foreground px-2.5 py-1 text-xs text-background"
                    : "rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
                }
              >
                {s.hookId} · {s.title}
              </button>
            ))}
          </div>
          <BeatTimeline beats={active.beats} durationSec={p.durationSec} />
        </div>
      )}
    </div>
  );
}

export function CampaignPlanView({ plan, at }: { plan: CampaignPlan; at?: string | null }) {
  const first = plan.platforms[0]?.platform;
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">
          {plan.productTitle} · {GOALS.find((g) => g.id === plan.goal)?.label ?? plan.goal}
          {at || plan.createdAt ? ` · ${new Date(at ?? plan.createdAt).toLocaleString()}` : ""}
        </p>
        {plan.bigIdea && <p className="text-base font-semibold tracking-tight">{plan.bigIdea}</p>}
        {plan.keywords.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {plan.keywords.map((k) => (
              <Badge key={k} variant="secondary">{k}</Badge>
            ))}
          </div>
        )}
        {plan.notes.length > 0 && (
          <ul className="list-disc pl-5 text-[11px] text-muted-foreground">
            {plan.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}
      </div>
      {first ? (
        <Tabs defaultValue={first}>
          <TabsList className="h-auto flex-wrap">
            {plan.platforms.map((p) => (
              <TabsTrigger key={p.platform} value={p.platform}>
                {p.label || PLATFORM_LABELS[p.platform] || p.platform}
              </TabsTrigger>
            ))}
          </TabsList>
          {plan.platforms.map((p) => (
            <TabsContent key={p.platform} value={p.platform}>
              <PlatformPlanPanel p={p} />
            </TabsContent>
          ))}
        </Tabs>
      ) : (
        <p className="text-xs text-muted-foreground">The plan has no platforms.</p>
      )}
    </div>
  );
}
