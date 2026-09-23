/**
 * Ad-vs-UGC classification for AdCandidates.
 *
 * The old verifier asked "is this relevant marketing/ad/brand content?", which
 * a creator review passes trivially (audit §2c). It now asks the discriminating
 * question — "is this a brand-PAID advertisement rather than a creator
 * review/UGC?" — and returns a confidence the hard gates can threshold on.
 *
 * Candidates that already carry ad-library evidence skip the LLM entirely; a
 * cheap regex pre-filter drops the obviously-irrelevant before spending tokens.
 */
import { z } from "zod";
import { analyzeWithClaude } from "@/services/ai/claude-client";
import type { AdCandidate } from "./ad-candidate";
import type { SearchKeywords } from "./keyword-extractor";
import { isAdLibrarySource } from "./ranking";

export interface RelevanceContext {
  brandName: string;
  productName?: string;
  keywords: SearchKeywords;
}

// ─── Cheap deterministic pre-filter ──────────────────────────────────────────

const EXCLUDE_HARD = [
  "reaction",
  "tutorial how to download",
  "free download mod",
  "full movie",
  "lyrics",
];

const AD_INTENT = /\b(ad|ads|advert|advertisement|commercial|campaign|spot|tvc|sponsored|promo)\b/;

/**
 * Deterministic 0..1 relevance from title/description/channel against the brand
 * context. Returns -1 to signal a HARD reject (excluded term / wrong brand).
 */
export function scoreRelevance(c: AdCandidate, ctx: RelevanceContext): number {
  const brand = ctx.brandName.toLowerCase();
  const title = (c.title || "").toLowerCase();
  const desc = (c.description || "").toLowerCase();
  const channel = (c.channelTitle || c.advertiserName || "").toLowerCase();
  const text = `${title} ${desc}`;
  const bc = ctx.keywords.brandContext;

  for (const term of bc?.notRelatedTo ?? []) {
    if (term && text.includes(term.toLowerCase())) return -1;
  }
  for (const term of EXCLUDE_HARD) {
    if (text.includes(term)) return -1;
  }

  let score = 0;
  if (title.includes(brand)) score += 0.4;
  else if (desc.includes(brand)) score += 0.2;
  if (channel.includes(brand)) score += 0.25; // likely the official account

  if (ctx.productName) {
    const p = ctx.productName.toLowerCase();
    if (title.includes(p)) score += 0.2;
    else if (desc.includes(p)) score += 0.1;
  }

  const disambig = bc?.disambiguationKeywords ?? [];
  const cats = ctx.keywords.categoryKeywords ?? [];
  const prods = ctx.keywords.productKeywords ?? [];
  const kwHits = [...disambig, ...cats, ...prods].filter(
    (kw) => kw && text.includes(kw.toLowerCase())
  ).length;
  score += Math.min(0.3, kwHits * 0.1);

  if (AD_INTENT.test(text)) score += 0.1;

  return Math.max(0, Math.min(1, score));
}

// ─── LLM ad classifier ───────────────────────────────────────────────────────

const adVerdictSchema = z.object({
  verdicts: z.array(
    z.object({
      index: z.coerce.number(),
      isAd: z.boolean(),
      adConfidence: z.coerce.number().min(0).max(1),
      advertiserGuess: z.string().optional().default(""),
      reason: z.string().optional().default(""),
    })
  ),
});

export interface AdVerdict {
  isAd: boolean;
  adConfidence: number;
  advertiserGuess: string;
  reason: string;
}

export type AdClassifier = (
  candidates: AdCandidate[],
  ctx: RelevanceContext
) => Promise<AdVerdict[]>;

/**
 * Batched classifier — one verdict per input candidate, index-aligned.
 * Throws when the LLM is unavailable so the caller can degrade deterministically
 * instead of silently rejecting every candidate.
 */
