"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HOOKS, selectCreative } from "@/services/creative/library";
import type { CampaignPlan } from "@/services/creative/campaign-plan.types";
import type { CampaignGoal, CreativeChoice, EndCardId, PlatformId } from "@/services/creative/types";
import { CampaignPlanView } from "./campaign-plan-view";
import { EndCardGallery } from "./end-card-gallery";
import { GoalPromoForm } from "./goal-promo-form";
import { HookLibrary } from "./hook-library";
import { PlatformPicker } from "./platform-picker";
import { ProductBriefCard } from "./product-brief-card";
import {
  EMPTY_PROMO,
  PLATFORM_LABELS,
  briefView,
  buildPlanRequest,
  mergePicks,
  planErrorMessage,
  promoPayload,
  togglePin,
  type PromoForm,
  type StoredBrief,
} from "./view-model";

const DEFAULT_PLATFORMS: PlatformId[] = ["tiktok", "instagram_reels", "youtube_shorts"];
const KNOWN_HOOKS = new Set(HOOKS.map((h) => h.id));

async function fetchJson(url: string, init?: RequestInit): Promise<{ status: number; ok: boolean; body: Record<string, unknown> | null }> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: res.status, ok: res.ok, body };
}

function Step({ n, title, description, children }: { n: number; title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-[11px] text-background">{n}</span>
          {title}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/**
 * Planning tab: product brief → platforms (+ profile rules) → goal/promo → hook library and end-card
 * gallery (auto picks per platform, user overrides) → campaign plan with per-platform scripts.
 * `fixture` (dev only) renders the NXTPAPER fixtures without touching any API.
 */
export function PlanningWorkspace({ projectId, fixture = false }: { projectId: string; fixture?: boolean }) {
  const base = `/api/projects/${projectId}`;

  const [brief, setBrief] = useState<StoredBrief | null>(null);
  const [briefAt, setBriefAt] = useState<string | null>(null);
  const [hasProductPage, setHasProductPage] = useState(false);
  const [briefLoading, setBriefLoading] = useState(true);
  const [briefBusy, setBriefBusy] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);

  const [platforms, setPlatforms] = useState<PlatformId[]>(DEFAULT_PLATFORMS);
  const [focused, setFocused] = useState<PlatformId | null>(DEFAULT_PLATFORMS[0]);
  const [goal, setGoal] = useState<CampaignGoal>("cold");
  const [promo, setPromo] = useState<PromoForm>(EMPTY_PROMO);

  const [choices, setChoices] = useState<Partial<Record<PlatformId, CreativeChoice>>>({});
  const [selectError, setSelectError] = useState<string | null>(null);
  const [pins, setPins] = useState<Partial<Record<PlatformId, string[]>>>({});
  const [endCards, setEndCards] = useState<Partial<Record<PlatformId, EndCardId>>>({});

  const [plan, setPlan] = useState<CampaignPlan | null>(null);
  const [planAt, setPlanAt] = useState<string | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  // Initial load: stored brief + stored plan (a missing planner route just means no plan yet).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (fixture) {
        const [{ default: nxt }, { CAMPAIGN_PLAN_FIXTURE }] = await Promise.all([import("./fixtures/nxt-brief.json"), import("./fixtures/campaign-plan.fixture")]);
        if (cancelled) return;
        setBrief(nxt as StoredBrief);
        setHasProductPage(true);
        setPlan(CAMPAIGN_PLAN_FIXTURE);
        setPlatforms(CAMPAIGN_PLAN_FIXTURE.platforms.map((p) => p.platform));
        setBriefLoading(false);
        return;
      }
      try {
        const [b, p] = await Promise.all([fetchJson(`${base}/product-brief`), fetchJson(`${base}/campaign-plan`).catch(() => null)]);
        if (cancelled) return;
        if (b.ok && b.body) {
          setBrief((b.body.brief as StoredBrief) ?? null);
          setBriefAt((b.body.at as string) ?? null);
          setHasProductPage(!!b.body.hasProductPage);
        } else setBriefError((b.body?.error as string) ?? `Could not load the brief (HTTP ${b.status})`);
        const stored = p?.ok ? (p.body?.plan as CampaignPlan | null) : null;
        if (stored?.platforms?.length) {
          setPlan(stored);
          setPlanAt((p?.body?.at as string) ?? null);
          setPlatforms(stored.platforms.map((x) => x.platform));
          setFocused(stored.platforms[0].platform);
          setGoal(stored.goal);
        }
      } catch (err) {
        if (!cancelled) setBriefError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setBriefLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base, fixture]);

  // Auto picks per platform (free, deterministic) whenever platforms / goal / promo change.
  const promoKey = JSON.stringify(promoPayload(promo) ?? null);
  useEffect(() => {
    if (briefLoading || !platforms.length) return;
    if (!brief && !fixture) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const promoBody = JSON.parse(promoKey) ?? undefined;
      if (fixture) {
        setChoices(Object.fromEntries(platforms.map((p) => [p, selectCreative({ category: "electronics", platform: p, goal, promo: promoBody, runDate: new Date().toISOString() })])));
        return;
      }
      try {
        const r = await fetchJson(`${base}/creative-select`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ platforms, goal, promo: promoBody }),
        });
        if (cancelled) return;
        if (r.ok && r.body?.choices) {
          setChoices(r.body.choices as Partial<Record<PlatformId, CreativeChoice>>);
          setSelectError(null);
        } else setSelectError((r.body?.error as string) ?? `Hook selection failed (HTTP ${r.status})`);
      } catch (err) {
        if (!cancelled) setSelectError(err instanceof Error ? err.message : String(err));
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [base, brief, briefLoading, fixture, goal, platforms, promoKey]);

  const view = useMemo(() => briefView(brief), [brief]);
  const focusedChoice = focused ? choices[focused] : undefined;
  const focusedPins = useMemo(() => (focused ? pins[focused] ?? [] : []), [focused, pins]);
  const picks = useMemo(() => mergePicks(focusedChoice?.hooks, focusedPins, 3, KNOWN_HOOKS), [focusedChoice, focusedPins]);

  const togglePlatform = useCallback(
    (id: PlatformId) => {
      const next = platforms.includes(id) ? platforms.filter((p) => p !== id) : [...platforms, id];
      setPlatforms(next);
      if (focused === id && !next.includes(id)) setFocused(next[0] ?? null);
    },
    [focused, platforms]
  );

  const regenerateBrief = useCallback(async () => {
    if (fixture) return;
    setBriefBusy(true);
    setBriefError(null);
    try {
      const r = await fetchJson(`${base}/product-brief`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ platforms }),
      });
      if (r.ok && r.body?.brief) {
        setBrief(r.body.brief as StoredBrief);
        setBriefAt((r.body.at as string) ?? new Date().toISOString());
      } else setBriefError((r.body?.error as string) ?? `Brief generation failed (HTTP ${r.status})`);
    } catch (err) {
      setBriefError(err instanceof Error ? err.message : String(err));
    } finally {
      setBriefBusy(false);
    }
  }, [base, fixture, platforms]);

  const generatePlan = useCallback(async () => {
    setPlanBusy(true);
    setPlanError(null);
    try {
      const req = buildPlanRequest({ platforms, goal, promo, pins, endCards });
      if (fixture) {
        const { CAMPAIGN_PLAN_FIXTURE } = await import("./fixtures/campaign-plan.fixture");
        setPlan(CAMPAIGN_PLAN_FIXTURE);
        return;
      }
      const r = await fetchJson(`${base}/campaign-plan`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req) });
      if (r.ok && r.body?.plan) {
        setPlan(r.body.plan as CampaignPlan);
        setPlanAt(new Date().toISOString());
      } else setPlanError(planErrorMessage(r.status, r.body as { error?: string } | null));
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : String(err));
    } finally {
      setPlanBusy(false);
    }
  }, [base, endCards, fixture, goal, pins, platforms, promo]);

  if (briefLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const focusedLabel = focused ? PLATFORM_LABELS[focused] : null;
  const overrideCount = platforms.filter((p) => pins[p]?.length || endCards[p]).length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold tracking-tight">Campaign planning</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Product brief → platforms → goal → opening hooks → end card → a per-platform plan with scripts
          {fixture && <span className="ml-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-700">fixture preview — no API calls</span>}
        </p>
      </div>

      <ProductBriefCard view={view} at={briefAt} busy={briefBusy} error={briefError} canRegenerate={hasProductPage && !fixture} onRegenerate={regenerateBrief} />

      <Step n={2} title="Platforms" description="Each platform has its own audience, length, pacing and safe zone — pick where this campaign runs.">
        <PlatformPicker selected={platforms} focused={focused} onToggle={togglePlatform} onFocus={setFocused} />
      </Step>

      <Step n={3} title="Goal & promo">
        <GoalPromoForm goal={goal} promo={promo} onGoal={setGoal} onPromo={setPromo} />
      </Step>

      {selectError && (
        <p className="flex items-start gap-1.5 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {selectError}
        </p>
      )}

      <Step n={4} title="Opening hooks" description="35 researched openers. The selector picks one reveal, one claim and one native/demo per platform; pin to override.">
        <HookLibrary
          platformLabel={focusedLabel}
          picks={picks}
          pins={focusedPins}
          onTogglePin={(id) => focused && setPins((prev) => ({ ...prev, [focused]: togglePin(prev[focused] ?? [], id) }))}
        />
        {focusedChoice && focusedChoice.notes.filter((n) => /^H\d\d/.test(n)).length > 0 && (
          <details className="mt-3 text-[11px] text-muted-foreground">
            <summary className="cursor-pointer">Why some hooks were dropped for {focusedLabel}</summary>
            <ul className="mt-1 list-disc pl-5">
              {focusedChoice.notes.filter((n) => /^H\d\d/.test(n)).map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </details>
        )}
      </Step>

      <Step n={5} title="End card (logo + CTA)">
        <EndCardGallery
          platformLabel={focusedLabel}
          choice={focusedChoice}
          chosen={focused ? endCards[focused] : undefined}
          onChoose={(id) =>
            focused &&
            setEndCards((prev) => {
              const next = { ...prev };
              if (id) next[focused] = id;
              else delete next[focused];
              return next;
            })
          }
        />
      </Step>

      <Step n={6} title="Campaign plan" description="Per-platform hook variants, beat timeline, end card and a script per hook.">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Button onClick={generatePlan} disabled={planBusy || !platforms.length || (!brief && !fixture)}>
            {planBusy ? <Loader2 className="animate-spin" /> : <Rocket />}
            {plan ? "Regenerate campaign plan" : "Generate campaign plan"}
          </Button>
          <span className="text-xs text-muted-foreground">
            {platforms.length} platform{platforms.length === 1 ? "" : "s"} · {overrideCount ? `${overrideCount} with your overrides` : "auto picks"}
            {!brief && !fixture ? " · generate the brief first" : ""}
          </span>
        </div>
        {planError && (
          <p className="mb-3 flex items-start gap-1.5 rounded-md bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {planError}
          </p>
        )}
        {plan ? <CampaignPlanView plan={plan} at={planAt} /> : <p className="text-xs text-muted-foreground">No plan yet.</p>}
      </Step>
    </div>
  );
}
