/**
 * Test-plan strategist: CampaignPlan + budget + days + goal + platforms (+ baseline metrics) → a
 * testing plan per platform: account structure (Meta ABO test → CBO scale, TikTok manual → Smart+,
 * YouTube Demand Gen), phases (creative test → iterate → scale) with daily budgets, how many
 * variants the test budget can power (two-proportion power calc on hook rate and CTR), kill and
 * scale rules, iteration cadence, and which plan hook × end-card variants go in round 1.
 * Pure and deterministic; writeTestPlanNarrative adds one short (injected) model call.
 */
import { z } from "zod";
import { sampleSizeForLift } from "@/services/performance/stats";
import type { CampaignPlan } from "./campaign-plan.types";
import type { CampaignGoal, PlatformId } from "./types";

export type PlatformFamily = "meta" | "tiktok" | "youtube" | "pinterest" | "snapchat";

export interface Baseline {
  /** $ per 1,000 impressions. */
  cpm: number;
  /** Clicks ÷ impressions. */
  ctr: number;
  /** Conversions ÷ clicks. */
  cvr: number;
  /** 3-second (TikTok 2-second) views ÷ impressions. */
  hookRate: number;
}

/**
 * Planning assumptions (US e-commerce video, mid-points of commonly published 2024–25 benchmark
 * ranges). Not account data — callers should pass their own 30-day averages as `baseline`.
 */
export const DEFAULT_BASELINES: Record<PlatformFamily, Baseline> = {
  meta: { cpm: 12, ctr: 0.01, cvr: 0.025, hookRate: 0.25 },
  tiktok: { cpm: 8, ctr: 0.009, cvr: 0.015, hookRate: 0.25 },
  youtube: { cpm: 10, ctr: 0.006, cvr: 0.015, hookRate: 0.3 },
  pinterest: { cpm: 6, ctr: 0.005, cvr: 0.015, hookRate: 0.2 },
  snapchat: { cpm: 5, ctr: 0.006, cvr: 0.01, hookRate: 0.2 },
};
export const BASELINE_NOTE =
  "Default baselines are planning assumptions (mid-points of commonly published 2024–25 US e-commerce video benchmark ranges), not this account's data — pass your 30-day CPM / CTR / CVR / hook rate to size the test on real numbers.";

export function platformFamily(id: string): PlatformFamily {
  if (/tiktok/.test(id)) return "tiktok";
  if (/youtube|google/.test(id)) return "youtube";
  if (/pinterest/.test(id)) return "pinterest";
  if (/snap/.test(id)) return "snapchat";
  return "meta";
}

export interface TestPlanInput {
  plan: CampaignPlan;
  totalBudget: number;
  days: number;
  goal?: CampaignGoal | string;
  /** Subset / other platforms (default: the plan's platforms). */
  platforms?: string[];
  /** Account baselines by platform id or family (any field). */
  baseline?: Partial<Record<string, Partial<Baseline>>>;
  /** Target CPA in $ (default: the baseline-implied CPA). */
  targetCpa?: number;
  /** Relative lift the test must detect (default 0.2 = +20 %). */
  targetLift?: number;
  alpha?: number;
  power?: number;
  /** Cap on variants in round 1 (default 6). */
  maxVariants?: number;
  now?: Date;
}

export interface Phase {
  name: "test" | "iterate" | "scale";
  startDay: number;
  days: number;
  budget: number;
  dailyBudget: number;
  /** Scale phase: compounding daily budgets (+25 %/day) that sum to the phase budget. */
  schedule?: number[];
  goal: string;
}

export interface MetricPower {
  baseline: number;
  target: number;
  impressionsPerVariant: number;
  costPerVariant: number;
  affordableVariants: number;
}

export interface PlatformTestPlan {
  platform: string;
  family: PlatformFamily;
  budget: number;
  baseline: Baseline & { source: "input" | "assumption" };
  targetCpa: number;
  expectedCpa: number;
  structure: { test: string; scale: string; adSets: number; adsPerAdSet: number };
  power: { targetLift: number; alpha: number; power: number; hookRate: MetricPower; ctr: MetricPower; decisionMetric: "ctr" | "hookRate"; underpowered: boolean };
  phases: Phase[];
  killRules: string[];
  scaleRules: string[];
  cadence: string[];
  round1: { hookId: string; endCardId: string; label: string }[];
}

