/**
 * briefLite — a deterministic, FREE mini sp-1 brief from feed fields only (no model call), so a
 * catalog of hundreds of SKUs can be planned without spending. It reuses the creative research:
 * classifyProduct's keyword patterns pick the category, CATEGORY_PLAYBOOKS supply the proof shots
 * (matched to each claim by keyword overlap), objection busters and keyword patterns.
 *
 * Claims come from the feed's own words: list-item features, then description sentences that carry
 * a real number + unit (measured_spec), then plain description copy (claimed). Numbers are never
 * invented. When the feed says almost nothing, the playbook's top proof shots stand in as category
 * defaults and the brief says so in `gaps` (run the full product-brief action for an sp-1 brief).
 */
import { classifyProduct, finalizeBrief, type ProductBrief, type SpCategory } from "@/services/creative/product-brief";
import { categoryPlaybook } from "@/services/creative/playbooks";
import type { CatalogProduct } from "./types";

const squash = (s: string | null | undefined) => String(s ?? "").replace(/\s+/g, " ").trim();
const clampWords = (s: string, n: number) => {
  const w = squash(s).split(" ").filter(Boolean);
  return w.length > n ? w.slice(0, n).join(" ").replace(/[,;:–—-]+$/, "") : w.join(" ");
};

/** Category from the title first (most specific), then the feed's category / product type / tags, then the copy. */
export function catalogCategory(p: CatalogProduct): SpCategory {
  const tries = [p.title, [p.category, p.customLabels.product_type, p.customLabels.tags].filter(Boolean).join(" "), [p.description, ...p.features].join(" ")];
  for (const t of tries) {
    const c = classifyProduct(t ?? "");
    if (c !== "other") return c;
  }
  return "other";
}

/** A real number with a unit ("5 qt", "85%", "144Hz", "IPX6", "8K") — not "9 one-touch". */
const NUMERIC = /(\d[\d,.]*\s?(%|°|"|''|(?!(?:one|in|of|to|and|or|a|x|the)\b)[a-zA-Z]{1,8}\b))|\b(IP[X\d]\d|\d+K)\b/i;
const sentences = (text: string) =>
  squash(text)
    .split(/(?<=[.!?;])\s+|\s+[–—]\s+(?=[A-Z])/)
    .map((s) => s.replace(/[.!?;]+$/, "").trim())
    .filter((s) => s.length >= 8 && s.length <= 160);

/** Description sentences that carry a real number + unit. */
export function extractSpecClaims(text: string): string[] {
  return sentences(text).filter((s) => NUMERIC.test(s));
}

/* ───────────── proof-shot matching ───────────── */

const STOP = new Set("the a an in on of to with for and or by vs your you it is at from up into than all day our this that its be are as".split(" "));
const SYNONYMS: Record<string, string[]> = {
  hz: ["gaming", "fast"],
  refresh: ["gaming", "fast"],
  nit: ["brightness", "bright"],
  lumen: ["bright", "night"],
  mah: ["battery"],
  hour: ["battery"],
  hr: ["battery"],
  qt: ["capacity", "family"],
  quart: ["capacity", "family"],
  waterproof: ["weatherproof", "rain", "shower", "pool"],
  ipx6: ["weatherproof", "rain"],
  ipx7: ["weatherproof", "rain"],
  db: ["quiet"],
  silent: ["quiet"],
  dishwasher: ["clean"],
  nonstick: ["clean"],
  oil: ["crispy"],
  crispy: ["crunch"],
  hepa: ["filter", "allergy"],
  tarnish: ["shower", "day"],
  wireless: ["phone", "pocket"],
  plug: ["install", "port"],
  stabilization: ["bumpy", "horizon"],
  matte: ["glare"],
  "8k": ["resolution"],
};
const stem = (w: string) => w.replace(/(ies)$/, "y").replace(/(es|s)$/, "");
function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!raw || STOP.has(raw) || /^\d+$/.test(raw)) continue;
    const w = stem(raw);
    out.add(w);
    for (const s of SYNONYMS[w] ?? SYNONYMS[raw] ?? []) out.add(s);
  }
  return out;
}

const DEVICES: [RegExp, string][] = [
  [/time-?lapse/i, "time_lapse"],
  [/stopwatch|timer|meter\b|counter|overlay/i, "measurement_overlay"],
  [/split|side-by-side|\bvs\b|beside/i, "split_screen"],
  [/ruler|\bscale\b|footprint|for-scale/i, "scale_reference"],
  [/macro|close-up/i, "macro_texture"],
  [/unbox|install|plug|USB port/i, "unbox_setup"],
  [/torture|hose|spray|drop test|rain ride|sweat test/i, "torture_test"],
  [/screen recording|notification|\bapp\b/i, "screen_recording"],
];
const deviceOf = (shot: string) => DEVICES.find(([re]) => re.test(shot))?.[1] ?? "pov_use";

