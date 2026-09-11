/**
 * Hard gates + per-owner ranking for AdCandidates.
 *
 * Gates run in a fixed order (audit §4): paid evidence → UGC lexicon →
 * format → platform → per-platform performance floor. Ad-library sourced
 * candidates are exempt from the performance floor because those sources
 * publish no view counts — their longevity carries the signal instead.
 *
 * Ranking is partitioned by owner (brand, then each competitor) so a loud
 * brand can never crowd a competitor out of its own Top-N.
 */
import type { AdCandidate, AdSource } from "./ad-candidate";
import type { CampaignPlatform } from "@/lib/campaign-platform";

export const TOP_N_PER_COMPETITOR = Math.max(
  1,
  Number(process.env.TOP_N_PER_COMPETITOR ?? 10)
);

/** Sources whose presence in a public ad library is itself proof of paid spend. */
const AD_LIBRARY_SOURCES = new Set<AdSource>([
  "meta_ad_library",
  "tiktok_ad_library",
  "tiktok_cc",
  "google_ats",
]);

export function isAdLibrarySource(source: AdSource): boolean {
  return AD_LIBRARY_SOURCES.has(source);
}

/** Creator-content vocabulary — a strong signal this is a review, not an ad. */
const UGC_LEXICON = [
  "review",
  "honest opinion",
  "unboxing",
  "unbox",
  "haul",
  " vs ",
  " vs. ",
  "comparison",
  "first impressions",
  "i bought",
  "i tried",
  "testing ",
  "reaction",
  "reacts to",
  "tier list",
  "worth it?",
  "is it worth",
  "pros and cons",
  "after 1 year",
  "after a month",
  "don't buy",
  "dont buy",
  "scam",
  "tutorial",
  "how to use",
];

const AD_CONFIDENCE_FLOOR = 0.75;

/** Minimum views before an organic (non-ad-library) candidate is credible. */
const PERFORMANCE_FLOOR: Record<string, number> = {
  youtube: 5000,
  youtube_short: 5000,
  tiktok: 10000,
  instagram: 5000,
  vimeo: 0,
  facebook: 0,
  google: 0,
};

export type RejectReason =
  | "not_paid"
  | "ugc_lexicon"
  | "format"
  | "platform"
  | "performance_floor";

export interface GateResult {
  passed: AdCandidate[];
  rejected: { candidate: AdCandidate; reason: RejectReason; detail: string }[];
}

export interface GateOptions {
  campaign: CampaignPlatform | null;
  /** Skip the platform gate (used by search-more, which scopes queries itself). */
  skipPlatformGate?: boolean;
}

function hasUgcLexicon(c: AdCandidate): boolean {
  const text = ` ${(c.title || "").toLowerCase()} ${(c.description || "").slice(0, 400).toLowerCase()} `;
  return UGC_LEXICON.some((term) => text.includes(term));
}

