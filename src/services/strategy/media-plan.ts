/**
 * Media-plan strategy agent: product brief + goal + budget + flight + targets (+ account baselines)
 * → a cross-platform media plan:
 *
 *   allocation     greedy marginal-return optimizer in $ steps over a concave response curve per
 *                  channel (conversions = eff × S/CPA × (1 − e^(−spend/S)); awareness: attention-
 *                  weighted impressions). A channel only enters with its minimum viable budget
 *                  (learning-phase threshold × flight days, or a platform floor); channels that can't
 *                  be funded are dropped with the reason.
 *   forecasts      impressions / clicks / conversions / CPA / ROAS, low · expected · high
 *   pacing         weekly budgets per channel (learning week ramps at 80 %)
 *   creative       variants (round 1 + refreshes), aspects and durations per channel, tied to the
 *                  campaign plan's hooks
 *   measurement    UTMs, naming, attribution windows, holdout suggestion
 *   scenarios      conservative / base / aggressive
 *
 * Pure and deterministic; writeMediaPlanNarrative adds one short (injected) model call.
 * Every number that isn't account data is a planning assumption and is listed in `assumptions`.
 */
import { z } from "zod";
import { PLATFORM_PROFILES } from "@/services/creative/platforms.data";
import { DEFAULT_BASELINES, splitCents, type Baseline, type PlatformFamily } from "@/services/creative/test-plan";
import type { PlatformId } from "@/services/creative/types";
import { sampleSizeForLift } from "@/services/performance/stats";

/* ───────────────────────── vocabulary ───────────────────────── */

export type MediaGoal = "sales" | "leads" | "awareness" | "app_installs";
export const MEDIA_GOALS: MediaGoal[] = ["sales", "leads", "awareness", "app_installs"];

export const MEDIA_CHANNELS = ["tiktok", "instagram_reels", "meta_feed", "youtube_shorts", "youtube_instream", "google_demand_gen", "pinterest", "snapchat"] as const;
export type MediaChannel = (typeof MEDIA_CHANNELS)[number];

interface ChannelDef {
  label: string;
  profileId: PlatformId;
  family: PlatformFamily;
  /** Daily spend at which the response curve's marginal return has fallen to 1/e (mid-size US advertiser). */
  dailyCapacity: number;
  /** Planning floor for a daily budget, independent of learning. */
  floorDaily: number;
  /** Optimisation events per ad set per week to exit learning. */
  learnPerWeek: number;
  /** Creative fatigue: new variants every N days. */
  refreshDays: number;
  /** Multipliers on the family baseline. */
  adj?: Partial<Baseline>;
  /** goal → fit 0..1 */
  goalFit: Record<MediaGoal, number>;
  utmSource: string;
  utmMedium: "paid_social" | "paid_video";
  /** Platform macros for utm_content / utm_term (null: type the ad name). */
  macros: { content: string; term: string } | null;
  attribution: string;
}

const META_ATTR = "7-day click, 1-day view (Meta default)";
const GOOGLE_ATTR = "Data-driven; 30-day click, 3-day engaged-view (Google Ads defaults)";
const GOOGLE_MACROS = { content: "{creative}", term: "{adgroupid}" };
const META_MACROS = { content: "{{ad.name}}", term: "{{adset.name}}" };

export const CHANNELS: Record<MediaChannel, ChannelDef> = {
  tiktok: { label: "TikTok", profileId: "tiktok", family: "tiktok", dailyCapacity: 2000, floorDaily: 50, learnPerWeek: 50, refreshDays: 7, goalFit: { sales: 0.85, leads: 0.7, awareness: 0.95, app_installs: 1 }, utmSource: "tiktok", utmMedium: "paid_social", macros: { content: "__CID_NAME__", term: "__AID_NAME__" }, attribution: "7-day click, 1-day view (TikTok default)" },
  instagram_reels: { label: "Instagram Reels", profileId: "instagram_reels", family: "meta", dailyCapacity: 1500, floorDaily: 10, learnPerWeek: 50, refreshDays: 10, adj: { cpm: 0.85, ctr: 0.8 }, goalFit: { sales: 0.9, leads: 0.75, awareness: 0.9, app_installs: 0.9 }, utmSource: "instagram", utmMedium: "paid_social", macros: META_MACROS, attribution: META_ATTR },
  meta_feed: { label: "Meta feed (FB + IG)", profileId: "meta_feed", family: "meta", dailyCapacity: 2500, floorDaily: 10, learnPerWeek: 50, refreshDays: 14, goalFit: { sales: 1, leads: 1, awareness: 0.75, app_installs: 0.95 }, utmSource: "facebook", utmMedium: "paid_social", macros: META_MACROS, attribution: META_ATTR },
  youtube_shorts: { label: "YouTube Shorts", profileId: "youtube_shorts", family: "youtube", dailyCapacity: 1000, floorDaily: 10, learnPerWeek: 15, refreshDays: 14, adj: { cpm: 0.6, ctr: 0.8, hookRate: 0.85 }, goalFit: { sales: 0.7, leads: 0.55, awareness: 0.9, app_installs: 0.75 }, utmSource: "youtube", utmMedium: "paid_video", macros: GOOGLE_MACROS, attribution: GOOGLE_ATTR },
  youtube_instream: { label: "YouTube in-stream", profileId: "youtube_instream_skippable", family: "youtube", dailyCapacity: 1500, floorDaily: 10, learnPerWeek: 15, refreshDays: 21, goalFit: { sales: 0.6, leads: 0.6, awareness: 1, app_installs: 0.6 }, utmSource: "youtube", utmMedium: "paid_video", macros: GOOGLE_MACROS, attribution: GOOGLE_ATTR },
  google_demand_gen: { label: "Google Demand Gen", profileId: "google_demand_gen", family: "youtube", dailyCapacity: 1500, floorDaily: 20, learnPerWeek: 15, refreshDays: 21, adj: { ctr: 1.2 }, goalFit: { sales: 0.85, leads: 0.85, awareness: 0.7, app_installs: 0.85 }, utmSource: "google", utmMedium: "paid_video", macros: GOOGLE_MACROS, attribution: GOOGLE_ATTR },
  pinterest: { label: "Pinterest", profileId: "pinterest", family: "pinterest", dailyCapacity: 600, floorDaily: 10, learnPerWeek: 30, refreshDays: 28, goalFit: { sales: 0.65, leads: 0.5, awareness: 0.7, app_installs: 0.4 }, utmSource: "pinterest", utmMedium: "paid_social", macros: null, attribution: "30-day click, 30-day engagement, 1-day view (Pinterest default)" },
  snapchat: { label: "Snapchat", profileId: "snapchat", family: "snapchat", dailyCapacity: 600, floorDaily: 20, learnPerWeek: 50, refreshDays: 7, goalFit: { sales: 0.5, leads: 0.45, awareness: 0.8, app_installs: 0.85 }, utmSource: "snapchat", utmMedium: "paid_social", macros: null, attribution: "28-day swipe, 1-day view (Snapchat default)" },
};