interface ShotPick {
  shot: string;
  index: number;
  overlap: number;
}

function bestShot(claim: string, shots: string[], used: Set<number>): ShotPick {
  const want = tokens(claim);
  let best: ShotPick = { shot: "", index: -1, overlap: 0 };
  shots.forEach((s, i) => {
    const have = tokens(s);
    let n = 0;
    for (const t of want) if (have.has(t)) n++;
    // A shot another claim already uses only wins on a clearly better match.
    const eff = n - (used.has(i) ? 0.5 : 0);
    if (n > 0 && eff > best.overlap - (used.has(best.index) ? 0.5 : 0)) best = { shot: s, index: i, overlap: n };
  });
  if (best.overlap > 0) return best;
  const free = shots.findIndex((_, i) => !used.has(i));
  const i = free >= 0 ? free : 0;
  return { shot: shots[i] ?? "", index: i, overlap: 0 };
}

/** "capacity → whole chicken drops in" → the filmable half. */
const shotText = (s: string) => squash(s.split("→").slice(1).join("→") || s);
const sellingHalf = (s: string) => squash(s.split("→")[0]);

const CONNECTOR = /^(&|\+|-|–|—|and|or|with|for|by|of|the|a|to|in|on)$/i;
/** ≤ 3-word overlay: the number + its unit ("219 SQ FT", "85%"), else the claim's first words. */
function overlayFor(claim: string): string {
  const m = claim.match(NUMERIC);
  if (m?.index != null) {
    const words = claim.slice(m.index).split(/\s+/);
    const unitWords = words[0].match(/\d$/) ? 2 : 1;
    const take = words.slice(0, unitWords + (words[unitWords - 1]?.length <= 2 && /^[a-z]{1,3}$/i.test(words[unitWords] ?? "") ? 1 : 0));
    return take.join(" ").replace(/[,.;:]+$/, "").toUpperCase();
  }
  const w = clampWords(claim, 3).split(" ");
  while (w.length > 1 && CONNECTOR.test(w[w.length - 1])) w.pop();
  return w.join(" ").replace(/[,;:]+$/, "").toUpperCase();
}

/* ───────────── the brief ───────────── */

interface Candidate {
  claim: string;
  location: "feed:features" | "feed:description" | "feed:title" | "category_playbook";
}

const dedupeKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

