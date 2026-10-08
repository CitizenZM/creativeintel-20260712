/**
 * Hook trend intelligence — what openings competitors and the category are betting on right now.
 *
 *   toTrendRecords     stored research rows (ContentAsset from the Meta Ad Library / TikTok Creative
 *                      Center adapters, AdTeardown, AdStructure) → one record per ad; a teardown
 *                      replaces its own asset, a structure its teardown.
 *   classifyAds        each opening → H01–H35 + family with the Ad Cloner's rule classifier; only the
 *                      unsure ones go to an optional model, ONE call per batch of ≤ 40.
 *   computeHookTrends  per category × platform × window: share of ads per hook, week-over-week launch
 *                      growth, a longevity-weighted score (ads that keep running are the winners;
 *                      engagement adds when present), novelty (rising and not yet saturated), status.
 *   trendBias          bounded ±2 score adjustments selectCreative can consume; mergeBias puts our own
 *                      performance bias first.
 *   hookTrendReport    the weekly report: rising hooks with example ads, saturated hooks to avoid,
 *                      longevity leaders, recommendations against the current plan.
 *
 * Pure except the loaders (loadTrendAds / trendBias / hookTrendReport) and the default model.
 */
import { z } from "zod";
import { prisma } from "@/lib/db";
import { structureWhereForTenant } from "@/services/structures";
import { tenantOfProject, tenantProjectWhere } from "@/services/tenancy";
import { classifyHookRules, HOOK_TYPE_MAP, SURE } from "@/services/creative/ad-cloner";
import { HOOKS, hookById } from "@/services/creative/library";
import { classifyProduct, SP_CATEGORIES, TO_CREATIVE_CATEGORY, type SpCategory } from "@/services/creative/product-brief";
import type { CategoryId, HookFamily } from "@/services/creative/types";

const DAY = 86_400_000;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const squash = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");
const pct = (n: number) => `${Math.round(n * 100)}%`;

/* ───────────────────────── keys ───────────────────────── */

export type TrendPlatform = "meta" | "tiktok" | "youtube" | "pinterest" | "snapchat" | "other";

/** A stored platform label ("TikTok", "Instagram") or a plan platform id ("instagram_reels") → trend platform. */
export function trendPlatformOf(raw: string | null | undefined): TrendPlatform | null {
  const s = squash(raw).toLowerCase();
  if (!s) return null;
  if (/tiktok|douyin/.test(s)) return "tiktok";
  if (/youtube|shorts|google|\byt\b/.test(s)) return "youtube";
  if (/meta|facebook|instagram|\bfb\b|\big\b|reels|stories/.test(s)) return "meta";
  if (/pinterest/.test(s)) return "pinterest";
  if (/snap/.test(s)) return "snapchat";
  return "other";
}

const CATEGORY_IDS: CategoryId[] = ["electronics", "camera", "auto", "kitchen", "home_air", "beauty", "jewelry", "sports", "home", "food", "health", "gifts", "apps"];

/** A creative category id, an sp-1 category or free text ("TVs", "Air purifiers") → creative category. */
export function categoryKey(raw: string | null | undefined): CategoryId | null {
  const s = squash(raw).toLowerCase();
  if (!s) return null;
  if ((CATEGORY_IDS as string[]).includes(s)) return s as CategoryId;
  if ((SP_CATEGORIES as readonly string[]).includes(s) && s !== "other") return TO_CREATIVE_CATEGORY[s as SpCategory];
  const sp = [s, s.replace(/(\w)s\b/g, "$1")].map(classifyProduct).find((c) => c !== "other");
  if (sp) return TO_CREATIVE_CATEGORY[sp];
  return CATEGORY_IDS.find((c) => s.includes(c.replace("_", " "))) ?? null;
}

/** Every stored spelling that means this creative category (for the cross-project query). */
const spCategoriesOf = (c: CategoryId) => (Object.entries(TO_CREATIVE_CATEGORY) as [SpCategory, CategoryId][]).filter(([sp, v]) => v === c && sp !== "other").map(([sp]) => sp);

/* ───────────────────────── records ───────────────────────── */

export interface TrendAdRecord {
  id: string;
  kind: "ad" | "teardown" | "structure";
  /** The ad's permalink (an example link in the report). */
  url: string | null;
  title: string;
  owner: string | null;
  platform: TrendPlatform;
  category: CategoryId | null;
  hookType: string;
  hookText: string;
  hookVisual: string;
  /** The opening beat when a teardown has one (only beats[0] is read). */
  beats: { visual: string; vo: string; onScreenText: string }[];
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  /** When there are no run dates: publishedAt, else when we stored it. */
  seenAt: Date;
  views: number | null;
  likes: number | null;
  comments: number | null;
  /** Percent, as ContentAsset.engagementRate stores it. */
  engagementRate: number | null;
  ctr: number | null;
}

