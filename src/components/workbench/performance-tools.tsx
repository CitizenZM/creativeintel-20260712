"use client";

import { useEffect, useMemo, useState } from "react";
import { FlaskConical, Loader2, MessageSquareText } from "lucide-react";
import type { TestPlan } from "@/services/creative/test-plan";
import type { AskResult } from "@/services/performance/agent";
import { cn } from "@/lib/utils";
import { btnPrimary, ErrorNote, inputCls, Label, Panel, Pill } from "./bits";
import { fmtUsd, phaseBars, postJson } from "./view-model";

const pct = (v: number | null, d = 2) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);
const money = (v: number | null) => (v == null ? "—" : fmtUsd(v));

/** "Ask the data": the Performance Agent's answer plus the aggregated table it used. */
export function AskTheData({ projectId }: { projectId: string }) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<(AskResult & { question: string }) | null>(null);

  async function ask() {
    const q = question.trim();
    if (q.length < 3) return;
    setBusy(true);
    setError(null);
    try {
      setResult({ ...(await postJson<AskResult>(`/api/projects/${projectId}/performance/ask`, { question: q })), question: q });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not ask");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel icon={<MessageSquareText className="h-4 w-4" />} title="Ask the data" testId="ask-the-data" description="Questions about imported ad results — answered from the aggregated table only (one text-model call).">
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
      >
        <input aria-label="Question" className={cn(inputCls, "min-w-[16rem] flex-1")} maxLength={500} placeholder="Which hook has the best hold rate on TikTok?" value={question} onChange={(e) => setQuestion(e.target.value)} />
        <button type="submit" className={btnPrimary} disabled={busy || question.trim().length < 3}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Ask
        </button>
      </form>
      <ErrorNote>{error}</ErrorNote>
      {result && (
        <div className="space-y-2">
          <div className="rounded-md bg-muted/60 p-3 text-xs">
            <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">{result.question}</p>
            <p className="whitespace-pre-wrap leading-relaxed">{result.answer}</p>
            {result.uncited.length > 0 && <p className="mt-1 text-[11px] text-[var(--status-attention-fg)]">Not found in the table: {result.uncited.join(", ")} — check these figures.</p>}
            {result.source === "error" && result.error && <p className="mt-1 text-[11px] text-muted-foreground">{result.error}</p>}
          </div>
          {result.table.length > 0 && (
            <details open={result.table.length <= 12}>
              <summary className="cursor-pointer text-[11px] text-muted-foreground">
                Table used ({result.table.length} rows{result.truncated ? ", truncated" : ""})
              </summary>
              <div className="mt-1 max-h-72 overflow-auto">
                <table className="w-full text-left text-[11px]">
                  <thead className="sticky top-0 bg-card text-muted-foreground">
                    <tr>
                      {["Dimension", "Level", "Ads", "Impr.", "Spend", "Hook rate", "Hold", "CTR", "CPA", "ROAS", "P(best)"].map((h) => (
                        <th key={h} className="px-1.5 py-1 font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.table.map((r) => (
                      <tr key={`${r.dim}:${r.level}`} className="border-t border-border/60">
                        <td className="px-1.5 py-1">{r.dim}</td>
                        <td className="px-1.5 py-1 font-medium">{r.level}</td>
                        <td className="px-1.5 py-1 num">{r.ads}</td>
                        <td className="px-1.5 py-1 num">{Math.round(r.impressions).toLocaleString("en-US")}</td>
                        <td className="px-1.5 py-1 num">{fmtUsd(r.spend)}</td>
                        <td className="px-1.5 py-1 num">{pct(r.hookRate, 1)}</td>
                        <td className="px-1.5 py-1 num">{pct(r.holdRate, 1)}</td>
                        <td className="px-1.5 py-1 num">{pct(r.ctr)}</td>
                        <td className="px-1.5 py-1 num">{money(r.cpa)}</td>
                        <td className="px-1.5 py-1 num">{r.roas == null ? "—" : r.roas.toFixed(2)}</td>
                        <td className="px-1.5 py-1 num">{r.pBestCtr != null ? pct(r.pBestCtr, 0) : r.pBestHookRate != null ? pct(r.pBestHookRate, 0) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </div>
      )}
    </Panel>
  );
}

const GOAL_OPTIONS = [
  { id: "", label: "From the campaign plan" },
  { id: "cold", label: "Cold purchase" },
  { id: "retarget", label: "Retarget" },
  { id: "promo", label: "Promo / sale" },
  { id: "awareness", label: "Awareness" },
  { id: "lead", label: "Leads" },
  { id: "app_install", label: "App installs" },
];

/** Test-plan generator: budget, days, goal → phases timeline, kill / scale rules and the round-1 variants per platform. */
export function TestPlanPanel({ projectId }: { projectId: string }) {
  const [budget, setBudget] = useState("1000");
  const [days, setDays] = useState("14");
  const [goal, setGoal] = useState("");
  const [narrative, setNarrative] = useState(false);
  const [plan, setPlan] = useState<TestPlan | null>(null);
  const [hasCampaignPlan, setHasCampaignPlan] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/projects/${projectId}/test-plan`, { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<{ testPlan: TestPlan | null; hasCampaignPlan: boolean }>) : null))
      .then((d) => {
        if (!alive || !d) return;
        setPlan(d.testPlan);
        setHasCampaignPlan(d.hasCampaignPlan);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [projectId]);

  async function generate() {
    const totalBudget = Number(budget);
    const d = Math.round(Number(days));
    if (!(totalBudget > 0)) return setError("Enter a total budget above $0.");
    if (!(d >= 1 && d <= 120)) return setError("Days must be 1–120.");
    setBusy(true);
    setError(null);
    try {
      const data = await postJson<{ testPlan: TestPlan }>(`/api/projects/${projectId}/test-plan`, { totalBudget, days: d, ...(goal ? { goal } : {}), narrative });
      setPlan(data.testPlan);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not build the test plan");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel icon={<FlaskConical className="h-4 w-4" />} title="Test plan" testId="test-plan" description="How to spend the test budget: structure, a power-sized round 1, phases and the kill / scale rules. Built from the campaign plan.">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <Label>Total budget (USD)</Label>
          <input aria-label="Total budget" inputMode="decimal" className={cn(inputCls, "w-28")} value={budget} onChange={(e) => setBudget(e.target.value)} />
        </label>
        <label className="block">
          <Label>Days</Label>
          <input aria-label="Days" type="number" min={1} max={120} className={cn(inputCls, "w-20")} value={days} onChange={(e) => setDays(e.target.value)} />
        </label>
        <label className="block">
          <Label>Goal</Label>
          <select aria-label="Goal" className={inputCls} value={goal} onChange={(e) => setGoal(e.target.value)}>
            {GOAL_OPTIONS.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 pb-1.5 text-[11px] text-muted-foreground" title="One short text-model call for the plain-language summary">
          <input type="checkbox" checked={narrative} onChange={(e) => setNarrative(e.target.checked)} /> AI summary
        </label>
        <button type="button" className={btnPrimary} onClick={generate} disabled={busy || hasCampaignPlan === false}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {plan ? "Rebuild plan" : "Build test plan"}
        </button>
      </div>
      {hasCampaignPlan === false && <p className="text-xs text-muted-foreground">Needs a campaign plan first — build one on the Planning tab.</p>}
      <ErrorNote>{error}</ErrorNote>
      {plan && <TestPlanView plan={plan} />}
    </Panel>
  );
}

function TestPlanView({ plan }: { plan: TestPlan }) {
  const platforms = plan.platforms;
  return (
    <div className="space-y-4 border-t border-border pt-3">
      <p className="text-xs text-muted-foreground">
        {fmtUsd(plan.totalBudget)} over {plan.days} days · goal {plan.goal} · built {new Date(plan.createdAt).toLocaleString()}
      </p>
      {plan.narrative && <p className="whitespace-pre-wrap text-xs leading-relaxed">{plan.narrative}</p>}
      {platforms.map((p) => (
        <PlatformPlanView key={p.platform} p={p} days={plan.days} />
      ))}
      {plan.assumptions.length > 0 && (
        <details>
          <summary className="cursor-pointer text-[11px] text-muted-foreground">Assumptions</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground">
            {plan.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

const PHASE_COLOR: Record<string, string> = { test: "bg-[var(--status-ai-bg)]", iterate: "bg-[var(--status-attention-bg)]", scale: "bg-[var(--status-healthy-bg)]" };

function PlatformPlanView({ p, days }: { p: TestPlan["platforms"][number]; days: number }) {
  const bars = useMemo(() => phaseBars(p.phases, days), [p.phases, days]);
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">{p.platform}</p>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span>{fmtUsd(p.budget)}</span>
          <span>· target CPA {fmtUsd(p.targetCpa)} (expected {fmtUsd(p.expectedCpa)})</span>
          {p.power.underpowered && <Pill tone="warn">underpowered</Pill>}
          {p.baseline.source === "assumption" && <Pill>assumed baselines</Pill>}
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {p.structure.test} → {p.structure.scale} · {p.structure.adSets} ad set{p.structure.adSets === 1 ? "" : "s"} × {p.structure.adsPerAdSet} ads · decide on {p.power.decisionMetric === "ctr" ? "CTR" : "hook rate"}
      </p>
      <div className="relative h-14 rounded bg-muted/40" role="img" aria-label="Phases timeline">
        {bars.map((b) => (
          <div key={b.name} className={cn("absolute inset-y-0 overflow-hidden rounded border border-background px-1.5 py-1 text-[10px]", PHASE_COLOR[b.name] ?? "bg-muted")} style={{ left: `${b.left}%`, width: `${b.width}%` }} title={b.goal}>
            <p className="truncate font-semibold">{b.label}</p>
            <p className="truncate">{b.days}</p>
            <p className="truncate num">
              {b.budget} · {b.daily}
            </p>
          </div>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <RuleList title="Kill rules" items={p.killRules} />
        <RuleList title="Scale rules" items={p.scaleRules} />
        <div>
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Round 1 ({p.round1.length})</p>
          <ul className="space-y-0.5 text-[11px]">
            {p.round1.map((v) => (
              <li key={`${v.hookId}-${v.endCardId}`}>
                <span className="font-mono">
                  {v.hookId}+{v.endCardId}
                </span>{" "}
                <span className="text-muted-foreground">{v.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {p.cadence.length > 0 && <p className="text-[11px] text-muted-foreground">Cadence: {p.cadence.join(" · ")}</p>}
    </div>
  );
}

function RuleList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{title}</p>
      <ul className="list-disc space-y-0.5 pl-4 text-[11px]">
        {items.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </div>
  );
}