/** Optimisation-event ladder: the goal event first, then cheaper proxies (frequency ×, delivery-quality factor). */
const EVENT_LADDER: Record<MediaGoal, { event: string; freq: number; quality: number }[]> = {
  sales: [
    { event: "purchase", freq: 1, quality: 1 },
    { event: "add_to_cart", freq: 4, quality: 0.9 },
    { event: "landing_page_view", freq: 20, quality: 0.75 },
  ],
  leads: [
    { event: "lead", freq: 1, quality: 1 },
    { event: "landing_page_view", freq: 8, quality: 0.8 },
  ],
  app_installs: [{ event: "app_install", freq: 1, quality: 1 }],
  awareness: [{ event: "reach", freq: 1, quality: 1 }],
};

/** Lead forms and installs convert clicks more often than a purchase checkout. */
const GOAL_CVR_MULT: Record<MediaGoal, number> = { sales: 1, leads: 2, app_installs: 2.5, awareness: 1 };
const MARKET_WEIGHT: Record<string, number> = { US: 1, CA: 0.15, GB: 0.2, UK: 0.2, AU: 0.12, DE: 0.18, FR: 0.15 };

export function normalizeGoal(g: string | null | undefined): MediaGoal {
  const s = String(g ?? "").toLowerCase();
  if (/aware|reach|brand/.test(s)) return "awareness";
  if (/lead/.test(s)) return "leads";
  if (/app|install/.test(s)) return "app_installs";
  return "sales";
}

export function isMediaChannel(c: string): c is MediaChannel {
  return (MEDIA_CHANNELS as readonly string[]).includes(c);
}

/* ───────────────────────── inputs / outputs ───────────────────────── */

export interface BriefLike {
  audience?: { primary?: string | null; secondary?: (string | null)[] | null } | null;
  product?: { name?: string | null; price?: unknown } | null;
}

export interface MediaPlanInput {
  productTitle?: string;
  brand?: string;
  brief?: BriefLike | null;
  goal: MediaGoal | string;
  totalBudget: number;
  /** ISO dates (inclusive). */
  flight: { start: string; end: string };
  targetCpa?: number;
  targetRoas?: number;
  /** Average order value / price in $ (revenue per conversion for ROAS). */
  aov?: number;
  /** ISO country codes (default US). */
  markets?: string[];
  /** Account baselines by channel id or family (any field). */
  baseline?: Partial<Record<string, Partial<Baseline>>>;
  /** Candidate channels (default: all eight). */
  channels?: string[];
  /** Fall back to a proxy optimisation event when the goal event can't exit learning (default true). */
  allowProxyEvent?: boolean;
  /** Most channels funded at once (default 5). */
  maxChannels?: number;
  /** Optimizer step in $ (default ≈ budget / 500, ≥ $5). */
  stepUsd?: number;
  /** For creative requirements: the project's campaign plan. */
  campaignPlan?: { platforms?: { platform: string; hookVariants?: { hookId: string }[]; endCard?: { id?: string } | null; endCardAlternates?: { id?: string }[] }[] } | null;
  now?: Date;
}

export interface ChannelCurve {
  channel: MediaChannel;
  label: string;
  profileId: PlatformId;
  family: PlatformFamily;
  fit: { audience: number; goal: number; combined: number };
  /** Delivery efficiency 0..1 from fit and the optimisation event. */
  efficiency: number;
  /** Saturation scale S of the response curve over the flight, $. */
  capacityUsd: number;
  baseline: Baseline & { source: "input" | "assumption" };
  /** Cost per goal conversion at zero spend and full efficiency. */
  cpa0: number;
  optimizationEvent: string;
  minDailyUsd: number;
  minFlightUsd: number;
  learning: string;
}

export interface Range {
  low: number;
  expected: number;
  high: number;
}

export interface ChannelForecast {
  spend: number;
  impressions: Range;
  clicks: Range;
  conversions: Range;
  cpa: Range;
  revenue?: Range;
  roas?: Range;
}

export interface ChannelAllocation {
  channel: MediaChannel;
  label: string;
  budget: number;
  share: number;
  dailyBudget: number;
  optimizationEvent: string;
  minDailyUsd: number;
  fit: ChannelCurve["fit"];
  baseline: ChannelCurve["baseline"];
  forecast: ChannelForecast;
  /** $ per extra conversion (or per 1,000 attentive impressions) at the allocated spend. */
  marginalCost: number;
  rationale: string;
}

export interface DroppedChannel {
  channel: string;
  reason: string;
  minDailyUsd?: number;
}

export interface PacingWeek {
  week: number;
  start: string;
  end: string;
  days: number;
  byChannel: Partial<Record<MediaChannel, number>>;
  total: number;
}

export interface CreativeRequirement {
  channel: MediaChannel;
  aspects: string[];
  durations: { idealSec: number; rangeSec: [number, number]; cutdownsSec: number[] };
  hookBySec: number;
  variants: { round1: number; refreshEveryDays: number; refreshes: number; perRefresh: number; total: number; deliverables: number };
  planHooks: string[];
  notes: string[];
}

export interface Scenario {
  name: "conservative" | "base" | "aggressive";
  description: string;
  budget: number;
  channels: { channel: MediaChannel; budget: number }[];
  impressions: number;
  conversions: number;
  cpa: number | null;
  revenue: number | null;
  roas: number | null;
}

