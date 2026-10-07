/**
 * Auto-iteration agent — closes the loop from results to the next test round (Creatify's
 * "Performance Agent" iterate step). Reads the element learning (Bayesian posteriors per hook / end
 * card), the current campaign plan and the competitor hook trends, and PROPOSES round N+1:
 *
 *   keep      the called winner(s) on the decision metric (CTR when it has a call, else hook rate);
 *   kill      eligible arms with P(best) < 5 % (the min-sample guard decides "enough sample");
 *   retest    under-sampled or inconclusive arms, with the impressions still needed;
 *   explore   2–3 new hooks: the winning family first (rising trends lead), then a rising trend
 *             from another family; no data → a diverse exploration round (plan hooks or the library);
 *   cutdowns  shorter cuts and placement aspects of the winners (re-edits).
 *
 * Output: a batch-matrix compatible spec (BatchDims + named variants) plus plan hook variants for the
 * new hooks, priced with ops/cost-model: re-edits $0, a new hook clip = keyframe + clip + QC.
 * It NEVER renders or spends — the proposal says so and waits for an explicit approval.
 */
import { prisma } from "@/lib/db";
import { BATCH_DURATIONS, batchAdName, DEFAULT_BATCH_VOICE, planPlatform, type BatchDims } from "@/services/creative/batch-matrix";
import type { CampaignPlan, HookVariant, PlatformPlan } from "@/services/creative/campaign-plan.types";
import { normalizePlatform, scaffoldPlatformPlan } from "@/services/creative/campaign-planner";
import { hookById, HOOKS, inGiftingWindow, platformProfile, selectCreative } from "@/services/creative/library";
import type { ProductBrief } from "@/services/creative/product-brief";
import type { CategoryId, HookFamily, PlatformId } from "@/services/creative/types";
import { DEFAULT_PRICES, imageCostUsd, qcCallUsd, videoCostUsd, type PriceTable } from "@/services/ops/cost-model";
import { categoryKey, trendBiasFromSlice, trendSlice, type TrendSlice } from "@/services/research/hook-trends";
import { OPENROUTER_IMAGE_MODEL, OPENROUTER_VIDEO_MODEL } from "@/services/video-gen/libtv-pricing";
import { loadElementLearning } from "./agent";
import { RATE_METRICS, type DimLearning, type ElementLearning, type RateMetric } from "./attribution";

/** P(best) under this, on an arm past the min-sample guard, is a loser. */
export const KILL_P_BEST = 0.05;
const MAX_EXPLORE = 3;
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const pctTxt = (n: number) => `${(n * 100).toFixed(n < 0.1 ? 1 : 0)}%`;

export type Verdict = "keep" | "kill" | "retest";

export interface ElementVerdict {
  id: string;
  dim: "hookId" | "endCardId";
  verdict: Verdict;
  name: string;
  family?: HookFamily;
  metric: RateMetric | null;
  pBest: number | null;
  rate: number | null;
  trials: number;
  reason: string;
}

export interface ExploreHook {
  hookId: string;
  name: string;
  family: HookFamily;
  source: "winning_family" | "trend" | "plan" | "library";
  reason: string;
}

export interface RoundVariant {
  name: string;
  hook: string;
  endCard: string;
  aspect: string;
  durationSec: number;
  cta: string;
  intent: "keep" | "cutdown" | "aspect" | "retest" | "explore" | "end_card_retest";
  needsGeneration: boolean;
}

export interface RoundCost {
  unit: "usd";
  reEditVariants: number;
  reEditUsd: 0;
  newHookClips: number;
  perHookClipUsd: number;
  /** Expected: keyframe + clip + one QC call per new hook. */
  totalUsd: number;
  /** One reroll per new hook. */
  highUsd: number;
  models: { imageModel: string; videoModel: string; hookSec: number };
  sources: string[];
}

export interface NextRoundProposal {
  version: 1;
  createdAt: string;
  projectId: string;
  platform: PlatformId;
  mode: "iterate" | "explore";
  decisionMetric: RateMetric | null;
  winningFamily: HookFamily | null;
  keep: ElementVerdict[];
  kill: ElementVerdict[];
  retest: ElementVerdict[];
  endCards: { keep: ElementVerdict[]; kill: ElementVerdict[]; retest: ElementVerdict[] };
  explore: ExploreHook[];
  cutdowns: { hookId: string; durations: number[]; aspects: string[] }[];
  batch: { dims: BatchDims; design: "pairwise"; variants: RoundVariant[]; reEditVariants: number; needsGenerationVariants: number; newHooks: string[] };
  newHookVariants: HookVariant[];
  cost: RoundCost;
  approval: { required: true; note: string };
  notes: string[];
}