export interface TestPlan {
  version: 1;
  createdAt: string;
  productTitle: string;
  goal: string;
  totalBudget: number;
  days: number;
  platforms: PlatformTestPlan[];
  assumptions: string[];
  narrative?: string;
  narrativeSource?: "llm" | "scaffold";
}

const c2 = (n: number) => Math.round(n * 100) / 100;
const usd = (n: number) => `$${n.toFixed(2)}`;
const pct = (n: number) => `${(n * 100).toFixed(n < 0.01 ? 2 : 1)}%`;
const roundUp = (n: number, step: number) => Math.ceil(n / step) * step;

/** Split an amount by weights in whole cents; the last part takes the rounding remainder. */
export function splitCents(amount: number, weights: number[]): number[] {
  const cents = Math.round(amount * 100);
  const sum = weights.reduce((s, w) => s + w, 0) || 1;
  const parts = weights.map((w) => Math.floor((cents * w) / sum));
  parts[parts.length - 1] += cents - parts.reduce((s, x) => s + x, 0);
  return parts.map((p) => p / 100);
}

/** Daily budgets growing by `growth` per day that sum to `budget` (cents, remainder on the last day). */
export function scaleSchedule(budget: number, days: number, growth = 0.25): number[] {
  if (days <= 0) return [];
  const weights = Array.from({ length: days }, (_, k) => (1 + growth) ** k);
  return splitCents(budget, weights);
}

function phasesFor(budget: number, days: number, goalText: string): Phase[] {
  const d = Math.max(1, Math.round(days));
  const plan: { name: Phase["name"]; days: number; w: number }[] =
    d >= 7
      ? [
          { name: "test", days: Math.max(3, Math.round(d * 0.3)), w: 0.35 },
          { name: "iterate", days: Math.max(2, Math.round(d * 0.25)), w: 0.25 },
          { name: "scale", days: 0, w: 0.4 },
        ]
      : d >= 4
        ? [
            { name: "test", days: Math.max(2, Math.ceil(d / 2)), w: 0.55 },
            { name: "scale", days: 0, w: 0.45 },
          ]
        : [{ name: "test", days: d, w: 1 }];
  const last = plan[plan.length - 1];
  if (plan.length > 1) last.days = Math.max(1, d - plan.slice(0, -1).reduce((s, p) => s + p.days, 0));
  const budgets = splitCents(budget, plan.map((p) => p.w));
  const goals: Record<Phase["name"], string> = {
    test: "find the winning hook × end card: equal budgets, no edits, decide on the power-sized sample",
    iterate: "kill losers, re-test new variants of the winning hook family and end-card alternates against the winner",
    scale: `scale proven winners on ${goalText} with compounding budget steps`,
  };
  let start = 1;
  return plan.map((p, i) => {
    const phase: Phase = { name: p.name, startDay: start, days: p.days, budget: budgets[i], dailyBudget: c2(budgets[i] / p.days), goal: goals[p.name] };
    if (p.name === "scale") phase.schedule = scaleSchedule(budgets[i], p.days);
    start += p.days;
    return phase;
  });
}