export interface MediaPlan {
  version: 1;
  createdAt: string;
  productTitle: string;
  goal: MediaGoal;
  totalBudget: number;
  flight: { start: string; end: string; days: number; weeks: number };
  markets: string[];
  targets: { cpa: number | null; roas: number | null; aov: number | null };
  aov: number | null;
  allocations: ChannelAllocation[];
  dropped: DroppedChannel[];
  totals: { impressions: Range; clicks: Range; conversions: Range; cpa: Range | null; revenue: Range | null; roas: Range | null };
  targetCheck: { status: "on-target" | "stretch" | "off-target" | "n/a"; note: string };
  pacing: { weeks: PacingWeek[]; note: string };
  creative: CreativeRequirement[];
  measurement: {
    naming: { campaign: string; adSet: string; ad: string };
    channels: { channel: MediaChannel; utm: string; attribution: string }[];
    holdout: { method: string; detail: string };
    notes: string[];
  };
  scenarios: Scenario[];
  assumptions: string[];
  warnings: string[];
  narrative?: string;
  narrativeSource?: "llm" | "scaffold";
}

/* ───────────────────────── helpers ───────────────────────── */

const c2 = (n: number) => Math.round(n * 100) / 100;
const r0 = (n: number) => Math.round(n);
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: n < 100 ? 2 : 0, maximumFractionDigits: n < 100 ? 2 : 0 })}`;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const DAY = 86_400_000;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

function parseDay(s: string): number {
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s);
  return Number.isNaN(t) ? NaN : Math.floor(t / DAY) * DAY;
}

export function flightDays(flight: { start: string; end: string }): number {
  const a = parseDay(flight.start);
  const b = parseDay(flight.end);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return NaN;
  return Math.round((b - a) / DAY) + 1;
}

/** "18-34", "13-24", "18-44 (Gen Z …)" → [lo, hi]. */
function ageRange(text: string): [number, number] | null {
  const m = text.match(/(\d{2})\s*(?:-|–|to)\s*(\d{2})/);
  if (m) return [Number(m[1]), Number(m[2])];
  const t = text.toLowerCase();
  if (/\bteens?\b|\bteenagers?\b/.test(t)) return [13, 19];
  if (/gen ?z|college|students?/.test(t)) return [18, 27];
  if (/millennials?/.test(t)) return [28, 43];
  if (/gen ?x/.test(t)) return [44, 59];
  if (/boomers?|seniors?|retirees?/.test(t)) return [60, 75];
  if (/\b(moms?|dads?|parents?|mothers?|fathers?)\b/.test(t)) return [25, 45];
  return null;
}

function genderOf(text: string): "female" | "male" | "both" | null {
  const t = text.toLowerCase();
  const f = /\b(women|woman|female|females|moms?|mothers?|ladies|girls?|her)\b/.test(t);
  const m = /\b(men|man|male|males|dads?|fathers?|guys|boys?|him)\b/.test(t);
  return f && m ? "both" : f ? "female" : m ? "male" : null;
}

function platformGender(skew: string): "female" | "male" | "balanced" {
  const s = skew.toLowerCase();
  if (/balanced/.test(s)) return /male-leaning/.test(s) ? "male" : "balanced";
  if (/female/.test(s)) return "female";
  if (/male/.test(s)) return "male";
  return "balanced";
}

/** 0.3..1 — how well the channel's core audience covers the brief's audience (age overlap × gender). */
export function audienceFit(channel: MediaChannel, brief: BriefLike | null | undefined): number {
  const profile = PLATFORM_PROFILES.find((p) => p.id === CHANNELS[channel].profileId);
  const text = [brief?.audience?.primary, ...(brief?.audience?.secondary ?? [])].filter(Boolean).join(". ");
  if (!profile || !text) return 0.8;
  const ours = ageRange(text);
  const theirs = ageRange(profile.audience.ageCore);
  let age = 0.8;
  if (ours && theirs) {
    const overlap = Math.max(0, Math.min(ours[1], theirs[1]) - Math.max(ours[0], theirs[0]));
    age = 0.4 + 0.6 * clamp(overlap / Math.max(1, ours[1] - ours[0]), 0, 1);
  }
  const g = genderOf(text);
  const pg = platformGender(profile.audience.genderSkew);
  const gender = !g || g === "both" ? 0.95 : pg === "balanced" ? 0.9 : pg === g ? 1 : 0.65;
  return Math.round(clamp(age * gender, 0.3, 1) * 1000) / 1000;
}

function marketFactor(markets: string[]): number {
  const list = markets.length ? markets : ["US"];
  return clamp(
    list.reduce((s, m) => s + (MARKET_WEIGHT[m.toUpperCase()] ?? 0.1), 0),
    0.1,
    3
  );
}

function channelBaseline(channel: MediaChannel, goal: MediaGoal, given: MediaPlanInput["baseline"]): ChannelCurve["baseline"] {
  const def = CHANNELS[channel];
  const fam = DEFAULT_BASELINES[def.family];
  const input = { ...(given?.[def.family] ?? {}), ...(given?.[channel] ?? {}) };
  const assumed: Baseline = {
    cpm: fam.cpm * (def.adj?.cpm ?? 1),
    ctr: fam.ctr * (def.adj?.ctr ?? 1),
    cvr: Math.min(0.9, fam.cvr * (def.adj?.cvr ?? 1) * GOAL_CVR_MULT[goal]),
    hookRate: Math.min(0.95, fam.hookRate * (def.adj?.hookRate ?? 1)),
  };
  const fromInput = Object.values(input).some((v) => typeof v === "number");
  const out = { ...assumed } as Baseline;
  for (const k of Object.keys(assumed) as (keyof Baseline)[]) if (typeof input[k] === "number" && input[k]! > 0) out[k] = input[k]!;
  return { ...out, source: fromInput ? "input" : "assumption" };
}

/* ───────────────────────── response curve ───────────────────────── */

export interface CurveContext {
  goal: MediaGoal | string;
  days: number;
  markets?: string[];
  brief?: BriefLike | null;
  baseline?: MediaPlanInput["baseline"];
  /** Used to pick the optimisation event: the goal event when its learning budget fits, else a proxy. */
  totalBudget?: number;
  allowProxyEvent?: boolean;
}

export function channelCurve(channel: MediaChannel, ctx: CurveContext): ChannelCurve {
  const def = CHANNELS[channel];
  const goal = normalizeGoal(ctx.goal);
  const days = Math.max(1, ctx.days);
  const aud = audienceFit(channel, ctx.brief);
  const gFit = def.goalFit[goal];
  const combined = Math.round((0.4 * aud + 0.6 * gFit) * 1000) / 1000;
  const fitEff = 0.5 + 0.5 * combined;
  const baseline = channelBaseline(channel, goal, ctx.baseline);
  const cpa0 = baseline.cpm / (1000 * baseline.ctr * baseline.cvr);
  const capacityUsd = def.dailyCapacity * days * marketFactor(ctx.markets ?? ["US"]) * (0.5 + 0.5 * aud);

  const ladder = EVENT_LADDER[goal];
  const rungs = (ctx.allowProxyEvent === false ? ladder.slice(0, 1) : ladder).map((r) => {
    const eff = fitEff * r.quality;
    const minDaily = goal === "awareness" ? def.floorDaily : Math.max(def.floorDaily, (def.learnPerWeek / 7) * (cpa0 / eff / r.freq));
    return { ...r, eff, minDaily: c2(minDaily) };
  });
  const budget = ctx.totalBudget ?? Infinity;
  const rung = rungs.find((r) => r.minDaily * days <= budget) ?? rungs[rungs.length - 1];
  const learning =
    goal === "awareness"
      ? `reach/ThruPlay buying — no conversion learning; ${usd(def.floorDaily)}/day planning floor`
      : `${def.learnPerWeek} ${rung.event.replace(/_/g, " ")} events/week per ad set to exit learning → ≥ ${usd(rung.minDaily)}/day`;
  return {
    channel,
    label: def.label,
    profileId: def.profileId,
    family: def.family,
    fit: { audience: aud, goal: gFit, combined },
    efficiency: Math.round(rung.eff * 10000) / 10000,
    capacityUsd: Math.round(capacityUsd),
    baseline,
    cpa0: Math.round(cpa0 * 100) / 100,
    optimizationEvent: rung.event,
    minDailyUsd: rung.minDaily,
    minFlightUsd: c2(rung.minDaily * days),
    learning,
  };
}

/** Average efficiency of the first `spend` dollars: (S/s)(1 − e^(−s/S)), 1 at zero spend. */
function avgEff(c: ChannelCurve, spend: number): number {
  if (spend <= 0) return 1;
  const x = spend / c.capacityUsd;
  return x < 1e-9 ? 1 : (1 - Math.exp(-x)) / x;
}

/**
 * The quantity the optimizer maximises at `spend`: goal conversions, or for awareness
 * attention-weighted impressions (impressions × hook rate). Concave in spend.
 */
export function responseValue(c: ChannelCurve, spend: number, goal: MediaGoal | string): number {
  if (spend <= 0) return 0;
  const f = c.efficiency * avgEff(c, spend);
  if (normalizeGoal(goal) === "awareness") return ((1000 * spend) / c.baseline.cpm) * Math.sqrt(f) * c.baseline.hookRate;
  return (spend * f) / c.cpa0;
}

function band(source: "input" | "assumption"): number {
  return source === "input" ? 0.08 : 0.15;
}

const range = (a: number, b: number, c: number): Range => {
  const [low, expected, high] = [a, b, c].sort((x, y) => x - y);
  return { low, expected, high };
};
const roundRange = (r: Range, k = 0): Range => {
  const f = 10 ** k;
  return { low: Math.round(r.low * f) / f, expected: Math.round(r.expected * f) / f, high: Math.round(r.high * f) / f };
};

/**
 * Forecast at `spend`: impressions = 1000·s/CPM·√f, clicks = impr·CTR·f^¼, conversions = clicks·CVR·f^¼
 * (= s·f/CPA), f = efficiency × average curve efficiency. Low/high flex CPM, CTR and CVR by ±15 %
 * (±8 % with account baselines).
 */
export function forecastChannel(c: ChannelCurve, spend: number, opts: { goal: MediaGoal | string; aov?: number | null }): ChannelForecast {
  const f = c.efficiency * avgEff(c, spend);
  const u = band(c.baseline.source);
  const at = (cpmK: number, ctrK: number, cvrK: number) => {
    const impressions = spend > 0 ? ((1000 * spend) / (c.baseline.cpm * cpmK)) * Math.sqrt(f) : 0;
    const clicks = impressions * c.baseline.ctr * ctrK * f ** 0.25;
    const conversions = ((spend * f) / c.cpa0) * ((ctrK * cvrK) / cpmK);
    return { impressions, clicks, conversions };
  };
  const lo = at(1 + u, 1 - u, 1 - u);
  const ex = at(1, 1, 1);
  const hi = at(1 - u, 1 + u, 1 + u);
  const conv = range(lo.conversions, ex.conversions, hi.conversions);
  const cpa = range(conv.high ? spend / conv.high : 0, conv.expected ? spend / conv.expected : 0, conv.low ? spend / conv.low : 0);
  const out: ChannelForecast = {
    spend: c2(spend),
    impressions: roundRange(range(lo.impressions, ex.impressions, hi.impressions)),
    clicks: roundRange(range(lo.clicks, ex.clicks, hi.clicks)),
    conversions: roundRange(conv, 2),
    cpa: roundRange(cpa, 2),
  };
  if (opts.aov && opts.aov > 0 && normalizeGoal(opts.goal) === "sales") {
    out.revenue = roundRange(range(conv.low * opts.aov, conv.expected * opts.aov, conv.high * opts.aov), 2);
    out.roas = roundRange(range(spend ? (conv.low * opts.aov) / spend : 0, spend ? (conv.expected * opts.aov) / spend : 0, spend ? (conv.high * opts.aov) / spend : 0), 2);
  }
  return out;
}

/* ───────────────────────── optimizer ───────────────────────── */

export interface AllocateOptions {
  totalCents: number;
  stepCents: number;
  goal: MediaGoal | string;
  maxChannels?: number;
}

export interface AllocationResult {
  /** channel → cents (only funded channels). */
  allocations: Map<string, number>;
  dropped: DroppedChannel[];
  /** Activation order. */
  order: string[];
}

/**
 * Greedy marginal-return allocation in $ steps. A funded channel competes with the return of its next
 * step; an unfunded one with the average return of its minimum viable budget (it can only enter with
 * all of it). The largest return per $ wins each round; the sub-step remainder goes to the best
 * marginal channel, so the allocation sums to the cent.
 */
export function allocateBudget(curves: ChannelCurve[], opts: AllocateOptions): AllocationResult {
  const total = Math.max(0, Math.round(opts.totalCents));
  const step = Math.max(1, Math.round(opts.stepCents));
  const maxCh = Math.max(1, opts.maxChannels ?? 5);
  const alloc = new Map<string, number>();
  const order: string[] = [];
  const val = (c: ChannelCurve, cents: number) => responseValue(c, cents / 100, opts.goal);
  let remaining = total;
  let capped = false;

  for (;;) {
    let best: { c: ChannelCurve; add: number; perCent: number } | null = null;
    for (const c of curves) {
      const cur = alloc.get(c.channel);
      if (cur !== undefined) {
        const add = Math.min(step, remaining);
        if (add <= 0) continue;
        const perCent = (val(c, cur + add) - val(c, cur)) / add;
        if (!best || perCent > best.perCent + 1e-15) best = { c, add, perCent };
      } else {
        if (alloc.size >= maxCh) {
          capped = true;
          continue;
        }
        const lump = Math.max(step, Math.ceil(c.minFlightUsd * 100));
        if (lump > remaining) continue;
        const perCent = val(c, lump) / lump;
        if (!best || perCent > best.perCent + 1e-15) best = { c, add: lump, perCent };
      }
    }
    if (!best) break;
    if (!alloc.has(best.c.channel)) order.push(best.c.channel);
    alloc.set(best.c.channel, (alloc.get(best.c.channel) ?? 0) + best.add);
    remaining -= best.add;
    if (remaining <= 0) break;
  }

  // Leftover (smaller than any activation lump): the funded channel with the best marginal return.
  if (remaining > 0 && alloc.size) {
    let bestCh: ChannelCurve | null = null;
    let bestM = -Infinity;
    for (const c of curves) {
      const cur = alloc.get(c.channel);
      if (cur === undefined) continue;
      const m = val(c, cur + remaining) - val(c, cur);
      if (m > bestM) {
        bestM = m;
        bestCh = c;
      }
    }
    if (bestCh) alloc.set(bestCh.channel, alloc.get(bestCh.channel)! + remaining);
  }

  const dropped: DroppedChannel[] = curves
    .filter((c) => !alloc.has(c.channel))
    .map((c) => {
      const minDailyUsd = c.minDailyUsd;
      if (c.minFlightUsd * 100 > total)
        return { channel: c.channel, minDailyUsd, reason: `Minimum viable budget ${usd(c.minDailyUsd)}/day (${c.learning}) × flight = ${usd(c.minFlightUsd)} exceeds the ${usd(total / 100)} total` };
      if (capped && alloc.size >= maxCh) return { channel: c.channel, minDailyUsd, reason: `Channel cap (${maxCh}) reached — funded channels return more per $ at this budget` };
      return { channel: c.channel, minDailyUsd, reason: `Its minimum viable budget (${usd(c.minFlightUsd)}) returns less per $ than adding to the funded channels at this budget` };
    });
  return { allocations: alloc, dropped, order };
}

/* ───────────────────────── plan sections ───────────────────────── */

function marginalCost(c: ChannelCurve, spend: number, goal: MediaGoal): number {
  const d = Math.max(1, spend * 0.01);
  const dv = responseValue(c, spend + d, goal) - responseValue(c, spend, goal);
  if (dv <= 0) return Infinity;
  return goal === "awareness" ? c2((d / dv) * 1000) : c2(d / dv);
}

function sumRanges(rs: Range[]): Range {
  return rs.reduce((s, r) => ({ low: s.low + r.low, expected: s.expected + r.expected, high: s.high + r.high }), { low: 0, expected: 0, high: 0 });
}

function weeksOf(start: number, days: number): { start: number; days: number }[] {
  const out: { start: number; days: number }[] = [];
  for (let d = 0; d < days; d += 7) out.push({ start: start + d * DAY, days: Math.min(7, days - d) });
  return out;
}

function pacingFor(allocs: { channel: MediaChannel; cents: number }[], startDay: number, days: number): PacingWeek[] {
  const weeks = weeksOf(startDay, days);
  const weights = weeks.map((w, i) => w.days * (i === 0 && weeks.length > 1 ? 0.8 : 1));
  const per = allocs.map((a) => ({ channel: a.channel, parts: splitCents(a.cents / 100, weights).map((x) => Math.round(x * 100)) }));
  return weeks.map((w, i) => {
    const byChannel: Partial<Record<MediaChannel, number>> = {};
    let tot = 0;
    for (const p of per) {
      byChannel[p.channel] = p.parts[i] / 100;
      tot += p.parts[i];
    }
    return { week: i + 1, start: isoDay(w.start), end: isoDay(w.start + (w.days - 1) * DAY), days: w.days, byChannel, total: tot / 100 };
  });
}

function creativeFor(a: ChannelAllocation, curve: ChannelCurve, goal: MediaGoal, days: number, plan: MediaPlanInput["campaignPlan"]): CreativeRequirement {
  const def = CHANNELS[a.channel];
  const profile = PLATFORM_PROFILES.find((p) => p.id === def.profileId)!;
  const aspects = [...new Set([...(Array.isArray(profile.aspect) ? profile.aspect : [profile.aspect]), ...(a.channel === "meta_feed" ? ["1:1", "9:16"] : a.channel === "youtube_instream" ? ["9:16"] : [])])];
  const { ideal, range: rng } = profile.durationSec;
  const cutdowns = [...new Set([rng[0], a.channel === "youtube_instream" ? 6 : 0].filter((x) => x > 0 && x < ideal))].sort((x, y) => x - y);
  // A variant needs about 3× expected CPA (the test-plan kill rule) — or, for awareness, a powered hook-rate sample.
  const perVariant =
    goal === "awareness"
      ? (sampleSizeForLift(curve.baseline.hookRate, 0.2) / 1000) * curve.baseline.cpm
      : 3 * Math.max(a.forecast.cpa.expected, curve.cpa0);
  const testBudget = 0.35 * a.budget;
  const round1 = clamp(Math.floor(testBudget / Math.max(1, perVariant)), 2, 6);
  const refreshes = Math.max(0, Math.floor((days - 1) / def.refreshDays));
  const perRefresh = Math.max(2, Math.ceil(round1 / 2));
  const total = round1 + refreshes * perRefresh;
  const pp = plan?.platforms?.find((p) => p.platform === def.profileId) ?? plan?.platforms?.find((p) => CHANNELS[a.channel].family === familyOfPlanPlatform(p.platform));
  const planHooks = [...new Set((pp?.hookVariants ?? []).map((h) => h.hookId))];
  const notes: string[] = [];
  if (!pp) notes.push(`No campaign-plan entry for ${def.label} — run plan-campaign with platform ${def.profileId} for its hooks, end card and beat map.`);
  else if (planHooks.length < round1) notes.push(`Round 1 needs ${round1} hooks; the plan has ${planHooks.length} — add ${round1 - planHooks.length} (next-round explore or plan-campaign).`);
  notes.push(`Refresh ${perRefresh} new variants every ${def.refreshDays} days (or when frequency > 3 / CTR falls 20% from peak).`);
  if (perVariant * 2 > testBudget) notes.push("Test budget powers fewer than 2 variants at the decision sample — treat round 1 as directional.");
  return {
    channel: a.channel,
    aspects,
    durations: { idealSec: ideal, rangeSec: rng, cutdownsSec: cutdowns },
    hookBySec: profile.hookSec,
    variants: { round1, refreshEveryDays: def.refreshDays, refreshes, perRefresh, total, deliverables: total * aspects.length },
    planHooks,
    notes,
  };
}

function familyOfPlanPlatform(id: string): PlatformFamily {
  if (/tiktok/.test(id)) return "tiktok";
  if (/youtube|google/.test(id)) return "youtube";
  if (/pinterest/.test(id)) return "pinterest";
  if (/snap/.test(id)) return "snapchat";
  return "meta";
}

const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "").slice(0, 24) || "Brand";

function measurementFor(input: MediaPlanInput, goal: MediaGoal, allocs: ChannelAllocation[], days: number, startDay: number): MediaPlan["measurement"] {
  const brand = slug(input.brand || input.productTitle || "Brand");
  const market = (input.markets?.[0] ?? "US").toUpperCase();
  const ym = isoDay(startDay).slice(0, 7).replace("-", "");
  const campaign = (ch: string) => `${brand}_${market}_${ch}_${goal}_${ym}`;
  const channels = allocs.map((a) => {
    const def = CHANNELS[a.channel];
    const content = def.macros?.content ?? "<ad name>";
    const term = def.macros?.term ?? "<ad set name>";
    return {
      channel: a.channel,
      utm: `utm_source=${def.utmSource}&utm_medium=${def.utmMedium}&utm_campaign=${campaign(a.channel)}&utm_content=${content}&utm_term=${term}`,
      attribution: def.attribution,
    };
  });
  const total = input.totalBudget;
  const top = [...allocs].sort((x, y) => y.budget - x.budget)[0];
  const holdout =
    total >= 50_000 && days >= 28
      ? { method: "geo holdout (matched markets)", detail: `Hold out 10–15% of matched DMAs/regions for the whole flight; read incremental ${goal === "awareness" ? "branded search and direct traffic" : "conversions"} against the exposed markets (≈ ${usd(total * 0.12)} of spend effectively withheld).` }
      : top && top.budget >= 10_000
        ? { method: `platform lift study on ${top.label}`, detail: `Run the platform's conversion/brand lift study (randomised user holdout, typically 10%) on ${top.label}, the largest line (${usd(top.budget)}); use its incrementality factor to discount the other channels' platform-reported results.` }
        : { method: "pre/post read on blended MER", detail: "Too little spend for a powered holdout — compare blended MER (total revenue ÷ total ad spend) for the 2 weeks before vs during the flight, and keep one small channel off as a directional control." };
  return {
    naming: {
      campaign: campaign("{channel}"),
      adSet: "{optimizationEvent}_{audience}_{placement}",
      ad: "Batch Mode ad name: Brand_Script_{dur}s_Hook{Hxx}_{Exx}_{aspect}_V{voice}_M{music}_C{cta} — the Performance Agent parses hook / end card / aspect from it",
    },
    channels,
    holdout,
    notes: [
      "Attribution windows are each platform's default — confirm them in every account and compare channels on a common 7-day-click view.",
      "Blended MER (all revenue ÷ all paid spend) is the arbiter when platform-reported conversions overlap.",
      "Import results weekly (Meta / TikTok exports) so the Performance Agent and next-round can call winners.",
    ],
  };
}

/* ───────────────────────── plan ───────────────────────── */

interface Solved {
  curves: ChannelCurve[];
  result: AllocationResult;
}

function solve(input: MediaPlanInput, goal: MediaGoal, days: number, budget: number, opts: { maxChannels: number; allowProxyEvent: boolean }): Solved {
  const ids = (input.channels?.length ? input.channels : [...MEDIA_CHANNELS]).filter(isMediaChannel);
  const curves = [...new Set(ids)].map((ch) =>
    channelCurve(ch, { goal, days, markets: input.markets, brief: input.brief, baseline: input.baseline, totalBudget: budget, allowProxyEvent: opts.allowProxyEvent })
  );
  const stepUsd = input.stepUsd ?? Math.max(5, Math.round(budget / 500));
  const result = allocateBudget(curves, { totalCents: Math.round(budget * 100), stepCents: Math.round(stepUsd * 100), goal, maxChannels: opts.maxChannels });
  return { curves, result };
}

function scenarioOf(name: Scenario["name"], description: string, solved: Solved, goal: MediaGoal, aov: number | null, pick: keyof Range): Scenario {
  const rows = solved.curves.filter((c) => solved.result.allocations.has(c.channel)).map((c) => ({ c, spend: solved.result.allocations.get(c.channel)! / 100 }));
  const fs = rows.map((r) => forecastChannel(r.c, r.spend, { goal, aov }));
  const budget = c2(rows.reduce((s, r) => s + r.spend, 0));
  const conversions = Math.round(fs.reduce((s, f) => s + f.conversions[pick], 0) * 100) / 100;
  const revenue = aov && goal === "sales" ? c2(conversions * aov) : null;
  return {
    name,
    description,
    budget,
    channels: rows.map((r) => ({ channel: r.c.channel, budget: c2(r.spend) })),
    impressions: r0(fs.reduce((s, f) => s + f.impressions[pick], 0)),
    conversions,
    cpa: goal !== "awareness" && conversions > 0 ? c2(budget / conversions) : null,
    revenue,
    roas: revenue !== null && budget > 0 ? Math.round((revenue / budget) * 100) / 100 : null,
  };
}

export function buildMediaPlan(input: MediaPlanInput): MediaPlan {
  const goal = normalizeGoal(input.goal);
  const days = flightDays(input.flight);
  if (!Number.isFinite(days)) throw new Error("Invalid flight: start and end must be dates with end ≥ start");
  const startDay = parseDay(input.flight.start);
  const total = c2(Math.max(0, input.totalBudget));
  const aov = input.aov && input.aov > 0 ? input.aov : null;
  const targetCpa = input.targetCpa ?? (input.targetRoas && aov ? c2(aov / input.targetRoas) : null);
  const allowProxyEvent = input.allowProxyEvent !== false;
  const maxChannels = input.maxChannels ?? 5;

  const solved = solve(input, goal, days, total, { maxChannels, allowProxyEvent });
  const funded = solved.curves.filter((c) => solved.result.allocations.has(c.channel));
  const allocations: ChannelAllocation[] = funded
    .map((c) => {
      const cents = solved.result.allocations.get(c.channel)!;
      const spend = cents / 100;
      const forecast = forecastChannel(c, spend, { goal, aov });
      const mc = marginalCost(c, spend, goal);
      return {
        channel: c.channel,
        label: c.label,
        budget: spend,
        share: total ? cents / Math.round(total * 100) : 0,
        dailyBudget: c2(spend / days),
        optimizationEvent: c.optimizationEvent,
        minDailyUsd: c.minDailyUsd,
        fit: c.fit,
        baseline: c.baseline,
        forecast,
        marginalCost: mc,
        rationale: `${c.label}: audience fit ${Math.round(c.fit.audience * 100)}%, ${goal} fit ${Math.round(c.fit.goal * 100)}%; optimise for ${c.optimizationEvent.replace(/_/g, " ")} (${c.learning}); next $ buys ${goal === "awareness" ? `1,000 attentive impressions at ${usd(mc)}` : `a conversion at ${usd(mc)}`}.`,
      };
    })
    .sort((a, b) => b.budget - a.budget);

  const warnings: string[] = [];
  if (!allocations.length) {
    const cheapest = [...solved.curves].sort((a, b) => a.minFlightUsd - b.minFlightUsd)[0];
    warnings.push(`The budget is below every channel's minimum viable budget for this flight${cheapest ? ` — the cheapest is ${cheapest.label} at ${usd(cheapest.minFlightUsd)} (${usd(cheapest.minDailyUsd)}/day)` : ""}; raise the budget, shorten the flight or allow a proxy optimisation event.`);
  }
  const proxied = allocations.filter((a) => a.optimizationEvent !== EVENT_LADDER[goal][0].event);
  for (const a of proxied) warnings.push(`${a.label} can't fund ${EVENT_LADDER[goal][0].event.replace(/_/g, " ")} learning at this budget — optimise for ${a.optimizationEvent.replace(/_/g, " ")} and switch once volume allows.`);
  if (targetCpa && goal !== "awareness") for (const a of allocations) if (a.marginalCost > targetCpa * 1.5) warnings.push(`${a.label}: the last dollars buy conversions at ${usd(a.marginalCost)}, above 1.5× the ${usd(targetCpa)} target — cap it lower if the target is binding.`);

  const fs = allocations.map((a) => a.forecast);
  const conv = sumRanges(fs.map((f) => f.conversions));
  const revenue = aov && goal === "sales" ? sumRanges(fs.map((f) => f.revenue!)) : null;
  const spent = allocations.reduce((s, a) => s + a.budget, 0);
  const totals: MediaPlan["totals"] = {
    impressions: roundRange(sumRanges(fs.map((f) => f.impressions))),
    clicks: roundRange(sumRanges(fs.map((f) => f.clicks))),
    conversions: roundRange(conv, 2),
    cpa: goal !== "awareness" && conv.low > 0 ? roundRange(range(spent / conv.high, spent / conv.expected, spent / conv.low), 2) : null,
    revenue: revenue ? roundRange(revenue, 2) : null,
    roas: revenue && spent ? roundRange(range(revenue.low / spent, revenue.expected / spent, revenue.high / spent), 2) : null,
  };

  let targetCheck: MediaPlan["targetCheck"] = { status: "n/a", note: goal === "awareness" ? "Awareness plan — judged on reach, CPM and hook rate, not CPA." : "No target CPA / ROAS given." };
  if (goal !== "awareness" && targetCpa && totals.cpa) {
    targetCheck =
      totals.cpa.expected <= targetCpa
        ? { status: "on-target", note: `Expected blended CPA ${usd(totals.cpa.expected)} meets the ${usd(targetCpa)} target.` }
        : totals.cpa.low <= targetCpa
          ? { status: "stretch", note: `Expected blended CPA ${usd(totals.cpa.expected)} misses the ${usd(targetCpa)} target; only the high case (${usd(totals.cpa.low)}) reaches it — creative wins must beat baseline.` }
          : { status: "off-target", note: `Even the high case (${usd(totals.cpa.low)}) misses the ${usd(targetCpa)} target — lower the target, raise AOV, or treat the flight as a test.` };
  }

  const weeks = pacingFor(allocations.map((a) => ({ channel: a.channel, cents: Math.round(a.budget * 100) })), startDay, days);
  const creative = allocations.map((a) => creativeFor(a, funded.find((c) => c.channel === a.channel)!, goal, days, input.campaignPlan));
  const measurement = measurementFor(input, goal, allocations, days, startDay);

  const scenarios: Scenario[] = [
    scenarioOf("conservative", "80% of budget deployed on the 2 strongest channels (20% held until week-2 results), low-case baselines", solve(input, goal, days, c2(total * 0.8), { maxChannels: 2, allowProxyEvent }), goal, aov, "low"),
    scenarioOf("base", "Full budget on the optimised mix, expected baselines", solved, goal, aov, "expected"),
    scenarioOf("aggressive", "Scale +25% if week-2 CPA beats target, up to 6 channels, high-case baselines", solve(input, goal, days, c2(total * 1.25), { maxChannels: 6, allowProxyEvent }), goal, aov, "high"),
  ];

  const assumptions = [
    "Learning-phase thresholds (planning assumptions, per ad set): Meta (feed, Reels) ≈ 50 conversions/week; TikTok ≈ 50 conversions in 7 days per ad group (and a $50/day campaign minimum); Snapchat ≈ 50/week; Pinterest ≈ 30/week; Google Demand Gen / YouTube ≈ 15/week for smart bidding. Minimum viable daily budget = max(planning floor, events/7 × expected CPA).",
    `When the goal event can't exit learning at this budget, a proxy event is used${allowProxyEvent ? "" : " (disabled for this plan)"}: add to cart ≈ 4× and landing-page view ≈ 20× as frequent as purchase (lead: landing-page view ≈ 8×), at 10–25% lower delivery quality.`,
    "Response curve per channel: conversions = efficiency × S/CPA × (1 − e^(−spend/S)); S = daily capacity (TikTok $2,000, Meta feed $2,500, Reels $1,500, YouTube in-stream / Demand Gen $1,500, Shorts $1,000, Pinterest / Snapchat $600 per day for a US mid-size advertiser) × days × market size × audience fit.",
    "Efficiency = 0.5 + 0.5 × fit, fit = 40% audience (age-band overlap with the platform's core audience × gender skew) + 60% goal fit.",
    "Default baselines are mid-points of published 2024–25 US e-commerce video benchmarks (Meta CPM $12 / CTR 1% / CVR 2.5%; TikTok $8 / 0.9% / 1.5%; YouTube $10 / 0.6% / 1.5%; Pinterest $6 / 0.5% / 1.5%; Snapchat $5 / 0.6% / 1%), not this account's data; leads ×2 and installs ×2.5 click-to-conversion. Pass account baselines to narrow the low/high band from ±15% to ±8%.",
    "Weekly pacing: the learning week runs at 80% of an even daily pace; budgets split to the cent.",
  ];

  return {
    version: 1,
    createdAt: (input.now ?? new Date()).toISOString(),
    productTitle: input.productTitle ?? input.brief?.product?.name ?? "",
    goal,
    totalBudget: total,
    flight: { start: isoDay(startDay), end: isoDay(parseDay(input.flight.end)), days, weeks: weeks.length },
    markets: (input.markets?.length ? input.markets : ["US"]).map((m) => m.toUpperCase()),
    targets: { cpa: targetCpa, roas: input.targetRoas ?? null, aov },
    aov,
    allocations,
    dropped: solved.result.dropped,
    totals,
    targetCheck,
    pacing: { weeks, note: "Week 1 (learning) at 80% pace; move up to 20% of a week's budget between channels on week-over-week CPA, never inside a channel's learning phase." },
    creative,
    measurement,
    scenarios,
    assumptions,
    warnings,
  };
}