/* ───────────────────────── verdicts ───────────────────────── */

const METRIC_ORDER: RateMetric[] = ["ctr", "hookRate"];

/** The metric the call is made on: CTR when it has a call (or a comparison), else hook rate. */
function decisionMetric(d: DimLearning | undefined): RateMetric | null {
  if (!d) return null;
  for (const m of METRIC_ORDER) if (d.tests[m] && d.tests[m]!.status !== "insufficient_data") return m;
  return METRIC_ORDER.find((m) => d.tests[m]) ?? null;
}

function verdicts(d: DimLearning | undefined, dim: "hookId" | "endCardId"): { metric: RateMetric | null; list: ElementVerdict[] } {
  if (!d) return { metric: null, list: [] };
  const valid = dim === "hookId" ? /^H\d\d$/ : /^E\d\d$/;
  const metric = decisionMetric(d);
  const test = metric ? d.tests[metric] : undefined;
  const spec = metric ? RATE_METRICS[metric] : null;
  const name = (id: string) => (dim === "hookId" ? hookById(id)?.name ?? id : id);
  const list: ElementVerdict[] = [];
  for (const lvl of d.levels) {
    if (!valid.test(lvl.level)) continue;
    const base = { id: lvl.level, dim, name: name(lvl.level), family: dim === "hookId" ? hookById(lvl.level)?.family : undefined, metric, trials: Math.round(spec ? (lvl[spec.den] as number) : lvl.impressions), rate: metric ? (lvl[metric] ?? null) : null };
    const arm = test?.arms.find((a) => a.level === lvl.level);
    if (!test || !arm) {
      list.push({ ...base, verdict: d.levels.length === 1 ? "keep" : "retest", pBest: null, reason: d.levels.length === 1 ? "the only one with results — the control for the next round" : "no comparable results yet" });
      continue;
    }
    if (test.status === "winner" && test.winner?.level === lvl.level) {
      list.push({ ...base, verdict: "keep", pBest: arm.pBest, reason: `winner: P(best) ${pctTxt(arm.pBest ?? 0)} on ${metric}${test.winner.liftVsRunnerUp !== null ? `, +${Math.round(test.winner.liftVsRunnerUp * 100)}% vs the runner-up` : ""}` });
    } else if (arm.eligible && arm.pBest !== null && arm.pBest < KILL_P_BEST) {
      list.push({ ...base, verdict: "kill", pBest: arm.pBest, reason: `loser: P(best) ${pctTxt(arm.pBest)} on ${metric} over ${base.trials.toLocaleString("en-US")} ${spec!.den}` });
    } else if (!arm.eligible) {
      const need = Math.max(0, spec!.minTrials - base.trials);
      list.push({ ...base, verdict: "retest", pBest: null, reason: `under the min sample: ${base.trials.toLocaleString("en-US")} of ${spec!.minTrials.toLocaleString("en-US")} ${spec!.den}${need ? ` — needs ~${need.toLocaleString("en-US")} more impressions` : ""}${spec!.minSuccesses ? ` and ${spec!.minSuccesses}+ ${spec!.num}` : ""}` });
    } else {
      list.push({ ...base, verdict: "retest", pBest: arm.pBest, reason: `inconclusive: P(best) ${pctTxt(arm.pBest ?? 0)} on ${metric} — keep it in the test` });
    }
  }
  return { metric, list };
}

function winningFamily(learning: ElementLearning, keep: ElementVerdict[], hooks: ElementVerdict[]): HookFamily | null {
  const famDim = learning.dims.find((d) => d.dim === "hookFamily");
  const m = decisionMetric(famDim);
  const w = m ? famDim?.tests[m]?.winner?.level : null;
  if (w && ["reveal", "claim", "native", "demo"].includes(w)) return w as HookFamily;
  const lead = keep.find((k) => k.family) ?? [...hooks].filter((h) => h.verdict !== "kill" && h.family).sort((a, b) => (b.pBest ?? 0) - (a.pBest ?? 0))[0];
  return lead?.family ?? null;
}