function structureFor(family: PlatformFamily, platform: string, variants: number, goal: string): PlatformTestPlan["structure"] {
  const adSets = Math.max(1, Math.ceil(variants / 5));
  const adsPerAdSet = Math.ceil(variants / adSets);
  const awareness = goal === "awareness";
  switch (family) {
    case "meta":
      return {
        adSets,
        adsPerAdSet,
        test: `ABO creative test: 1 campaign, ${adSets} ad set${adSets > 1 ? "s" : ""} × ${adsPerAdSet} ads (3–5 ads per ad set, one hook family per ad set), equal ad-set budgets, broad audience, ${platform} placement only, ${awareness ? "ThruPlay" : "conversions"} objective`,
        scale: `CBO (Advantage+ campaign budget${awareness ? "" : " / Advantage+ shopping"}) with the winners duplicated by post ID (keeps likes and comments); the ABO campaign stays as the testing lane`,
      };
    case "tiktok":
      return {
        adSets: 1,
        adsPerAdSet: variants,
        test: `Manual campaign: 1 ad group × ${variants} ads, broad targeting, lowest-cost bidding, automated creative optimization off so every ad gets delivery`,
        scale: "Smart+ campaign fed with the winners as Spark Ads; keep the manual ad group as the testing lane",
      };
    case "youtube":
      return {
        adSets: variants,
        adsPerAdSet: 1,
        test: `${awareness ? "Video reach campaign" : "Demand Gen campaign (Video Action campaigns are being upgraded to Demand Gen)"}: one ad group per variant with equal budgets, ${awareness ? "target CPM" : "Maximize clicks until ≥ 30 conversions/week, then Maximize conversions"}`,
        scale: `${awareness ? "Video reach" : "Demand Gen"} with the winners across Shorts, in-stream and feed; add a tCPA/tROAS only after 30+ conversions`,
      };
    default:
      return {
        adSets: 1,
        adsPerAdSet: variants,
        test: `Manual campaign: 1 ad group × ${variants} ads, equal delivery, broad targeting`,
        scale: "Automated bidding campaign with the winners duplicated; keep the manual ad group for tests",
      };
  }
}

function power(baseline: number, lift: number, cpm: number, testBudget: number, alpha: number, pow: number): MetricPower {
  const n = sampleSizeForLift(baseline, lift, { alpha, power: pow });
  const cost = Number.isFinite(n) ? c2((n / 1000) * cpm) : Infinity;
  return { baseline, target: Math.min(0.999, baseline * (1 + lift)), impressionsPerVariant: n, costPerVariant: cost, affordableVariants: cost > 0 && Number.isFinite(cost) ? Math.floor(testBudget / cost) : 0 };
}

function variantPool(plan: CampaignPlan, platform: string): { hookId: string; endCardId: string; label: string }[] {
  const pp = plan.platforms.find((p) => p.platform === platform) ?? plan.platforms.find((p) => platformFamily(p.platform) === platformFamily(platform)) ?? plan.platforms[0];
  if (!pp) return [];
  const hooks = pp.hookVariants.map((h) => h.hookId);
  const ends = [pp.endCard?.id, ...(pp.endCardAlternates ?? []).map((e) => e.id)].filter((x): x is NonNullable<typeof x> => !!x);
  const out: { hookId: string; endCardId: string; label: string }[] = [];
  const add = (h: string, e: string) => !out.some((v) => v.hookId === h && v.endCardId === e) && out.push({ hookId: h, endCardId: e, label: `${h} × ${e}` });
  // Hooks first (they move the result most), then end-card alternates on the lead hook, then the rest.
  for (const h of hooks) if (ends[0]) add(h, ends[0]);
  for (const e of ends.slice(1)) if (hooks[0]) add(hooks[0], e);
  for (const e of ends.slice(1)) for (const h of hooks.slice(1)) add(h, e);
  return out;
}

const CONVERSION_GOALS = new Set(["cold", "retarget", "promo", "app_install", "lead"]);