/** The ContentAsset columns the trend loader reads (a full row fits). */
export interface ContentAssetLike {
  id: string;
  title: string;
  url: string;
  description?: string | null;
  platform?: string | null;
  hookText?: string | null;
  narrativeType?: string | null;
  advertiserName?: string | null;
  competitor?: { name: string } | null;
  viewCount?: number | null;
  likeCount?: number | null;
  commentCount?: number | null;
  engagementRate?: number | null;
  adSpendEstimate?: unknown;
  firstSeenAt?: Date | null;
  lastSeenAt?: Date | null;
  publishedAt?: Date | null;
  createdAt: Date;
}

export interface TeardownLike {
  id: string;
  contentAssetId: string;
  hookType: string;
  hookText: string;
  hookVisual: string;
  beats: unknown;
  createdAt: Date;
  competitor?: { name: string } | null;
  contentAsset?: ContentAssetLike | null;
}

export interface StructureLike {
  id: string;
  sourceTitle: string;
  sourceOwner: string | null;
  sourceUrl: string | null;
  sourceViews: number | null;
  hookType: string | null;
  hookText: string | null;
  beats: unknown;
  sourceTeardownId: string | null;
  createdAt: Date;
}

/** ContentAsset.narrativeType → the teardown hook-type vocabulary (a weak rule feature). */
const NARRATIVE_HOOK_TYPE: Record<string, string> = {
  PROBLEM_SOLUTION: "problem_agitate",
  BEFORE_AFTER: "before_after",
  DEMONSTRATION: "demo_first",
  TESTIMONIAL: "social_proof",
  TREND_RIDING: "trend_native",
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const date = (v: unknown) => (v instanceof Date && !Number.isNaN(v.getTime()) ? v : typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v) : null);
const hookTypeKey = (s: unknown) => squash(s).toLowerCase().replace(/[\s-]+/g, "_");

function openingBeat(beats: unknown): TrendAdRecord["beats"] {
  if (!Array.isArray(beats) || !beats.length) return [];
  const b = (beats as Record<string, unknown>[]).slice().sort((x, y) => (num(x?.startSec) ?? 0) - (num(y?.startSec) ?? 0))[0] ?? {};
  return [{ visual: squash(b.visual), vo: squash(b.vo), onScreenText: squash(b.onScreenText) }];
}

export function recordFromContentAsset(a: ContentAssetLike, category: CategoryId | null): TrendAdRecord {
  const est = (a.adSpendEstimate ?? {}) as Record<string, unknown>;
  // The opening: a stored hook line, else the ad's headline (Meta body / TikTok caption).
  const hookText = squash(a.hookText) || squash(a.title);
  return {
    id: a.id,
    kind: "ad",
    url: a.url || null,
    title: squash(a.title) || "Untitled ad",
    owner: squash(a.competitor?.name) || squash(a.advertiserName) || null,
    platform: trendPlatformOf(a.platform) ?? trendPlatformOf(a.url) ?? "other",
    category,
    hookType: NARRATIVE_HOOK_TYPE[a.narrativeType ?? ""] ?? "",
    hookText,
    hookVisual: "",
    beats: [],
    firstSeenAt: date(a.firstSeenAt) ?? date(est.firstSeen),
    lastSeenAt: date(a.lastSeenAt) ?? date(est.lastSeen),
    seenAt: date(a.publishedAt) ?? a.createdAt,
    views: num(a.viewCount),
    likes: num(a.likeCount),
    comments: num(a.commentCount),
    engagementRate: num(a.engagementRate),
    ctr: num(est.ctr),
  };
}

export function recordFromTeardown(t: TeardownLike, category: CategoryId | null): TrendAdRecord {
  const base = t.contentAsset ? recordFromContentAsset(t.contentAsset, category) : null;
  return {
    ...(base ?? { url: null, title: squash(t.hookText) || "Torn-down ad", platform: "other" as TrendPlatform, firstSeenAt: null, lastSeenAt: null, seenAt: t.createdAt, views: null, likes: null, comments: null, engagementRate: null, ctr: null }),
    id: t.id,
    kind: "teardown",
    owner: squash(t.competitor?.name) || base?.owner || null,
    category,
    hookType: hookTypeKey(t.hookType),
    hookText: squash(t.hookText),
    hookVisual: squash(t.hookVisual),
    beats: openingBeat(t.beats),
  };
}