/* ───────────────────────── explore ───────────────────────── */

interface Ctx {
  plan: PlatformPlan | null;
  promoOk: boolean;
  gifting: boolean;
  trend: Map<string, TrendSlice["hooks"][number]>;
}

/** Creative fit for a NEW generated hook: no AI faces, a deal slam needs a discount, seasonal in season, not saturated. */
function allowed(id: string, c: Ctx): boolean {
  const h = hookById(id);
  if (!h || h.aiFit === "low") return false;
  if (id === "H16" && !c.promoOk) return false;
  if (id === "H24" && !c.gifting) return false;
  return c.trend.get(id)?.status !== "saturated";
}

const trendScore = (c: Ctx, id: string) => {
  const t = c.trend.get(id);
  if (!t) return 0;
  return (t.status === "rising" ? 1 : 0) + t.novelty + (t.share > 0 ? Math.max(-0.5, Math.min(0.5, t.longevityScore / t.share - 1)) : 0);
};
const trendNote = (c: Ctx, id: string) => {
  const t = c.trend.get(id);
  return t && t.status === "rising" ? ` — rising in the category (${t.ads} ads, ${Math.round(t.share * 100)}% share, novelty ${t.novelty})` : "";
};

function exploreFromWinners(family: HookFamily | null, tested: Set<string>, c: Ctx, max: number): ExploreHook[] {
  if (max <= 0) return [];
  const rank = (ids: string[]) =>
    ids
      .filter((id) => !tested.has(id) && allowed(id, c))
      .sort((a, b) => trendScore(c, b) - trendScore(c, a) || Number(hookById(b)!.frameOneProduct) - Number(hookById(a)!.frameOneProduct) || Number(hookById(b)!.aiFit === "high") - Number(hookById(a)!.aiFit === "high") || a.localeCompare(b));
  const rising = rank([...c.trend.values()].filter((t) => t.status === "rising" && hookById(t.hookId)?.family !== family).map((t) => t.hookId));
  const famPool = family ? rank(HOOKS.filter((h) => h.family === family).map((h) => h.id)) : [];
  const famN = rising.length ? Math.max(Math.min(2, max), max - 1) : max;
  const out: ExploreHook[] = famPool.slice(0, famN).map((id) => ({ hookId: id, name: hookById(id)!.name, family: family!, source: "winning_family", reason: `same ${family} family as the winner${trendNote(c, id)}` }));
  for (const id of rising) {
    if (out.length >= max) break;
    if (!out.some((o) => o.hookId === id)) out.push({ hookId: id, name: hookById(id)!.name, family: hookById(id)!.family, source: "trend", reason: `new direction${trendNote(c, id)}` });
  }
  // Thin family and no trends: fill from the family pool.
  for (const id of famPool) if (out.length < Math.min(max, 2) && !out.some((o) => o.hookId === id)) out.push({ hookId: id, name: hookById(id)!.name, family: family!, source: "winning_family", reason: `same ${family} family as the winner` });
  return out;
}

/** No results yet: the plan's hooks (minus saturated / unfit), filled with rising trends of new families, else the library pick. */
function exploreDefault(category: CategoryId | null, platform: PlatformId, c: Ctx, max: number, trends: TrendSlice | null, now: Date): ExploreHook[] {
  if (max <= 0) return [];
  const out: ExploreHook[] = [];
  const add = (id: string, source: ExploreHook["source"], reason: string) => {
    const h = hookById(id);
    if (h && out.length < max && !out.some((o) => o.hookId === id)) out.push({ hookId: id, name: h.name, family: h.family, source, reason });
  };
  for (const v of c.plan?.hookVariants ?? []) if (allowed(v.hookId, c)) add(v.hookId, "plan", `in the campaign plan — round 1 cell${trendNote(c, v.hookId)}`);
  const rising = [...c.trend.values()].filter((t) => t.status === "rising" && allowed(t.hookId, c)).sort((a, b) => b.novelty - a.novelty);
  const fams = () => new Set(out.map((o) => o.family));
  for (const t of rising) if (!fams().has(t.family)) add(t.hookId, "trend", `rising in the category, a family we don't test yet${trendNote(c, t.hookId)}`);
  for (const t of rising) add(t.hookId, "trend", `rising in the category${trendNote(c, t.hookId)}`);
  if (out.length < max) {
    const pick = selectCreative({ category: category ?? "gifts", platform, goal: "cold", runDate: now.toISOString(), bias: trends ? trendBiasFromSlice(trends) : undefined });
    for (const h of pick.hooks) if (!fams().has(h.hook.family) || out.length + 1 >= max) add(h.hook.id, "library", `library pick for ${category ?? "the category"} × ${platform} (${h.why.slice(0, 2).join(", ")})`);
    for (const h of pick.hooks) add(h.hook.id, "library", `library pick for ${category ?? "the category"} × ${platform}`);
  }
  return out;
}