export function buildTestPlan(input: TestPlanInput): TestPlan {
  const goal = String(input.goal ?? input.plan.goal ?? "cold");
  const goalText = goal === "awareness" ? "reach / ThruPlay" : goal === "lead" ? "leads" : goal === "app_install" ? "installs" : "purchases";
  const ids = [...new Set((input.platforms?.length ? input.platforms : input.plan.platforms.map((p) => p.platform)) as string[])];
  const lift = input.targetLift ?? 0.2;
  const alpha = input.alpha ?? 0.05;
  const pow = input.power ?? 0.8;
  const maxV = Math.max(2, input.maxVariants ?? 6);
  const budgets = splitCents(Math.max(0, input.totalBudget), ids.map(() => 1));
  const assumptions = new Set<string>([`Detect a +${Math.round(lift * 100)}% relative lift at ${Math.round(pow * 100)}% power, two-sided α ${alpha} (per-variant sample, two-proportion test); winners are called by the Performance Agent at P(best) ≥ 95%.`]);

  const platforms = ids.map((platform, i): PlatformTestPlan => {
    const family = platformFamily(platform);
    const given = { ...(input.baseline?.[family] ?? {}), ...(input.baseline?.[platform] ?? {}) };
    const fromInput = Object.values(given).some((v) => typeof v === "number");
    const assumed = (Object.keys(DEFAULT_BASELINES[family]) as (keyof Baseline)[]).filter((k) => typeof given[k] !== "number");
    if (assumed.length) {
      assumptions.add(BASELINE_NOTE);
      if (fromInput) assumptions.add(`${platform}: ${assumed.join(", ")} assumed (not supplied)`);
    }
    const baseline = { ...DEFAULT_BASELINES[family], ...given, source: fromInput ? ("input" as const) : ("assumption" as const) };
    const expectedCpa = c2(baseline.cpm / (1000 * baseline.ctr * baseline.cvr));
    const targetCpa = c2(input.targetCpa ?? expectedCpa);
    const phases = phasesFor(budgets[i], input.days, goalText);
    const testBudget = phases[0].budget;
    const hr = power(baseline.hookRate, lift, baseline.cpm, testBudget, alpha, pow);
    const ctr = power(baseline.ctr, lift, baseline.cpm, testBudget, alpha, pow);
    const decisionMetric = ctr.affordableVariants >= 2 ? "ctr" : "hookRate";
    const pool = variantPool(input.plan, platform);
    const afford = (decisionMetric === "ctr" ? ctr : hr).affordableVariants;
    const n = Math.max(2, Math.min(afford, maxV, Math.max(2, pool.length)));
    const round1 = pool.slice(0, n);
    const structure = structureFor(family, platform, round1.length || n, goal);

    const hookKillAt = roundUp(Math.max(1000, hr.impressionsPerVariant / 2), 500);
    const ctrKillAt = roundUp(Math.max(2000, ctr.impressionsPerVariant / 2), 1000);
    const killRules = [
      `Kill an ad whose hook rate < ${pct(baseline.hookRate * 0.7)} (70% of the ${pct(baseline.hookRate)} baseline) after ${hookKillAt.toLocaleString("en-US")} impressions`,
      `Kill an ad whose CTR < ${pct(baseline.ctr * 0.5)} (half the ${pct(baseline.ctr)} baseline) after ${ctrKillAt.toLocaleString("en-US")} impressions`,
      ...(CONVERSION_GOALS.has(goal)
        ? [
            `Kill an ad whose CPA > ${usd(targetCpa * 2)} (2× the ${usd(targetCpa)} target) after ${usd(targetCpa * 2)} spend`,
            `Kill an ad with zero conversions after ${usd(targetCpa * 3)} spend (3× target CPA)`,
          ]
        : [`Kill an ad whose CPM > ${usd(baseline.cpm * 1.5)} (1.5× baseline) after 2 days`, "Kill an ad whose hold rate is in the bottom third of the round after the hook-rate sample"]),
      "Never kill inside the first 24 h (learning / delivery ramp) unless it breaks a rule by 2×",
    ];
    const scaleRules = [
      `Winner = P(best) ≥ 95% on ${decisionMetric === "ctr" ? "CTR" : "hook rate"} in the Performance Agent${CONVERSION_GOALS.has(goal) ? ` with CPA ≤ ${usd(targetCpa)}` : ""}`,
      `Raise the winner's budget +20–30% per day while ${CONVERSION_GOALS.has(goal) ? `CPA ≤ ${usd(targetCpa)}` : `CPM ≤ ${usd(baseline.cpm)}`}; hold 48 h if it drifts above 1.3× target`,
      "Duplicate winners into the scale campaign (same post ID / Spark code) — never edit a live winner",
      "Retire a winner when frequency > 3 or CTR falls 20% below its peak; promote the next-best variant",
    ];
    const testDays = phases[0].days;
    const check = Math.max(2, Math.min(4, Math.round(testDays / 2)));
    const cadence = [
      `Daily: import results (Meta/TikTok export) and check kill rules; decide the round every ${check} days`,
      phases.some((p) => p.name === "iterate")
        ? `Iterate (day ${phases[1].startDay}): replace losers with new variants of the winning hook family and the next end-card alternates, keep the winner as control`
        : "Too short for an iterate round — carry learnings into the next flight",
      "Refresh creative every 7–14 days or when frequency > 3 / CTR drops 20% from its peak",
      "After every round re-run the Performance Agent: its bias feeds the next campaign plan's hook and end-card picks",
    ];
    return {
      platform,
      family,
      budget: budgets[i],
      baseline,
      targetCpa,
      expectedCpa,
      structure,
      power: { targetLift: lift, alpha, power: pow, hookRate: hr, ctr, decisionMetric, underpowered: hr.affordableVariants < 2 },
      phases,
      killRules,
      scaleRules,
      cadence,
      round1,
    };
  });

  return {
    version: 1,
    createdAt: (input.now ?? new Date()).toISOString(),
    productTitle: input.plan.productTitle,
    goal,
    totalBudget: c2(input.totalBudget),
    days: Math.max(1, Math.round(input.days)),
    platforms,
    assumptions: [...assumptions],
  };
}