export function recordFromStructure(s: StructureLike, category: CategoryId | null): TrendAdRecord {
  return {
    id: s.id,
    kind: "structure",
    url: s.sourceUrl,
    title: squash(s.sourceTitle) || "Saved structure",
    owner: s.sourceOwner,
    platform: trendPlatformOf(s.sourceUrl) ?? "other",
    category,
    hookType: hookTypeKey(s.hookType),
    hookText: squash(s.hookText),
    hookVisual: "",
    beats: openingBeat(s.beats),
    firstSeenAt: null,
    lastSeenAt: null,
    seenAt: s.createdAt,
    views: num(s.sourceViews),
    likes: null,
    comments: null,
    engagementRate: null,
    ctr: null,
  };
}

/** All stored rows → one record per ad (a teardown replaces its asset; a structure its teardown). */
export function toTrendRecords(
  rows: { contentAssets?: ContentAssetLike[]; teardowns?: TeardownLike[]; structures?: StructureLike[] },
  category: CategoryId | null
): TrendAdRecord[] {
  const torn = new Set((rows.teardowns ?? []).map((t) => t.contentAssetId));
  const tdIds = new Set((rows.teardowns ?? []).map((t) => t.id));
  const urls = new Set<string>();
  const out: TrendAdRecord[] = [];
  const push = (r: TrendAdRecord) => {
    if (r.url && urls.has(r.url)) return;
    if (r.url) urls.add(r.url);
    out.push(r);
  };
  for (const t of rows.teardowns ?? []) push(recordFromTeardown(t, category));
  for (const a of rows.contentAssets ?? []) if (!torn.has(a.id)) push(recordFromContentAsset(a, category));
  for (const s of rows.structures ?? []) if (!s.sourceTeardownId || !tdIds.has(s.sourceTeardownId)) push(recordFromStructure(s, category));
  return out;
}

/* ───────────────────────── classification ───────────────────────── */

export interface ClassifiedAd extends TrendAdRecord {
  hookId: string;
  family: HookFamily;
  method: "rules" | "llm" | "fallback";
  ruleScore: number;
}

export type BatchHookLlm = (args: { system: string; user: string }) => Promise<unknown>;

export const hookBatchSchema = z.object({ picks: z.array(z.object({ i: z.coerce.number(), hookId: z.string() }).passthrough()).catch([]) }).passthrough();

export const HOOK_BATCH_SIZE = 40;

export function hookBatchPrompts(ads: { i: number; ad: TrendAdRecord }[]): { system: string; user: string } {
  return {
    system: `You map video ads' openings to ONE hook each from a fixed library. Output JSON only: {"picks":[{"i":0,"hookId":"H.."}]} — one pick per ad, hookId from the library.`,
    user: JSON.stringify({
      ads: ads.map(({ i, ad }) => ({ i, hookType: ad.hookType || undefined, text: ad.hookText.slice(0, 200), visual: (ad.hookVisual || ad.beats[0]?.visual || "").slice(0, 200) || undefined })),
      library: HOOKS.map((h) => ({ id: h.id, name: h.name })),
    }),
  };
}

const defaultBatchLlm: BatchHookLlm = async ({ system, user }) => {
  const { analyzeWithClaude } = await import("@/services/ai/claude-client");
  return analyzeWithClaude({ systemPrompt: system, userPrompt: user, responseSchema: hookBatchSchema, maxTokens: 1600 });
};

export interface ClassifyOptions {
  /** Model for the unsure openings: a function (tests), "default" (the app's model) or none (rules only). */
  llm?: BatchHookLlm | "default" | null;
  batchSize?: number;
}