/* ───────────────────────── cutdowns ───────────────────────── */

const ASPECTS_BY_PLATFORM: Record<string, string[]> = { tiktok: [], snapchat: [], meta: ["4:5", "1:1", "9:16"], youtube: ["16:9", "9:16"], pinterest: ["2:3", "9:16"] };
const familyKey = (p: string) => (/tiktok/.test(p) ? "tiktok" : /youtube|google/.test(p) ? "youtube" : /pinterest/.test(p) ? "pinterest" : /snap/.test(p) ? "snapchat" : "meta");

function cutdownsFor(durationSec: number, aspect: string, platform: PlatformId): { durations: number[]; aspects: string[] } {
  const shorter = BATCH_DURATIONS.filter((d) => d < durationSec);
  const durations = shorter.length ? [...new Set([shorter[shorter.length - 1], shorter[0]])] : [];
  const aspects = (ASPECTS_BY_PLATFORM[familyKey(platform)] ?? []).filter((a) => a !== aspect);
  return { durations, aspects };
}

/* ───────────────────────── cost ───────────────────────── */

/** New hook clips priced with the cost model (keyframe + clip + QC); re-edits are $0. */
export function estimateRoundCost(newHooks: string[], opts: { imageModel?: string; videoModel?: string; hookSec?: number; prices?: PriceTable; reEditVariants?: number } = {}): RoundCost {
  const table = opts.prices ?? DEFAULT_PRICES;
  const imageModel = opts.imageModel ?? OPENROUTER_IMAGE_MODEL;
  const videoModel = opts.videoModel ?? OPENROUTER_VIDEO_MODEL;
  const hookSec = opts.hookSec ?? 3;
  const img = imageCostUsd(table, imageModel);
  const vid = videoCostUsd(table, videoModel, hookSec);
  const qc = qcCallUsd(table, null, 1, "expected");
  const per = r4((img.usd ?? 0) + (vid.usd ?? 0) + qc);
  const n = new Set(newHooks).size;
  return {
    unit: "usd",
    reEditVariants: opts.reEditVariants ?? 0,
    reEditUsd: 0,
    newHookClips: n,
    perHookClipUsd: per,
    totalUsd: r4(per * n),
    highUsd: r4(per * n * 2),
    models: { imageModel, videoModel, hookSec },
    sources: [`keyframe: ${img.source}`, `clip (${vid.billedSec} s billed): ${vid.source}`, "QC: one vision call (cost-model token estimate)"],
  };
}

/* ───────────────────────── proposal ───────────────────────── */

export interface NextRoundInput {
  projectId: string;
  learning: ElementLearning | null;
  plan: CampaignPlan | null;
  trends?: TrendSlice | null;
  platform?: string | null;
  category?: CategoryId | null;
  /** For the new hooks' opening copy (scaffold); without it the library recipe is used. */
  brief?: ProductBrief | null;
  now?: Date;
  /** New hooks to explore (default 3; 0 = re-edits only). */
  maxExplore?: number;
  models?: { imageModel?: string; videoModel?: string; hookSec?: number };
  prices?: PriceTable;
}

function hookVariantsFor(ids: string[], input: NextRoundInput, platform: PlatformId, now: Date): HookVariant[] {
  if (!ids.length) return [];
  if (input.brief && Array.isArray(input.brief.sellingPoints)) {
    try {
      const pp = scaffoldPlatformPlan(input.brief, platform, input.plan?.goal ?? "cold", input.plan?.promo, now.toISOString(), { hookIds: ids.slice(0, 3) });
      const got = ids.map((id) => pp.hookVariants.find((v) => v.hookId === id));
      if (got.every(Boolean)) return got as HookVariant[];
    } catch {
      // fall through to the library recipe
    }
  }
  return ids.map((id) => {
    const h = hookById(id)!;
    return { hookId: id, name: h.name, family: h.family, durationSec: h.durationSec[1], openingVisual: `${h.keyframe} ${h.motion}`.slice(0, 420), openingText: "", openingVO: "" };
  });
}