/** Runs the five hard gates in the audit's order and reports why each drop happened. */
export function gateCandidates(
  candidates: AdCandidate[],
  opts: GateOptions
): GateResult {
  const campaign = opts.campaign;
  const passed: AdCandidate[] = [];
  const rejected: GateResult["rejected"] = [];
  const allowedPlatforms = campaign ? new Set(campaign.adPlatforms) : null;

  for (const c of candidates) {
    const fromAdLibrary = isAdLibrarySource(c.source) || c.adEvidence === "ad_library";

    // 1. Paid evidence, or a classifier confident enough to stand in for it.
    const classifierOk = (c.adConfidence ?? 0) >= AD_CONFIDENCE_FLOOR;
    if (!c.isPaidAd && !classifierOk) {
      rejected.push({
        candidate: c,
        reason: "not_paid",
        detail: `no paid evidence (adConfidence ${(c.adConfidence ?? 0).toFixed(2)})`,
      });
      continue;
    }

    // 2. UGC vocabulary rejects unless a public ad library vouches for it.
    if (!fromAdLibrary && hasUgcLexicon(c)) {
      rejected.push({
        candidate: c,
        reason: "ugc_lexicon",
        detail: "creator-review vocabulary without ad-library evidence",
      });
      continue;
    }

    // 3. Format gate from the campaign. Unknown duration passes (penalized in score).
    const gate = campaign?.formatGate;
    if (gate) {
      const d = c.durationSec;
      if (d !== undefined && gate.maxDurationSec !== undefined && d > gate.maxDurationSec) {
        rejected.push({
          candidate: c,
          reason: "format",
          detail: `${Math.round(d)}s exceeds ${gate.maxDurationSec}s`,
        });
        continue;
      }
      if (d !== undefined && gate.minDurationSec !== undefined && d < gate.minDurationSec) {
        rejected.push({
          candidate: c,
          reason: "format",
          detail: `${Math.round(d)}s below ${gate.minDurationSec}s`,
        });
        continue;
      }
      if (gate.aspects && c.aspect && !gate.aspects.includes(c.aspect)) {
        rejected.push({
          candidate: c,
          reason: "format",
          detail: `aspect ${c.aspect} not in ${gate.aspects.join("/")}`,
        });
        continue;
      }
    }

    // 4. Platform gate — applied here, not as a post-hoc filter on a pool that
    //    the dispatcher never populated with the right platforms.
    if (!opts.skipPlatformGate && allowedPlatforms && !allowedPlatforms.has(c.platform)) {
      rejected.push({
        candidate: c,
        reason: "platform",
        detail: `${c.platform} not in campaign platforms`,
      });
      continue;
    }

    // 5. Per-platform performance floor; ad-library sources are exempt.
    if (!fromAdLibrary) {
      const floor = PERFORMANCE_FLOOR[c.platform] ?? 0;
      const views = c.metrics.views ?? 0;
      if (floor > 0 && views > 0 && views < floor) {
        rejected.push({
          candidate: c,
          reason: "performance_floor",
          detail: `${views} views below ${floor}`,
        });
        continue;
      }
    }

    passed.push(c);
  }

  return { passed, rejected };
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

export interface ScoreParts {
  reach: number;
  longevity: number;
  engagement: number;
  recency: number;
  creative: number;
  /** Multiplier < 1 when duration or aspect is unknown (format-gate penalty). */
  unknownFormatPenalty: number;
}

export interface RankedCandidate extends AdCandidate {
  score: number;
  scoreParts: ScoreParts;
  rankInOwner: number;
  whyRanked: string;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

function reachScore(c: AdCandidate): number {
  const raw = c.metrics.views ?? c.metrics.impressionsLower ?? 0;
  if (raw <= 0) return 0;
  return clamp01(Math.log10(raw + 1) / 7);
}

function longevityScore(c: AdCandidate): number {
  const start = c.firstSeen ? Date.parse(c.firstSeen) : NaN;
  if (Number.isNaN(start)) return 0;
  const endRaw = c.lastSeen ? Date.parse(c.lastSeen) : NaN;
  const end = Number.isNaN(endRaw) ? Date.now() : endRaw;
  const days = (end - start) / 86_400_000;
  return clamp01(days / 90);
}

function engagementScore(c: AdCandidate): number {
  const views = c.metrics.views ?? 0;
  if (views <= 0 || c.metricsEstimated) return 0;
  const rate = ((c.metrics.likes ?? 0) + (c.metrics.comments ?? 0)) / views;
  return clamp01(rate / 0.1);
}

function recencyScore(c: AdCandidate): number {
  const ref = c.lastSeen ?? c.publishedAt ?? c.firstSeen;
  const ts = ref ? Date.parse(ref) : NaN;
  if (Number.isNaN(ts)) return 0.3;
  const ageDays = (Date.now() - ts) / 86_400_000;
  return clamp01(1 - ageDays / 365);
}

export function scoreCandidate(c: AdCandidate): { score: number; parts: ScoreParts } {
  const reach = reachScore(c);
  const longevity = longevityScore(c);
  const engagement = engagementScore(c);
  const recency = recencyScore(c);
  // No creative teardown exists yet at ranking time, so ad confidence stands in.
  const creative = clamp01(c.adConfidence ?? (isAdLibrarySource(c.source) ? 0.9 : 0.5));
  const unknownFormatPenalty =
    c.durationSec === undefined && c.aspect === undefined ? 0.9 : 1;

  const score =
    (0.3 * reach + 0.25 * longevity + 0.2 * engagement + 0.15 * recency + 0.1 * creative) *
    unknownFormatPenalty;

  return {
    score,
    parts: { reach, longevity, engagement, recency, creative, unknownFormatPenalty },
  };
}

function explain(c: AdCandidate, parts: ScoreParts, score: number): string {
  const bits: string[] = [];
  const reach = c.metrics.views ?? c.metrics.impressionsLower;
  if (reach) bits.push(`${reach.toLocaleString()} ${c.metrics.views ? "views" : "impressions (lower bound)"}`);
  if (parts.longevity > 0) bits.push(`ran ~${Math.round(parts.longevity * 90)}d`);
  if (parts.engagement > 0) bits.push(`${(parts.engagement * 10).toFixed(1)}% engagement`);
  bits.push(`evidence: ${c.adEvidence}`);
  if (parts.unknownFormatPenalty < 1) bits.push("unknown duration/aspect (-10%)");
  return `Score ${score.toFixed(3)} — ${bits.join(", ")}`;
}

// ─── Partitioned ranking ─────────────────────────────────────────────────────

export const BRAND_OWNER_KEY = "__brand__";
/** Brand-agnostic feeds (e.g. TikTok CC for_you) are kept but never ranked per owner. */
export const UNOWNED_KEY = "__unowned__";

export function ownerKeyOf(c: AdCandidate): string {
  return c.competitorId ?? BRAND_OWNER_KEY;
}

export interface RankOptions {
  topN?: number;
  /** competitorIds that own a partition; anything else falls into UNOWNED_KEY. */
  knownOwnerIds?: Set<string>;
}

/**
 * Rank candidates within each owner partition and take Top-N per owner.
 * Returns a map keyed by BRAND_OWNER_KEY or competitorId.
 */
export function rankByOwner(
  candidates: AdCandidate[],
  opts: RankOptions = {}
): Map<string, RankedCandidate[]> {
  const topN = opts.topN ?? TOP_N_PER_COMPETITOR;
  const buckets = new Map<string, AdCandidate[]>();

  for (const c of candidates) {
    const key = ownerKeyOf(c);
    const resolved =
      key === BRAND_OWNER_KEY || !opts.knownOwnerIds || opts.knownOwnerIds.has(key)
        ? key
        : UNOWNED_KEY;
    const list = buckets.get(resolved);
    if (list) list.push(c);
    else buckets.set(resolved, [c]);
  }

  const out = new Map<string, RankedCandidate[]>();
  for (const [key, list] of buckets) {
    const scored = list
      .map((c) => {
        const { score, parts } = scoreCandidate(c);
        return { c, score, parts };
      })
      .sort((a, b) => b.score - a.score);

    out.set(
      key,
      scored.slice(0, topN).map((s, i) => ({
        ...s.c,
        score: s.score,
        scoreParts: s.parts,
        rankInOwner: i + 1,
        whyRanked: explain(s.c, s.parts, s.score),
      }))
    );
  }
  return out;
}