/** Rules (the Ad Cloner's classifier) for every ad; the unsure ones to the model in batches of ≤ 40. */
export async function classifyAds(ads: TrendAdRecord[], opts: ClassifyOptions = {}): Promise<{ classified: ClassifiedAd[]; unclassified: number; llmCalls: number }> {
  const llm = opts.llm === "default" ? defaultBatchLlm : opts.llm ?? null;
  const size = Math.max(1, Math.min(HOOK_BATCH_SIZE, opts.batchSize ?? HOOK_BATCH_SIZE));
  const done = new Map<number, ClassifiedAd>();
  const unsure: { i: number; ad: TrendAdRecord; rules: ReturnType<typeof classifyHookRules> }[] = [];
  const make = (ad: TrendAdRecord, hookId: string, method: ClassifiedAd["method"], ruleScore: number): ClassifiedAd | null => {
    const h = hookById(hookId);
    return h ? { ...ad, hookId: h.id, family: h.family, method, ruleScore } : null;
  };
  ads.forEach((ad, i) => {
    const rules = classifyHookRules({ hookText: ad.hookText, hookVisual: ad.hookVisual, hookType: ad.hookType, beats: ad.beats as never });
    if (rules.score >= SURE) done.set(i, make(ad, rules.hookId, "rules", rules.score)!);
    else unsure.push({ i, ad, rules });
  });
  let llmCalls = 0;
  const picked = new Map<number, string>();
  if (llm) {
    for (let k = 0; k < unsure.length; k += size) {
      const batch = unsure.slice(k, k + size);
      llmCalls++;
      try {
        const raw = await llm(hookBatchPrompts(batch.map((u, j) => ({ i: j, ad: u.ad }))));
        for (const p of hookBatchSchema.parse(raw ?? {}).picks) {
          const u = batch[p.i];
          const id = squash(p.hookId).toUpperCase();
          if (u && hookById(id)) picked.set(u.i, id);
        }
      } catch {
        // keep the rule fallback for this batch
      }
    }
  }
  let unclassified = 0;
  for (const u of unsure) {
    const viaLlm = picked.get(u.i);
    // Fallback as the cloner's: the teardown hook-type map, else the best rule hit; no signal → left out.
    const fb = HOOK_TYPE_MAP[u.ad.hookType] ?? (u.rules.score > 0 ? u.rules.hookId : null);
    const c = viaLlm ? make(u.ad, viaLlm, "llm", u.rules.score) : fb ? make(u.ad, fb, "fallback", u.rules.score) : null;
    if (c) done.set(u.i, c);
    else unclassified++;
  }
  return { classified: [...done.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c), unclassified, llmCalls };
}

/* ───────────────────────── trend metrics ───────────────────────── */

/** A hook used by ≥ this share of active ads (with ≥ 8 ads and 2+ advertisers) is saturated. */
export const SATURATED_SHARE = 0.25;
const MIN_SATURATION_ADS = 8;
/** trendBias needs at least this many active ads in the slice. */
export const MIN_TREND_ADS = 6;

export interface TrendExample {
  title: string;
  url: string | null;
  owner: string | null;
  platform: TrendPlatform;
  runDays: number | null;
}

export type TrendStatus = "rising" | "saturated" | "fading" | "steady";

export interface HookTrend {
  hookId: string;
  name: string;
  family: HookFamily;
  /** Ads active in the window using this hook. */
  ads: number;
  owners: number;
  /** ads ÷ all active ads. */
  share: number;
  /** Longevity- (and engagement-) weighted share: above `share` = these ads keep running. */
  longevityScore: number;
  avgRunDays: number | null;
  launchesThisWeek: number;
  launchesLastWeek: number;
  /** (this week − last week) ÷ max(1, last week), on launches. */
  wowGrowth: number;
  /** Share of the last 14 days' launches − share of the older active base. */
  momentum: number;
  /** 0–1: rising and not yet saturated. */
  novelty: number;
  status: TrendStatus;
  examples: TrendExample[];
}

export interface TrendSlice {
  category: CategoryId | "all";
  platform: TrendPlatform | "all";
  windowDays: number;
  from: string;
  to: string;
  totalAds: number;
  hooks: HookTrend[];
  families: { family: HookFamily; ads: number; share: number }[];
}

export interface TrendWindowOptions {
  now?: Date;
  /** Default 28 days. */
  windowDays?: number;
  category?: CategoryId | null;
  platform?: TrendPlatform | null;
}

/** 0–1 engagement from the signals present (engagement rate, likes+comments per view, CTR). */
function engagement01(a: TrendAdRecord): number | null {
  const sig: number[] = [];
  if (a.engagementRate !== null) sig.push(clamp01(a.engagementRate / 100 / 0.08));
  else if (a.views && a.views > 0 && (a.likes !== null || a.comments !== null)) sig.push(clamp01(((a.likes ?? 0) + (a.comments ?? 0)) / a.views / 0.08));
  if (a.ctr !== null && a.ctr > 0) sig.push(clamp01((a.ctr > 1 ? a.ctr / 100 : a.ctr) / 0.02));
  return sig.length ? Math.max(...sig) : null;
}