/** Pure: learning + plan + trends → the next round. Never renders, never spends. */
export function proposeNextRound(input: NextRoundInput): NextRoundProposal {
  const now = input.now ?? new Date();
  const pp = planPlatform(input.plan, input.platform ? normalizePlatform(input.platform) : null);
  const platform: PlatformId = pp?.platform ?? normalizePlatform(input.platform || "tiktok");
  const profile = platformProfile(platform);
  const D = pp?.durationSec ?? profile.durationSec.ideal;
  const aspect = pp?.aspect ?? "9:16";
  const cta = pp?.endCard?.button || "Shop now";
  const promo = input.plan?.promo;
  const ctx: Ctx = {
    plan: pp,
    promoOk: !!(promo?.pct || (promo?.comparePrice && promo.price && promo.comparePrice > promo.price)),
    gifting: inGiftingWindow(now.toISOString()),
    trend: new Map((input.trends?.hooks ?? []).map((h) => [h.hookId, h])),
  };
  const notes: string[] = [];
  const maxExplore = Math.max(0, Math.min(MAX_EXPLORE, input.maxExplore ?? MAX_EXPLORE));

  const hookDim = input.learning?.dims.find((d) => d.dim === "hookId");
  const hv = verdicts(hookDim, "hookId");
  const ev = verdicts(input.learning?.dims.find((d) => d.dim === "endCardId"), "endCardId");
  const mode: NextRoundProposal["mode"] = hv.list.length ? "iterate" : "explore";
  const keep = hv.list.filter((v) => v.verdict === "keep");
  const kill = hv.list.filter((v) => v.verdict === "kill");
  const retest = hv.list.filter((v) => v.verdict === "retest");
  const endCards = { keep: ev.list.filter((v) => v.verdict === "keep"), kill: ev.list.filter((v) => v.verdict === "kill"), retest: ev.list.filter((v) => v.verdict === "retest") };

  let family: HookFamily | null = null;
  let explore: ExploreHook[];
  if (mode === "iterate") {
    family = winningFamily(input.learning!, keep, hv.list);
    const tested = new Set([...hv.list.map((v) => v.id), ...(input.plan?.platforms ?? []).flatMap((p) => p.hookVariants.map((h) => h.hookId))]);
    explore = exploreFromWinners(family, tested, ctx, maxExplore);
    if (!keep.length) notes.push(`No hook winner called yet on ${hv.metric ?? "any metric"} — the leaders stay in the test.`);
  } else {
    notes.push("No imported results yet — an exploration round: diverse hooks, one cell each, to find a first winner. Import the Meta / TikTok export after ~3 days.");
    explore = exploreDefault(input.category ?? null, platform, ctx, maxExplore, input.trends ?? null, now);
  }
  if (!input.trends?.hooks.length) notes.push("No competitor trend data for this category — run research + hook-trends to steer exploration.");

  // The batch: winners (+ cutdowns / aspects), re-tests, new hooks; end-card re-tests on the lead hook.
  const bestEnd = endCards.keep[0]?.id ?? (pp?.endCard?.id && !endCards.kill.some((k) => k.id === pp.endCard.id) ? pp.endCard.id : null) ?? "E01";
  const [brand, ...rest] = (input.plan?.productTitle ?? "").split(/\s+/).filter(Boolean);
  const name = (v: Omit<RoundVariant, "name" | "intent" | "needsGeneration">) => batchAdName({ brand, title: rest.join(" "), durationSec: v.durationSec, hook: v.hook, endCard: v.endCard, aspect: v.aspect, voice: DEFAULT_BATCH_VOICE, music: "auto", cta: v.cta });
  const variants: RoundVariant[] = [];
  const push = (hook: string, intent: RoundVariant["intent"], o: Partial<Pick<RoundVariant, "endCard" | "aspect" | "durationSec">> = {}) => {
    const v = { hook, endCard: o.endCard ?? bestEnd, aspect: o.aspect ?? aspect, durationSec: o.durationSec ?? D, cta };
    if (!variants.some((x) => x.hook === v.hook && x.endCard === v.endCard && x.aspect === v.aspect && x.durationSec === v.durationSec)) variants.push({ ...v, name: name(v), intent, needsGeneration: intent === "explore" });
  };
  const cutdowns = keep.map((k) => ({ hookId: k.id, ...cutdownsFor(D, aspect, platform) }));
  for (const k of keep) {
    push(k.id, "keep");
    const c = cutdowns.find((x) => x.hookId === k.id)!;
    for (const d of c.durations) push(k.id, "cutdown", { durationSec: d });
    for (const a of c.aspects) push(k.id, "aspect", { aspect: a });
  }
  for (const r of retest) push(r.id, "retest");
  for (const e of explore) push(e.hookId, "explore");
  const lead = keep[0]?.id ?? retest[0]?.id ?? explore[0]?.hookId;
  if (lead) for (const e of endCards.retest) push(lead, "end_card_retest", { endCard: e.id });

  const newHooks = explore.map((e) => e.hookId);
  const reEdit = variants.filter((v) => !v.needsGeneration).length;
  const cost = estimateRoundCost(newHooks, { ...input.models, prices: input.prices, reEditVariants: reEdit });
  const dims: BatchDims = {
    hooks: [...new Set(variants.map((v) => v.hook))],
    endCards: [...new Set(variants.map((v) => v.endCard))],
    aspects: [...new Set(variants.map((v) => v.aspect))],
    durations: [...new Set(variants.map((v) => v.durationSec))],
    ctas: [cta],
  };
  const killed = [...kill, ...endCards.kill].map((k) => k.id);
  const note = [
    "Proposal only — nothing was rendered and nothing was spent.",
    `Approve to render: ${reEdit} re-edit variant${reEdit === 1 ? "" : "s"} of existing clips ($0)${newHooks.length ? ` + ${newHooks.length} new hook clip${newHooks.length === 1 ? "" : "s"} (${newHooks.join(", ")}) at ~$${cost.perHookClipUsd.toFixed(2)} each = ~$${cost.totalUsd.toFixed(2)} expected, ~$${cost.highUsd.toFixed(2)} with rerolls` : ""}.`,
    `On approval: plan-batch with batch.dims on the winning run, render-batch for the re-edits${newHooks.length ? "; the new hooks need generation (set-budget to cover it, then plan-to-storyboard / compile-run with hookId)" : ""}.`,
    killed.length ? `Pause in Ads Manager: ${killed.join(", ")}.` : "",
  ].filter(Boolean).join(" ");

  return {
    version: 1,
    createdAt: now.toISOString(),
    projectId: input.projectId,
    platform,
    mode,
    decisionMetric: hv.metric,
    winningFamily: family,
    keep,
    kill,
    retest,
    endCards,
    explore,
    cutdowns,
    batch: { dims, design: "pairwise", variants, reEditVariants: reEdit, needsGenerationVariants: variants.length - reEdit, newHooks },
    newHookVariants: hookVariantsFor(newHooks, input, platform, now),
    cost,
    approval: { required: true, note },
    notes,
  };
}