function candidates(p: CatalogProduct, shots: string[]): { list: Candidate[]; defaults: number } {
  const list: Candidate[] = [];
  const seen = new Set<string>();
  const push = (claim: string, location: Candidate["location"]) => {
    const c = clampWords(claim.replace(/[.!?]+$/, ""), 16);
    const k = dedupeKey(c);
    if (c.length < 4 || seen.has(k) || [...seen].some((s) => s.includes(k) || k.includes(s))) return;
    seen.add(k);
    list.push({ claim: c, location });
  };
  for (const f of p.features) push(f, "feed:features");
  for (const s of extractSpecClaims(p.description)) push(s, "feed:description");
  for (const s of sentences(p.description).filter((x) => !NUMERIC.test(x)).slice(0, 2)) push(s, "feed:description");
  if (list.length < 3) {
    // Numbers in the title ('85" Mini LED', '1000 Lumens', '5 Qt') are real specs too.
    const spec = p.title.match(/(\d[\d,.]*\s?("|in(?:ch)?|qt|lumens?|mah|w|oz|ml|l|gb|tb|k|hz|nits?|mm|cm|m)\b"?)([\s\w-]{0,20})/i)?.[0];
    if (spec) push(squash(spec), "feed:title");
  }
  let defaults = 0;
  const said = tokens(list.map((c) => c.claim).join(" "));
  for (const s of shots) {
    if (list.length >= 3) break;
    const half = sellingHalf(s);
    // A category default never restates (or overstates) what the feed already says.
    if (!half || [...tokens(half)].some((t) => said.has(t))) continue;
    const before = list.length;
    push(half[0].toUpperCase() + half.slice(1), "category_playbook");
    if (list.length > before) defaults++;
  }
  return { list: list.slice(0, 6), defaults };
}

export interface BriefLiteOptions {
  /** Short beat map length (default 15 s). */
  durationSec?: number;
  /** Skip classification (a category template's synthetic product). */
  category?: SpCategory;
}

/** Deterministic mini sp-1 brief from feed fields (free: no model call). */
export function briefLite(p: CatalogProduct, opts: BriefLiteOptions = {}): ProductBrief {
  const category = opts.category ?? catalogCategory(p);
  const book = categoryPlaybook(category);
  const shots = book.proofShots;
  const { list, defaults } = candidates(p, shots);
  const used = new Set<number>();

  const points = list.map((c, i) => {
    const pick = bestShot(c.claim, shots, used);
    used.add(pick.index);
    const numeric = NUMERIC.test(c.claim) && c.location !== "category_playbook";
    const fromPlaybook = c.location === "category_playbook";
    const shot = shotText(pick.shot) || `${p.title} in use, close on the product`;
    return {
      id: `sp${i + 1}`,
      claim: c.claim,
      advantage: "",
      benefit: sellingHalf(pick.shot) || c.claim,
      proofVisual: { device: deviceOf(shot), shot, overlayText: overlayFor(c.claim), durationSec: 3 },
      sourceEvidence: [{ type: fromPlaybook ? "category_norm" : numeric ? "spec" : "page_copy", quote: c.claim, location: c.location }],
      evidenceStrength: fromPlaybook ? "claimed" : numeric ? "measured_spec" : "claimed",
      driver: sellingHalf(pick.shot),
      awarenessStage: "product_aware",
      competitorUsage: false,
      uniqueness: numeric ? 0.4 : 0.25,
      scores: {
        // Playbook order is the category's buyer-importance order.
        buyerImportance: pick.overlap > 0 ? Math.max(0.45, 0.85 - 0.06 * pick.index) : 0.45,
        evidenceStrength: fromPlaybook ? 0.2 : numeric ? 0.8 : 0.3,
        differentiation: c.location === "feed:title" ? 0.2 : numeric ? 0.4 : 0.25,
        visualizability: pick.overlap > 0 ? 0.8 : 0.55,
        emotionalPull: 0.5,
      },
      priority: i + 1,
    };
  });

  const name = p.title;
  const price = p.salePrice ?? p.price ?? undefined;
  const top = [...points].sort((a, b) => score(b) - score(a));
  const proposition = clampWords(top[0]?.claim ?? `${p.brand ?? ""} ${name}`, 12);
  const keywordTerms = book.keywords
    .split(/[·]/)
    .flatMap((k) => k.trim().split(/\s+(?=#)/))
    .map((k) => k.trim())
    .filter(Boolean);
  const durationSec = opts.durationSec ?? 15;
  const ids = top.map((s) => s.id);
  const beats = [
    { t: "0-3", purpose: "hook", sellingPointId: ids[0], visual: top[0]?.proofVisual.shot ?? name, overlayText: top[0]?.proofVisual.overlayText },
    { t: "3-7", purpose: "proof", sellingPointId: ids[0], visual: top[0]?.proofVisual.shot ?? name },
    ...(ids[1] ? [{ t: "7-11", purpose: "proof", sellingPointId: ids[1], visual: top[1].proofVisual.shot }] : []),
    { t: `${durationSec - 3}-${durationSec}`, purpose: "brand_cta", visual: `${name} hero shot, logo + CTA` },
  ];

  const gaps = ["feed-only lite brief: no reviews, Q&A or competitor data — run the product-brief action for the full sp-1 brief"];
  if (!p.description && !p.features.length) gaps.push("no description in the feed");
  if (!p.images.length) gaps.push("no image in the feed");
  if (price == null) gaps.push("no price in the feed");
  if (defaults) gaps.push(`${defaults} selling point(s) are category defaults from the playbook — confirm they hold for this product`);

  const raw = {
    version: "sp-1",
    product: { name, brand: p.brand ?? "", model: p.sku, ...(price != null ? { price } : {}) },
    category,
    audience: { primary: `${book.label} shoppers`, secondary: [], awarenessStage: "product_aware" },
    primaryJob: { statement: `When I shop for ${book.label.toLowerCase()}, I decide on ${book.buyers.split(/[,;]/)[0]}`, functional: book.buyers, emotional: "" },
    forces: { push: [], pull: points.map((s) => s.claim).slice(0, 3), anxieties: book.objections.map((o) => o.split("→")[0].trim()), habits: [] },
    categoryEntryPoints: [],
    bigIdea: { proposition, alternates: top.slice(1, 4).map((s) => clampWords(s.claim, 12)) },
    sellingPoints: points,
    objections: book.objections.map((o) => ({ objection: squash(o.split("→")[0]), source: "category_norm", answer: "", bustingVisual: squash(o.split("→").slice(1).join("→")) })),
    competitorGaps: [],
    keywords: [
      ...(p.brand ? [{ term: `${p.brand} ${p.category ?? ""}`.trim().toLowerCase(), type: "brand", intent: "purchase", score: 0.7, placement: ["seo", "caption"] }] : []),
      ...keywordTerms.map((term) => ({ term, type: term.startsWith("#") ? "hashtag" : "category", intent: "consideration", score: 0.5, placement: term.startsWith("#") ? ["hashtag"] : ["caption", "seo"] })),
    ],
    complianceNotes: [],
    beatMap: { durationSec, beats },
    gaps,
  };
  return finalizeBrief(raw, category);
}

function score(s: { scores: Record<string, number> }): number {
  const x = s.scores;
  return 0.3 * x.buyerImportance + 0.25 * x.evidenceStrength + 0.2 * x.differentiation + 0.15 * x.visualizability + 0.1 * x.emotionalPull;
}