export const llmAdClassifier: AdClassifier = async (candidates, ctx) => {
  if (candidates.length === 0) return [];
  const bc = ctx.keywords.brandContext;
  const list = candidates
    .map(
      (c, i) =>
        `${i}. [${c.platform}${c.durationSec ? ` ${Math.round(c.durationSec)}s` : ""}] "${c.title}" — by: ${c.channelTitle || c.advertiserName || "unknown"} — ${(c.description || "").slice(0, 200)}`
    )
    .join("\n");

  const system = `You classify short video creatives. For each candidate decide ONE thing: is this a BRAND-PAID ADVERTISEMENT (produced or commissioned by the brand and run as paid media — TV/YouTube pre-roll, in-feed social ad, branded spot, official product film) rather than creator-made organic content (review, unboxing, haul, comparison, reaction, tutorial, news coverage, fan edit)?

An influencer post is only an ad when it is clearly a paid brand partnership for THIS brand. A video published on the brand's own official channel that reads as advertising counts as an ad. Anything about a different brand or a homonym is NOT an ad for this brand — return isAd=false with a low confidence.`;

  const user = `Brand: "${ctx.brandName}"${ctx.productName ? ` — product: ${ctx.productName}` : ""}
Business: ${bc?.businessType ?? "?"} / ${bc?.industry ?? "?"}
This brand IS about: ${(bc?.disambiguationKeywords ?? []).join(", ") || "(n/a)"}
This brand is NOT: ${(bc?.notRelatedTo ?? []).join(", ") || "(n/a)"}

Return JSON: {"verdicts":[{"index":0,"isAd":true,"adConfidence":0.0-1.0,"advertiserGuess":"who paid for it","reason":"short"}]}
adConfidence is your confidence that it IS a brand-paid ad. Be strict — a review that praises the product is still not an ad.

Candidates:
${list}`;

  const res = await analyzeWithClaude({
    systemPrompt: system,
    userPrompt: user,
    responseSchema: adVerdictSchema,
    maxTokens: Math.min(4000, 600 + candidates.length * 120),
    tier: "fast",
  }).catch((err) => {
    throw new Error(
      `Ad classification unavailable: ${err instanceof Error ? err.message : String(err)}`
    );
  });

  const byIndex = new Map(res.verdicts.map((v) => [v.index, v]));
  return candidates.map((_, i) => {
    const v = byIndex.get(i);
    return {
      isAd: v?.isAd ?? false,
      adConfidence: v?.adConfidence ?? 0,
      advertiserGuess: v?.advertiserGuess ?? "",
      reason: v?.reason ?? "no verdict",
    };
  });
};

// ─── Classification pass ─────────────────────────────────────────────────────

export interface ClassifyOptions {
  minRelevance?: number;
  classifier?: AdClassifier;
  /** Cap on how many candidates are sent to the LLM in one run. */
  maxToClassify?: number;
}

export interface ClassifyResult {
  candidates: AdCandidate[];
  /** True when the LLM was unavailable and deterministic scoring stood in. */
  degraded: boolean;
  classifiedCount: number;
}

/**
 * Annotate candidates with `isPaidAd` / `adEvidence` / `adConfidence`.
 * Ad-library candidates pass through untouched; the rest are pre-filtered on
 * deterministic relevance, then classified in one batched LLM call.
 */
export async function classifyAdCandidates(
  candidates: AdCandidate[],
  ctx: RelevanceContext,
  opts: ClassifyOptions = {}
): Promise<ClassifyResult> {
  const classifier = opts.classifier ?? llmAdClassifier;
  const { fromLibrary, batch } = prepareForClassification(candidates, ctx, opts);

  let verdicts: AdVerdict[] | null;
  try {
    verdicts = await classifier(batch, ctx);
  } catch {
    verdicts = null;
  }

  return {
    candidates: [...fromLibrary, ...applyVerdicts(batch, verdicts)],
    degraded: verdicts === null,
    classifiedCount: batch.length,
  };
}

/** Split ad-library candidates (already known ads) from the relevance-filtered rest. */
function prepareForClassification(candidates: AdCandidate[], ctx: RelevanceContext, opts: ClassifyOptions) {
  const minRelevance = opts.minRelevance ?? 0.3;
  const maxToClassify = opts.maxToClassify ?? 40;
  const fromLibrary: AdCandidate[] = [];
  const needsClassification: AdCandidate[] = [];

  for (const c of candidates) {
    if (isAdLibrarySource(c.source) || c.adEvidence === "ad_library") {
      fromLibrary.push({ ...c, isPaidAd: true, adConfidence: c.adConfidence ?? 1 });
      continue;
    }
    const rel = scoreRelevance(c, ctx);
    if (rel < 0 || rel < minRelevance) continue;
    needsClassification.push({ ...c, adConfidence: rel });
  }

  const batch = needsClassification
    .sort((a, b) => (b.adConfidence ?? 0) - (a.adConfidence ?? 0))
    .slice(0, maxToClassify);
  return { fromLibrary, batch };
}

/** Verdicts (index-aligned) onto candidates; null = LLM unavailable, use the deterministic fallback. */
function applyVerdicts(batch: AdCandidate[], verdicts: AdVerdict[] | null): AdCandidate[] {
  const degraded = verdicts === null;
  return batch.map((c, i) => {
    if (degraded) {
      // Deterministic fallback: only a strong ad-intent signal counts as paid.
      const text = `${c.title} ${c.description ?? ""}`.toLowerCase();
      const looksLikeAd = AD_INTENT.test(text) && (c.adConfidence ?? 0) >= 0.5;
      return {
        ...c,
        isPaidAd: looksLikeAd,
        adEvidence: looksLikeAd ? ("classifier" as const) : ("none" as const),
        adConfidence: looksLikeAd ? 0.75 : (c.adConfidence ?? 0) * 0.5,
      };
    }
    const v = verdicts[i];
    return {
      ...c,
      isPaidAd: v.isAd,
      adEvidence: v.isAd ? ("classifier" as const) : ("none" as const),
      adConfidence: v.adConfidence,
      advertiserName: v.advertiserGuess || c.advertiserName,
    };
  });
}

// ─── Shared multi-brand batch ───────────────────────────────────────────────────────────

export interface ClassifyGroup {
  key: string;
  candidates: AdCandidate[];
  ctx: RelevanceContext;
}