/* ───────────────────────── narrative ───────────────────────── */

export type MediaPlanLlm = (args: { system: string; user: string }) => Promise<unknown>;
export const mediaNarrativeSchema = z.object({ narrative: z.string().catch("") });

export function scaffoldMediaNarrative(p: MediaPlan): string {
  if (!p.allocations.length) return p.warnings[0] ?? "No channel can be funded at this budget.";
  const mix = p.allocations.map((a) => `${a.label} ${usd(a.budget)} (${Math.round(a.share * 100)}%)`).join(", ");
  const conv = p.goal === "awareness" ? `${p.totals.impressions.expected.toLocaleString("en-US")} impressions expected` : `${p.totals.conversions.expected} conversions expected (${p.totals.conversions.low}–${p.totals.conversions.high})${p.totals.cpa ? ` at ${usd(p.totals.cpa.expected)} CPA` : ""}`;
  return `${usd(p.totalBudget)} over ${p.flight.days} days: ${mix}. ${conv}. ${p.targetCheck.note} Measure with ${p.measurement.holdout.method}.`;
}

export function mediaNarrativePrompts(p: MediaPlan): { system: string; user: string } {
  const system = `You are CreativeIntel's media strategist. Write a short, confident media-plan brief (≤ 130 words) from the plan JSON: where the money goes and why, what to expect, how pacing and measurement work, and the main risk. Use only numbers present in the plan. Output JSON only: {"narrative": string}.`;
  const compact = {
    goal: p.goal,
    budget: p.totalBudget,
    flight: p.flight,
    allocations: p.allocations.map((a) => ({ channel: a.label, budget: a.budget, share: Math.round(a.share * 100), event: a.optimizationEvent, conversions: a.forecast.conversions, cpa: a.forecast.cpa.expected })),
    dropped: p.dropped.map((d) => ({ channel: d.channel, reason: d.reason })),
    totals: p.totals,
    target: p.targetCheck,
    scenarios: p.scenarios.map((s) => ({ name: s.name, budget: s.budget, conversions: s.conversions, cpa: s.cpa })),
    holdout: p.measurement.holdout.method,
  };
  return { system, user: JSON.stringify(compact) };
}

const defaultMediaLlm: MediaPlanLlm = async ({ system, user }) => {
  const { analyzeWithClaude } = await import("@/services/ai/claude-client");
  return analyzeWithClaude({ systemPrompt: system, userPrompt: user, responseSchema: mediaNarrativeSchema, maxTokens: 600 });
};

/** One text-model call; any failure keeps a deterministic summary. */
export async function writeMediaPlanNarrative(p: MediaPlan, llm: MediaPlanLlm = defaultMediaLlm): Promise<{ narrative: string; source: "llm" | "scaffold" }> {
  try {
    const out = mediaNarrativeSchema.parse((await llm(mediaNarrativePrompts(p))) ?? {}).narrative.trim();
    if (!out) throw new Error("empty narrative");
    return { narrative: out, source: "llm" };
  } catch {
    return { narrative: scaffoldMediaNarrative(p), source: "scaffold" };
  }
}