export function computeHookTrends(ads: ClassifiedAd[], opts: TrendWindowOptions = {}): TrendSlice {
  const now = (opts.now ?? new Date()).getTime();
  const windowDays = opts.windowDays ?? 28;
  const from = now - windowDays * DAY;
  const span = (a: ClassifiedAd) => {
    const start = (a.firstSeenAt ?? a.seenAt).getTime();
    const end = a.lastSeenAt ? a.lastSeenAt.getTime() : a.firstSeenAt ? now : start;
    return { start, end: Math.min(end, now) };
  };
  const active = ads.filter((a) => {
    const s = span(a);
    return s.start <= now && s.end >= from;
  });
  const runDays = (a: ClassifiedAd) => (a.firstSeenAt ? Math.max(0, (span(a).end - a.firstSeenAt.getTime()) / DAY) : null);
  // Weight: ads that ran long are winners (spend kept being renewed); engagement adds when present.
  const weight = (a: ClassifiedAd) => {
    const d = runDays(a);
    return 1 + 2 * (d === null ? 0.25 : clamp01(d / 60)) + (engagement01(a) ?? 0);
  };
  const by = new Map<string, ClassifiedAd[]>();
  for (const a of active) by.set(a.hookId, [...(by.get(a.hookId) ?? []), a]);
  const total = active.length;
  const totalW = active.reduce((s, a) => s + weight(a), 0);
  const launched = (a: ClassifiedAd, lo: number, hi: number) => {
    const s = span(a).start;
    return s > now - hi * DAY && s <= now - lo * DAY;
  };
  const recentTotal = active.filter((a) => launched(a, 0, 14)).length;
  const priorTotal = total - recentTotal;

  const hooks: HookTrend[] = [...by.entries()].map(([hookId, list]) => {
    const h = hookById(hookId)!;
    const share = list.length / total;
    const longevityScore = totalW ? list.reduce((s, a) => s + weight(a), 0) / totalW : 0;
    const days = list.map(runDays).filter((d): d is number => d !== null);
    const thisWeek = list.filter((a) => launched(a, 0, 7)).length;
    const lastWeek = list.filter((a) => launched(a, 7, 14)).length;
    const recent = list.filter((a) => launched(a, 0, 14)).length;
    const momentum = recentTotal && priorTotal ? recent / recentTotal - (list.length - recent) / priorTotal : 0;
    const owners = new Set(list.map((a) => (a.owner ?? a.id).toLowerCase())).size;
    const saturated = share >= SATURATED_SHARE && total >= MIN_SATURATION_ADS && owners >= 2;
    const novelty = !saturated && momentum > 0 && recent >= 2 ? clamp01(momentum / 0.15) * clamp01(1 - share / (2 * SATURATED_SHARE)) : 0;
    const wowGrowth = (thisWeek - lastWeek) / Math.max(1, lastWeek);
    const status: TrendStatus = saturated ? "saturated" : novelty >= 0.3 || (thisWeek >= 2 && wowGrowth >= 1) ? "rising" : momentum <= -0.1 && thisWeek === 0 ? "fading" : "steady";
    const examples = [...list]
      .sort((a, b) => Number(!!b.url) - Number(!!a.url) || weight(b) - weight(a) || span(b).start - span(a).start)
      .slice(0, 3)
      .map((a) => ({ title: a.title, url: a.url, owner: a.owner, platform: a.platform, runDays: runDays(a) === null ? null : Math.round(runDays(a)!) }));
    return {
      hookId,
      name: h.name,
      family: h.family,
      ads: list.length,
      owners,
      share: r3(share),
      longevityScore: r3(longevityScore),
      avgRunDays: days.length ? Math.round(days.reduce((s, d) => s + d, 0) / days.length) : null,
      launchesThisWeek: thisWeek,
      launchesLastWeek: lastWeek,
      wowGrowth: r2(wowGrowth),
      momentum: r3(momentum),
      novelty: r2(novelty),
      status,
      examples,
    };
  });
  // Exact shares sum to 1; rounding is display only.
  hooks.forEach((x) => (x.share = by.get(x.hookId)!.length / total));
  hooks.sort((a, b) => b.ads - a.ads || b.longevityScore - a.longevityScore || a.hookId.localeCompare(b.hookId));
  const fam = new Map<HookFamily, number>();
  for (const a of active) fam.set(a.family, (fam.get(a.family) ?? 0) + 1);
  return {
    category: opts.category ?? "all",
    platform: opts.platform ?? "all",
    windowDays,
    from: new Date(from).toISOString(),
    to: new Date(now).toISOString(),
    totalAds: total,
    hooks,
    families: [...fam.entries()].map(([family, n]) => ({ family, ads: n, share: r3(n / total) })).sort((a, b) => b.ads - a.ads),
  };
}

/* ───────────────────────── bias ───────────────────────── */

export type Bias = Partial<Record<string, number>>;

/**
 * Bounded (±2) selectCreative adjustments: novelty pulls a hook up (up to +2), longevity above its
 * share adds up to ±1, saturation −1.5, fading −0.5. Nothing below MIN_TREND_ADS active ads.
 */