/* ───────────────────────── narrative ───────────────────────── */

export type NarrativeLlm = (args: { system: string; user: string }) => Promise<unknown>;
export const narrativeSchema = z.object({ narrative: z.string().catch("") });

export function scaffoldNarrative(tp: TestPlan): string {
  return tp.platforms
    .map((p) => {
      const test = p.phases[0];
      return `${p.platform}: ${usd(p.budget)} over ${tp.days} days — test ${p.round1.length} variants (${p.round1.map((v) => v.label).join(", ")}) at ${usd(test.dailyBudget)}/day for ${test.days} days, deciding on ${p.power.decisionMetric === "ctr" ? "CTR" : "hook rate"}${p.power.underpowered ? " (underpowered — treat as directional)" : ""}; ${p.structure.test.split(":")[0]} → ${p.structure.scale.split(" ")[0]} to scale.`;
    })
    .join("\n");
}

export function narrativePrompts(tp: TestPlan): { system: string; user: string } {
  const system = `You are CreativeIntel's paid-media strategist. Write a short, confident testing brief (≤ 120 words) for the advertiser from the plan JSON: what to launch first, how money moves between phases, how winners are called and scaled. Use only numbers present in the plan. Output JSON only: {"narrative": string}.`;
  const compact = tp.platforms.map((p) => ({ platform: p.platform, budget: p.budget, phases: p.phases.map(({ name, days, budget, dailyBudget }) => ({ name, days, budget, dailyBudget })), round1: p.round1.map((v) => v.label), decisionMetric: p.power.decisionMetric, underpowered: p.power.underpowered, targetCpa: p.targetCpa, test: p.structure.test, scale: p.structure.scale }));
  return { system, user: JSON.stringify({ product: tp.productTitle, goal: tp.goal, days: tp.days, totalBudget: tp.totalBudget, platforms: compact }) };
}

const defaultNarrativeLlm: NarrativeLlm = async ({ system, user }) => {
  const { analyzeWithClaude } = await import("@/services/ai/claude-client");
  return analyzeWithClaude({ systemPrompt: system, userPrompt: user, responseSchema: narrativeSchema, maxTokens: 600 });
};

/** One text-model call; any failure keeps a deterministic summary. */
export async function writeTestPlanNarrative(tp: TestPlan, llm: NarrativeLlm = defaultNarrativeLlm): Promise<{ narrative: string; source: "llm" | "scaffold" }> {
  try {
    const out = narrativeSchema.parse((await llm(narrativePrompts(tp))) ?? {}).narrative.trim();
    if (!out) throw new Error("empty narrative");
    return { narrative: out, source: "llm" };
  } catch {
    return { narrative: scaffoldNarrative(tp), source: "scaffold" };
  }
}