/* ───────────────────────── project entry point ───────────────────────── */

export interface PlanNextRoundOptions {
  platform?: string | null;
  now?: Date;
  maxExplore?: number;
  /** Store on Project.nextRound / nextRoundAt (default true). */
  store?: boolean;
}

/** Load learning, plan and trends; propose; store on Project.nextRound (operator action `next-round`). */
export async function planNextRound(projectId: string, opts: PlanNextRoundOptions = {}): Promise<NextRoundProposal> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, category: true, productBrief: true, campaignPlan: true } });
  if (!project) throw new Error("Project not found");
  const brief = (project.productBrief as ProductBrief | null) ?? null;
  const plan = (project.campaignPlan as CampaignPlan | null) ?? null;
  const category = categoryKey(brief?.category) ?? categoryKey(project.category);
  const platform = opts.platform || plan?.platforms?.[0]?.platform || "tiktok";
  const [learning, trends] = await Promise.all([
    loadElementLearning(projectId, { seed: 1 }).catch(() => null),
    trendSlice(category, platform, { projectId, now: opts.now }).catch(() => null),
  ]);
  const proposal = proposeNextRound({ projectId, learning, plan, trends, platform, category, brief, now: opts.now, maxExplore: opts.maxExplore });
  if (opts.store !== false) await prisma.project.update({ where: { id: projectId }, data: { nextRound: proposal as object, nextRoundAt: new Date() } });
  return proposal;
}