export function trendBiasFromSlice(slice: TrendSlice, maxWeight = 2): Bias {
  if (slice.totalAds < MIN_TREND_ADS) return {};
  const out: Bias = {};
  for (const h of slice.hooks) {
    const lift = h.share > 0 ? Math.max(-1, Math.min(1, h.longevityScore / h.share - 1)) * Math.min(1, h.ads / 3) : 0;
    const raw = 2 * h.novelty + lift - (h.status === "saturated" ? 1.5 : 0) - (h.status === "fading" ? 0.5 : 0);
    const b = r2(Math.max(-maxWeight, Math.min(maxWeight, raw)));
    if (Math.abs(b) >= 0.05) out[h.hookId] = b;
  }
  return out;
}

/** Performance bias (our own results) wins over trend bias for any id both score; undefined when empty. */
export function mergeBias(performance: Bias | null | undefined, trend: Bias | null | undefined): Bias | undefined {
  const out: Bias = { ...(trend ?? {}) };
  for (const [k, v] of Object.entries(performance ?? {})) if (typeof v === "number") out[k] = v;
  for (const k of Object.keys(out)) if (typeof out[k] !== "number" || !out[k]) delete out[k];
  return Object.keys(out).length ? out : undefined;
}

/* ───────────────────────── loaders ───────────────────────── */

const CA_SELECT = {
  id: true,
  projectId: true,
  title: true,
  url: true,
  description: true,
  platform: true,
  hookText: true,
  narrativeType: true,
  advertiserName: true,
  viewCount: true,
  likeCount: true,
  commentCount: true,
  engagementRate: true,
  adSpendEstimate: true,
  firstSeenAt: true,
  lastSeenAt: true,
  publishedAt: true,
  createdAt: true,
  competitor: { select: { name: true } },
} as const;

/**
 * The category's competitor / category ads: every project in the category (Project.category text or
 * the sp-1 brief's category) plus `projectId` itself — research ad candidates (ContentAsset, not
 * brand-owned, not excluded), their teardowns, and saved structures of the category. Per account: only
 * projects and structures in `projectId`'s tenant (src/services/tenancy.ts) — without a project, the
 * master admin's — so one account's research never feeds another account's plans or reports.
 */
export async function loadTrendAds(opts: { projectId?: string | null; category?: CategoryId | null }): Promise<TrendAdRecord[]> {
  const category = opts.category ?? null;
  const ids = new Set<string>(opts.projectId ? [opts.projectId] : []);
  const tenant = opts.projectId ? ((await tenantOfProject(opts.projectId)) ?? null) : null;
  const inTenant = tenantProjectWhere(tenant);
  if (category) {
    const sp = spCategoriesOf(category);
    const [all, briefed] = await Promise.all([
      prisma.project.findMany({ where: { AND: [{ archivedAt: null }, inTenant] }, select: { id: true, category: true }, take: 1000 }),
      sp.length ? prisma.project.findMany({ where: { AND: [{ archivedAt: null }, inTenant, { OR: sp.map((c) => ({ productBrief: { path: ["category"], equals: c } })) }] }, select: { id: true }, take: 1000 }) : Promise.resolve([]),
    ]);
    for (const p of all ?? []) if (categoryKey(p.category) === category) ids.add(p.id);
    for (const p of briefed ?? []) ids.add(p.id);
  }
  if (!ids.size) return [];
  const projectIds = [...ids];
  const [assets, teardowns, structures] = await Promise.all([
    prisma.contentAsset.findMany({
      where: { projectId: { in: projectIds }, excluded: false, isBrandOwned: false, OR: [{ isPaidMedia: true }, { adSource: { not: null } }, { competitorId: { not: null } }] },
      select: CA_SELECT,
      orderBy: { createdAt: "desc" },
      take: 3000,
    }),
    prisma.adTeardown.findMany({
      where: { projectId: { in: projectIds }, contentAsset: { is: { isBrandOwned: false, excluded: false } } },
      include: { competitor: { select: { name: true } }, contentAsset: { select: CA_SELECT } },
      take: 1000,
    }),
    category ? structureWhereForTenant(tenant).then((where) => prisma.adStructure.findMany({ where, orderBy: { createdAt: "desc" }, take: 300 })) : Promise.resolve([]),
  ]);
  return toTrendRecords(
    {
      contentAssets: assets as unknown as ContentAssetLike[],
      teardowns: teardowns as unknown as TeardownLike[],
      structures: (structures as (StructureLike & { category: string | null })[]).filter((s) => categoryKey(s.category) === category),
    },
    category
  );
}

/**
 * Trend bias for selectCreative (rules only — never a model call). One platform's slice when it has
 * enough ads, else all platforms. {} without data or on any error.
 */
export async function trendBias(category: string | null | undefined, platform?: string | null, opts: { projectId?: string | null; now?: Date; windowDays?: number } = {}): Promise<Bias> {
  try {
    const slice = await trendSlice(category, platform, opts);
    return slice ? trendBiasFromSlice(slice) : {};
  } catch {
    return {};
  }
}