/** Candidates per LLM call in the shared batch — keeps output well under the token cap. */
const SHARED_CHUNK = 40;

/**
 * Classify every owner's candidates together: one prompt names all the
 * brands and tags each candidate with the brand it was found for, so the
 * system prompt and business context are paid once per chunk instead of
 * once per competitor.
 */
export async function classifyAdCandidateGroups(
  groups: ClassifyGroup[],
  opts: ClassifyOptions & { chunkSize?: number } = {}
): Promise<{ byKey: Map<string, AdCandidate[]>; degraded: boolean; classifiedCount: number; calls: number }> {
  const prepared = groups.map((g) => ({ group: g, ...prepareForClassification(g.candidates, g.ctx, opts) }));
  const flat = prepared.flatMap((p, gi) => p.batch.map((c) => ({ gi, c })));
  const verdicts: (AdVerdict | null)[] = new Array(flat.length).fill(null);
  const chunkSize = opts.chunkSize ?? SHARED_CHUNK;
  let degraded = false;
  let calls = 0;

  for (let start = 0; start < flat.length; start += chunkSize) {
    const chunk = flat.slice(start, start + chunkSize);
    calls += 1;
    try {
      const out = await llmMultiBrandClassifier(
        chunk.map((x) => ({ candidate: x.c, brand: prepared[x.gi].group.ctx })),
        prepared.map((p) => p.group.ctx)
      );
      out.forEach((v, i) => (verdicts[start + i] = v));
    } catch {
      degraded = true;
    }
  }

  const byKey = new Map<string, AdCandidate[]>();
  let cursor = 0;
  prepared.forEach((p) => {
    const mine = verdicts.slice(cursor, cursor + p.batch.length);
    cursor += p.batch.length;
    // A chunk that failed falls back to deterministic scoring for its items only.
    const classified = p.batch.map((c, i) => applyVerdicts([c], mine[i] ? [mine[i]!] : null)[0]);
    byKey.set(p.group.key, [...p.fromLibrary, ...classified]);
  });

  return { byKey, degraded, classifiedCount: flat.length, calls };
}

async function llmMultiBrandClassifier(
  items: { candidate: AdCandidate; brand: RelevanceContext }[],
  brands: RelevanceContext[]
): Promise<AdVerdict[]> {
  if (items.length === 0) return [];
  const bc = brands[0]?.keywords.brandContext;
  const brandIndex = new Map(brands.map((b, i) => [b.brandName, i]));
  const brandList = brands
    .map((b, i) => `B${i}. "${b.brandName}"${b.productName ? ` — product: ${b.productName}` : ""}`)
    .join("\n");
  const list = items
    .map(({ candidate: c, brand }, i) => {
      const b = brandIndex.get(brand.brandName) ?? 0;
      return `${i}. {B${b}} [${c.platform}${c.durationSec ? ` ${Math.round(c.durationSec)}s` : ""}] "${c.title}" — by: ${c.channelTitle || c.advertiserName || "unknown"} — ${(c.description || "").slice(0, 200)}`;
    })
    .join("\n");

  const system = `You classify short video creatives. Each candidate is tagged {B#} with the brand it was found for. For each, decide ONE thing: is it a BRAND-PAID ADVERTISEMENT for THAT tagged brand (produced or commissioned by the brand and run as paid media — TV/YouTube pre-roll, in-feed social ad, branded spot, official product film) rather than creator-made organic content (review, unboxing, haul, comparison, reaction, tutorial, news coverage, fan edit)?

An influencer post is only an ad when it is clearly a paid partnership for the tagged brand. A video on that brand's own official channel that reads as advertising counts as an ad. Anything about a different brand, another brand in this list, or a homonym is NOT an ad for the tagged brand — return isAd=false with a low confidence.`;

  const user = `Brands (all in the same market):
${brandList}
Market: ${bc?.businessType ?? "?"} / ${bc?.industry ?? "?"}
The market IS about: ${(bc?.disambiguationKeywords ?? []).join(", ") || "(n/a)"}
The market is NOT: ${(bc?.notRelatedTo ?? []).join(", ") || "(n/a)"}

Return JSON: {"verdicts":[{"index":0,"isAd":true,"adConfidence":0.0-1.0,"advertiserGuess":"who paid for it","reason":"short"}]}
One verdict per candidate index. Be strict — a review that praises the product is still not an ad.

Candidates:
${list}`;

  const res = await analyzeWithClaude({
    systemPrompt: system,
    userPrompt: user,
    responseSchema: adVerdictSchema,
    maxTokens: Math.min(6000, 600 + items.length * 120),
    tier: "fast",
  });

  const byIndex = new Map(res.verdicts.map((v) => [v.index, v]));
  return items.map((_, i) => {
    const v = byIndex.get(i);
    return {
      isAd: v?.isAd ?? false,
      adConfidence: v?.adConfidence ?? 0,
      advertiserGuess: v?.advertiserGuess ?? "",
      reason: v?.reason ?? "no verdict",
    };
  });
}