/** The category's trend slice for one platform (all platforms when that one is thin); rules only. Null without a category or project. */
export async function trendSlice(category: string | null | undefined, platform?: string | null, opts: { projectId?: string | null; now?: Date; windowDays?: number } = {}): Promise<TrendSlice | null> {
  const cat = categoryKey(category);
  if (!cat && !opts.projectId) return null;
  const { classified } = await classifyAds(await loadTrendAds({ projectId: opts.projectId, category: cat }));
  const tp = trendPlatformOf(platform);
  const w = { now: opts.now, windowDays: opts.windowDays, category: cat };
  if (tp) {
    const one = computeHookTrends(classified.filter((a) => a.platform === tp), { ...w, platform: tp });
    if (one.totalAds >= MIN_TREND_ADS) return one;
  }
  return computeHookTrends(classified, w);
}

/* ───────────────────────── weekly report ───────────────────────── */

export interface ReportHook {
  hookId: string;
  name: string;
  family: HookFamily;
  platform: TrendPlatform | "all";
  share: number;
  longevityScore: number;
  wowGrowth: number;
  novelty: number;
  avgRunDays: number | null;
  ads: number;
  status: TrendStatus;
  examples: TrendExample[];
}

export interface HookTrendReport {
  version: 1;
  projectId: string;
  generatedAt: string;
  category: CategoryId | null;
  platform: TrendPlatform | "all";
  window: { from: string; to: string; days: number };
  coverage: { ads: number; classified: number; unclassified: number; byMethod: Record<ClassifiedAd["method"], number>; byPlatform: Partial<Record<TrendPlatform, number>>; llmCalls: number };
  rising: ReportHook[];
  saturated: ReportHook[];
  longevityLeaders: ReportHook[];
  slices: TrendSlice[];
  ourPlan: { hookIds: string[] } | null;
  recommendations: string[];
}

const toReportHook = (h: HookTrend, platform: TrendPlatform | "all"): ReportHook => ({
  hookId: h.hookId,
  name: h.name,
  family: h.family,
  platform,
  share: r3(h.share),
  longevityScore: h.longevityScore,
  wowGrowth: h.wowGrowth,
  novelty: h.novelty,
  avgRunDays: h.avgRunDays,
  ads: h.ads,
  status: h.status,
  examples: h.examples,
});

export interface BuildReportInput {
  projectId: string;
  category: CategoryId | null;
  platform: TrendPlatform | "all";
  now?: Date;
  windowDays?: number;
  unclassified: number;
  llmCalls: number;
  /** Hook ids in the project's current campaign plan (for that platform). */
  planHookIds?: string[];
}

/** Pure: classified ads → the weekly report (one slice per platform plus the overall one). */
export function buildHookTrendReport(classified: ClassifiedAd[], input: BuildReportInput): HookTrendReport {
  const now = input.now ?? new Date();
  const w = { now, windowDays: input.windowDays, category: input.category };
  const platforms = [...new Set(classified.map((a) => a.platform))].sort();
  const slices: TrendSlice[] =
    input.platform === "all"
      ? [computeHookTrends(classified, w), ...platforms.map((p) => computeHookTrends(classified.filter((a) => a.platform === p), { ...w, platform: p }))]
      : [computeHookTrends(classified.filter((a) => a.platform === input.platform), { ...w, platform: input.platform })];
  const main = slices[0];
  // Rising / saturated per platform when platforms differ (a hook rising on TikTok can be stale on Meta).
  const scoped = input.platform === "all" && slices.length > 1 ? slices.slice(1) : [main];
  const pick = (f: (h: HookTrend) => boolean, sort: (a: HookTrend, b: HookTrend) => number, n: number) =>
    scoped
      .flatMap((s) => s.hooks.filter(f).map((h) => ({ h, p: s.platform })))
      .sort((a, b) => sort(a.h, b.h))
      .slice(0, n)
      .map(({ h, p }) => toReportHook(h, p));
  const rising = pick((h) => h.status === "rising", (a, b) => b.novelty - a.novelty || b.wowGrowth - a.wowGrowth, 5);
  const saturated = pick((h) => h.status === "saturated", (a, b) => b.share - a.share, 5);
  const lift = (h: HookTrend) => (h.share ? h.longevityScore / h.share : 0);
  const longevityLeaders = main.hooks
    .filter((h) => h.ads >= 2 && h.avgRunDays !== null && lift(h) > 1.1)
    .sort((a, b) => lift(b) - lift(a))
    .slice(0, 3)
    .map((h) => toReportHook(h, main.platform));

  const byMethod = { rules: 0, llm: 0, fallback: 0 };
  const byPlatform: Partial<Record<TrendPlatform, number>> = {};
  for (const a of classified) {
    byMethod[a.method]++;
    byPlatform[a.platform] = (byPlatform[a.platform] ?? 0) + 1;
  }

  const recs: string[] = [];
  const plan = new Set(input.planHookIds ?? []);
  const where = (p: TrendPlatform | "all") => (p === "all" ? "category" : p);
  if (!classified.length || main.totalAds === 0) {
    recs.push("No competitor or category ads in the window — run competitor research (Meta Ad Library / TikTok Creative Center) first, then re-run hook-trends.");
  } else {
    if (main.totalAds < MIN_TREND_ADS) recs.push(`Only ${main.totalAds} ads in the last ${main.windowDays} days — treat these trends as directional and widen research.`);
    for (const r of rising.slice(0, 3)) {
      const ex = r.examples.find((e) => e.url);
      recs.push(
        `${plan.has(r.hookId) ? "Keep" : "Test"} ${r.hookId} ${r.name} on ${where(r.platform)}: rising (${r.ads} ads, ${pct(r.share)} share, ${r.wowGrowth > 0 ? `+${Math.round(r.wowGrowth * 100)}%` : "flat"} launches week over week) and not yet saturated${plan.has(r.hookId) ? " — already in our plan" : " — get in before the feed fills up"}${ex ? `. Example: ${ex.url}` : ""}`
      );
    }
    for (const s of saturated.slice(0, 3)) {
      recs.push(`Avoid leading with ${s.hookId} ${s.name} on ${where(s.platform)}: saturated (${pct(s.share)} of ads use it) — the feed is numb to it; use it later in the body, or flip it.`);
    }
    for (const l of longevityLeaders.slice(0, 2)) {
      recs.push(`Borrow ${l.hookId} ${l.name}: its ads keep running (${l.avgRunDays} days on average, longevity score ${pct(l.longevityScore)} vs ${pct(l.share)} share) — competitors keep paying for it, so it converts.`);
    }
    const satIds = new Set(saturated.map((s) => s.hookId));
    const lead = input.planHookIds?.[0];
    if (lead && satIds.has(lead)) recs.push(`Our plan leads with ${lead} ${hookById(lead)?.name ?? ""}, which is saturated — swap the lead hook for ${rising[0]?.hookId ?? "a rising hook"} (re-run plan-campaign; trend bias does this automatically).`);
    const missing = rising.filter((r) => !plan.has(r.hookId)).map((r) => r.hookId);
    if (plan.size && missing.length) recs.push(`Rising hooks not in our plan yet: ${[...new Set(missing)].join(", ")} — add them to the next test round (next-round).`);
  }

  return {
    version: 1,
    projectId: input.projectId,
    generatedAt: now.toISOString(),
    category: input.category,
    platform: input.platform,
    window: { from: main.from, to: main.to, days: main.windowDays },
    coverage: { ads: classified.length + input.unclassified, classified: classified.length, unclassified: input.unclassified, byMethod, byPlatform, llmCalls: input.llmCalls },
    rising,
    saturated,
    longevityLeaders,
    slices,
    ourPlan: input.planHookIds ? { hookIds: input.planHookIds } : null,
    recommendations: recs,
  };
}

export interface ReportOptions {
  category?: string | null;
  platform?: string | null;
  now?: Date;
  windowDays?: number;
  /** Unsure openings to a model (one call per ≤ 40). Default off: rules + fallback only. */
  llm?: BatchHookLlm | "default" | null;
}

/** The weekly hook-trend report for a project's category (operator action `hook-trends`). */
export async function hookTrendReport(projectId: string, opts: ReportOptions = {}): Promise<HookTrendReport> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, category: true, productBrief: true, campaignPlan: true } });
  if (!project) throw new Error("Project not found");
  const brief = project.productBrief as { category?: string } | null;
  const category = categoryKey(opts.category) ?? categoryKey(brief?.category) ?? categoryKey(project.category);
  const platform = trendPlatformOf(opts.platform) ?? "all";
  const records = await loadTrendAds({ projectId, category });
  const { classified, unclassified, llmCalls } = await classifyAds(records, { llm: opts.llm });
  const plan = project.campaignPlan as { platforms?: { platform: string; hookVariants?: { hookId: string }[] }[] } | null;
  const planHookIds = Array.isArray(plan?.platforms)
    ? [...new Set(plan!.platforms.filter((p) => platform === "all" || trendPlatformOf(p.platform) === platform).flatMap((p) => (p.hookVariants ?? []).map((h) => h.hookId)))]
    : undefined;
  return buildHookTrendReport(classified, { projectId, category, platform, now: opts.now, windowDays: opts.windowDays, unclassified, llmCalls, planHookIds });
}
