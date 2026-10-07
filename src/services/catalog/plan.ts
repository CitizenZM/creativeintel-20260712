/**
 * Catalog planning — feed products × mode → a per-SKU plan with a cost estimate. Pure: no model
 * call, no render, no compile, no I/O (the store layer reads the budget and persists the result).
 *
 *   image           per SKU: a lite brief → image-ad copy + the templates whose facts exist × formats.
 *                   Rendered locally later (catalog-render-images): $0.
 *   video-template  per category × platform: ONE locked storyboard template whose scenes are
 *                   product-free (a clear product spot), plus per-SKU product slots: the SKU packshot
 *                   composited into the slot frames, its own on-screen text / VO and its own price /
 *                   offer end card. Only the template's first render is paid; every SKU after that is a
 *                   re-edit of the same generated scenes (RE_EDIT_USD = $0).
 *   video-full      per SKU × platform: its own plan → locked frames → a line-item estimate (keyframes,
 *                   QC rerolls, clips, text-model calls). Paid, so this returns the estimate only and
 *                   never compiles; spend goes through the owner-approved budget (set-budget), never
 *                   auto-approved.
 */
import { DEFAULT_PLAN_PLATFORMS, fitSpoken, normalizeGoal, normalizePlatform, scaffoldPlatformPlan, type PromoInput } from "@/services/creative/campaign-planner";
import type { EndCardPlan, PlanBeat, PlatformPlan } from "@/services/creative/campaign-plan.types";
import { pickScript, scaffoldLockedFrames, type PlanStoryboardFrame } from "@/services/creative/plan-to-storyboard";
import { categoryPlaybook } from "@/services/creative/playbooks";
import type { ProductBrief, SpCategory } from "@/services/creative/product-brief";
import { RE_EDIT_END_CARDS, RE_EDIT_USD } from "@/services/creative/batch-matrix";
import type { CampaignGoal, PlatformId } from "@/services/creative/types";
import { deriveCopy, missingFacts, pctFrom } from "@/services/image-ads/copy";
import { templateById } from "@/services/image-ads/templates";
import type { FormatId, ImageAdCopy, ImageAdPromo, TemplateId } from "@/services/image-ads/types";
import { DEFAULT_PRICES, directorReviewCall, estimateRunCost, llmCostUsd, type LlmCallEstimate, type PriceTable, type Range } from "@/services/ops/cost-model";
import type { LockedFrame } from "@/services/video-gen/locked-script";
import { briefLite, catalogCategory } from "./brief-lite";
import type { CatalogMode, CatalogProduct } from "./types";

export const DEFAULT_IMAGE_TEMPLATES: TemplateId[] = ["hero-product", "split-benefit", "offer-burst"];
export const DEFAULT_IMAGE_FORMATS: FormatId[] = ["1080x1080", "1080x1350", "1080x1920"];
export const DEFAULT_MAX_SKUS = 50;
export const MAX_SKUS = 500;
/** Text model the estimate prices (the OpenRouter default route, ai/claude-client.ts). */
export const ESTIMATE_LLM = "deepseek/deepseek-v4-pro";

/** Catalog-wide offer; per-SKU price / compare price come from the feed. */
export interface CatalogPromo {
  pct?: number | null;
  code?: string | null;
  deadline?: string | null;
  label?: string | null;
}

export interface CatalogPlanOptions {
  mode: CatalogMode;
  platforms?: string[];
  goal?: string;
  promo?: CatalogPromo;
  maxSkus?: number;
  runDate?: string;
  /** Image mode. */
  templates?: TemplateId[];
  formats?: FormatId[];
  /** Video estimates. */
  imageModel?: string;
  llmModel?: string;
  prices?: PriceTable;
  /** The owner-approved project budget (store layer reads it); checked, never changed. */
  budget?: { budgetUsd: number | null; spentUsd: number };
}

export interface ProductSlot {
  /** Slot centre and width, as fractions of the frame. */
  x: number;
  y: number;
  w: number;
}

export interface CatalogTemplateFrame extends LockedFrame {
  purpose: PlanBeat["purpose"];
  productSlot?: ProductSlot;
}

export interface CatalogTemplate {
  id: string;
  category: SpCategory;
  platform: PlatformId;
  label: string;
  durationSec: number;
  aspect: PlatformPlan["aspect"];
  hookId: string;
  endCardId: string;
  frames: CatalogTemplateFrame[];
  productSlotFrames: number[];
  endCardFrame: number | null;
  firstRenderUsd: Range;
  skus: string[];
}

export interface SkuSlots {
  templateId: string;
  packshotUrl: string;
  productName: string;
  endCard: EndCardPlan;
  /** frameNumber → on-screen text / VO line for this SKU (re-edit layers). */
  overlays: Record<number, string>;
  voiceovers: Record<number, string>;
}

export interface CatalogSkuPlan {
  sku: string;
  title: string;
  category: SpCategory;
  packshotUrl: string;
  promo: ImageAdPromo;
  brief: { bigIdea: string; sellingPoints: { claim: string; overlay?: string; shot: string }[]; gaps: string[] };
  templateId?: string;
  image?: { templates: TemplateId[]; formats: FormatId[]; copy: Pick<ImageAdCopy, "headline" | "sub" | "cta" | "offerHeadline" | "bullets"> };
  slots?: SkuSlots[];
  full?: { platforms: { platform: PlatformId; durationSec: number; frames: number; costUsd: Range }[]; costUsd: Range };
}

export interface CatalogCost {
  paid: boolean;
  /** Paid modes: spend only after the owner approves a budget (set-budget). */
  approvalRequired: boolean;
  firstRenderUsd: Range;
  perSkuUsd: Range;
  totalUsd: Range;
  recommendedBudgetUsd: number;
  note: string;
  budget?: { approvedUsd: number | null; spentUsd: number; fits: boolean; shortfallUsd: number };
  pricesAsOf?: string;
  warnings: string[];
}

export interface CatalogPlan {
  version: 1;
  projectId: string;
  mode: CatalogMode;
  goal: CampaignGoal;
  platforms: PlatformId[];
  createdAt: string;
  skus: CatalogSkuPlan[];
  templates: CatalogTemplate[];
  skipped: { sku: string; reason: string }[];
  cost: CatalogCost;
  /** Planning never compiles or renders a paid run. */
  compiles: false;
  warnings: string[];
}

/* ───────────────────────── helpers ───────────────────────── */

const ZERO: Range = { low: 0, expected: 0, high: 0 };
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
const add = (a: Range, b: Range): Range => ({ low: r6(a.low + b.low), expected: r6(a.expected + b.expected), high: r6(a.high + b.high) });
const times = (a: Range, k: number): Range => ({ low: r6(a.low * k), expected: r6(a.expected * k), high: r6(a.high * k) });
const cents = (n: number) => Math.ceil(n * 100 - 1e-9) / 100;
const squash = (s: string | null | undefined) => String(s ?? "").replace(/\s+/g, " ").trim();
const SYMBOL: Record<string, string> = { USD: "$", CAD: "CA$", AUD: "A$", EUR: "€", GBP: "£", JPY: "¥" };

/** A SKU's offer: feed sale price → price / compare price / pct, plus the catalog-wide code, pct, deadline. */
export function skuPromo(p: CatalogProduct, promo: CatalogPromo = {}): ImageAdPromo {
  const onSale = p.salePrice != null && p.price != null && p.salePrice < p.price;
  const price = onSale ? p.salePrice : p.price;
  const comparePrice = onSale ? p.price : null;
  const pct = promo.pct && promo.pct > 0 ? Math.round(promo.pct) : pctFrom({ price, comparePrice });
  return {
    price: price ?? null,
    comparePrice,
    pct: pct ?? null,
    code: squash(promo.code) || null,
    deadline: squash(promo.deadline) || p.customLabels.sale_ends || null,
    currency: p.currency ? (SYMBOL[p.currency] ?? `${p.currency} `) : null,
    label: squash(promo.label) || null,
  };
}

const plannerPromo = (pr: ImageAdPromo, runDate: string): PromoInput => ({ pct: pr.pct, price: pr.price, comparePrice: pr.comparePrice, code: pr.code, deadline: pr.deadline, priceCheckedAt: runDate });

function compactBrief(b: ProductBrief): CatalogSkuPlan["brief"] {
  return {
    bigIdea: b.bigIdea.proposition,
    sellingPoints: b.sellingPoints.map((s) => ({ claim: s.claim, ...(s.proofVisual.overlayText ? { overlay: s.proofVisual.overlayText } : {}), shot: s.proofVisual.shot })),
    gaps: b.gaps,
  };
}

function rangeOf(f: { totals: Range }): Range {
  return { low: f.totals.low, expected: f.totals.expected, high: f.totals.high };
}

/* ───────────────────────── image mode ───────────────────────── */

/** Copy, promo and the templates whose facts exist, for one SKU (also used at render time). */
export function skuImageAd(p: CatalogProduct, brief: ProductBrief, promo: ImageAdPromo, opts: { templates?: TemplateId[] } = {}) {
  const copy = deriveCopy({ brief, brandName: p.brand ?? "", productName: p.title, promo });
  const templates = (opts.templates?.length ? opts.templates : DEFAULT_IMAGE_TEMPLATES).filter((t) => !missingFacts(templateById(t), copy, promo).length);
  return { copy, templates };
}

/* ───────────────────────── video-template mode ───────────────────────── */

const SLOT_PRODUCT: ProductSlot = { x: 0.5, y: 0.55, w: 0.5 };
const SLOT_WITH_CAST: ProductSlot = { x: 0.5, y: 0.62, w: 0.38 };

/** Scaffold frames → product-free template scenes with product slots (the packshot is composited in the edit). */
export function toTemplateFrames(frames: PlanStoryboardFrame[], beats: PlanBeat[]): CatalogTemplateFrame[] {
  return frames.map((f, i) => {
    const refs = f.locked.refs ?? "none";
    const hasProduct = refs === "product" || refs === "cast+product";
    const purpose = beats[i]?.purpose ?? "proof";
    const people = refs === "cast" || refs === "cast+product";
    const scene = squash(
      (f.imagePrompt ?? "")
        .replace(/\s*The [^.]*? from image 1 matches the reference exactly\./g, "")
        .replace(/\b(?:Hero shot of )?the [^.,]*? from image 1\b/gi, "a clear, softly lit product spot")
        .replace(/\s*from image 1\b/gi, "")
        .replace(/\s*Photorealistic, 35mm, natural light, no on-screen text\.?/, "")
    ).replace(/\.$/, "");
    const slotNote = hasProduct
      ? people
        ? " The person's hands frame a clear spot at the centre where the product is composited in the edit."
        : " Leave a clear, softly lit spot at the centre for the product, which is composited in the edit."
      : "";
    const locked: CatalogTemplateFrame["locked"] = { ...f.locked, refs: people ? "cast" : "none" };
    if (locked.endCard) locked.endCard = { id: locked.endCard.id, data: {} };
    return {
      frameNumber: f.frameNumber,
      startSec: f.startSec,
      endSec: f.endSec,
      segment: f.segment,
      imagePrompt: `${scene}.${slotNote} No product, no packaging, no logo, no text. Photorealistic, 35mm, natural light.`,
      videoPrompt: hasProduct && !people ? "Slow push-in toward the clear spot at the centre, then hold. Natural speed." : f.videoPrompt,
      locked,
      purpose,
      ...(hasProduct ? { productSlot: people ? SLOT_WITH_CAST : SLOT_PRODUCT } : {}),
    };
  });
}

/** The SKU's own copy per template frame: k-th beat of a purpose in the SKU script → k-th template frame of that purpose. */
function skuCopy(tpl: CatalogTemplate, skuPlan: PlatformPlan): { overlays: Record<number, string>; voiceovers: Record<number, string> } {
  const script = pickScript(skuPlan, tpl.hookId);
  const seen = new Map<string, number>();
  const overlays: Record<number, string> = {};
  const voiceovers: Record<number, string> = {};
  for (const f of tpl.frames) {
    const k = seen.get(f.purpose) ?? 0;
    seen.set(f.purpose, k + 1);
    const beat = script.beats.filter((b) => b.purpose === f.purpose)[k] ?? (f.purpose === "benefit" || f.purpose === "objection" ? undefined : script.beats.filter((b) => b.purpose === "proof")[k]);
    if (!beat) continue;
    if (beat.onScreenText) overlays[f.frameNumber] = beat.onScreenText;
    if (beat.vo) voiceovers[f.frameNumber] = fitSpoken(beat.vo, Math.max(2, Math.floor((f.endSec - f.startSec) * 2.5)));
  }
  return { overlays, voiceovers };
}

/* ───────────────────────── estimate inputs ───────────────────────── */

function llmCalls(model: string, kind: "brief" | "copy" | "director"): LlmCallEstimate {
  const one = { low: 1, expected: 1, high: 1 };
  if (kind === "brief") return { label: "Product brief (sp-1)", model, inTokens: 6000, outTokens: 6000, calls: one };
  if (kind === "copy") return { label: "Campaign copy pass", model, inTokens: 3500, outTokens: 2000, calls: one };
  return { label: "Storyboard director prompts", model, inTokens: 1500, outTokens: 3500, calls: one };
}

/* ───────────────────────── entry point ───────────────────────── */

export function planCatalog(projectId: string, products: CatalogProduct[], opts: CatalogPlanOptions): CatalogPlan {
  const mode = opts.mode;
  const runDate = opts.runDate ?? new Date().toISOString();
  const goal = normalizeGoal(opts.goal ?? (opts.promo?.code || opts.promo?.pct ? "promo" : undefined));
  const platforms = [...new Set((opts.platforms?.length ? opts.platforms : DEFAULT_PLAN_PLATFORMS).map(normalizePlatform))];
  const prices = opts.prices ?? DEFAULT_PRICES;
  const llmModel = opts.llmModel ?? ESTIMATE_LLM;
  const maxSkus = Math.min(MAX_SKUS, Math.max(1, Math.floor(opts.maxSkus ?? DEFAULT_MAX_SKUS)));
  const skipped: CatalogPlan["skipped"] = [];
  const warnings: string[] = [];

  const chosen: { p: CatalogProduct; brief: ProductBrief; promo: ImageAdPromo; category: SpCategory }[] = [];
  for (const p of products) {
    if (p.availability === "out_of_stock") skipped.push({ sku: p.sku, reason: "out of stock" });
    else if (!p.images.length) skipped.push({ sku: p.sku, reason: "no image" });
    else if (chosen.length >= maxSkus) skipped.push({ sku: p.sku, reason: "over maxSkus" });
    else {
      const brief = briefLite(p);
      chosen.push({ p, brief, promo: skuPromo(p, opts.promo), category: brief.category as SpCategory });
      if (p.price == null) warnings.push(`${p.sku}: no price in the feed — no price on its ads`);
    }
  }

  const skus: CatalogSkuPlan[] = chosen.map(({ p, brief, promo, category }) => ({
    sku: p.sku,
    title: p.title,
    category,
    packshotUrl: p.images[0],
    promo,
    brief: compactBrief(brief),
  }));
  const templates: CatalogTemplate[] = [];
  let cost: CatalogCost;

  if (mode === "image") {
    const formats = opts.formats?.length ? opts.formats : DEFAULT_IMAGE_FORMATS;
    chosen.forEach(({ p, brief, promo }, i) => {
      const { copy, templates: tpls } = skuImageAd(p, brief, promo, { templates: opts.templates });
      skus[i].image = { templates: tpls, formats, copy: { headline: copy.headline, sub: copy.sub, cta: copy.cta, offerHeadline: copy.offerHeadline, bullets: copy.bullets } };
    });
    cost = { paid: false, approvalRequired: false, firstRenderUsd: ZERO, perSkuUsd: ZERO, totalUsd: ZERO, recommendedBudgetUsd: 0, note: "Image ads render locally (sharp + pango): no paid model call.", warnings: [] };
  } else if (mode === "video-template") {
    const groups = new Map<SpCategory, typeof chosen>();
    for (const c of chosen) groups.set(c.category, [...(groups.get(c.category) ?? []), c]);
    let first = ZERO;
    const costWarnings = new Set<string>();
    for (const [category, members] of groups) {
      const lead = members[0];
      const book = categoryPlaybook(category);
      // Category scenes come from the playbook's proof shots (generic), not one SKU's claims.
      const synthetic: CatalogProduct = { ...lead.p, sku: `category-${category}`, title: book.label, description: "", features: [], customLabels: {} };
      const tplBrief = briefLite(synthetic, { category });
      for (const platform of platforms) {
        const plan = scaffoldPlatformPlan(tplBrief, platform, goal, plannerPromo(lead.promo, runDate), runDate);
        const hookId = plan.hookVariants[0]?.hookId ?? "";
        const script = pickScript(plan, hookId);
        const frames = toTemplateFrames(scaffoldLockedFrames({ plan, hookId, productName: "product" }), script.beats);
        const forecast = estimateRunCost({ lockedFrames: frames, imageModel: opts.imageModel }, { prices, llm: [llmCalls(llmModel, "director"), directorReviewCall(frames.length)] });
        forecast.warnings.forEach((w) => costWarnings.add(w));
        const tpl: CatalogTemplate = {
          id: `tpl-${category}-${platform}`,
          category,
          platform,
          label: `${book.label} · ${plan.label}`,
          durationSec: plan.durationSec,
          aspect: plan.aspect,
          hookId,
          endCardId: plan.endCard.id,
          frames,
          productSlotFrames: frames.filter((f) => f.productSlot).map((f) => f.frameNumber),
          endCardFrame: frames.find((f) => f.locked.endCard)?.frameNumber ?? null,
          firstRenderUsd: rangeOf(forecast),
          skus: members.map((m) => m.p.sku),
        };
        templates.push(tpl);
        first = add(first, tpl.firstRenderUsd);
        for (const m of members) {
          const s = skus.find((x) => x.sku === m.p.sku)!;
          const skuPlan = scaffoldPlatformPlan(m.brief, platform, goal, plannerPromo(m.promo, runDate), runDate, { hookIds: hookId ? [hookId] : undefined });
          const own = skuPlan.endCard;
          const endCard: EndCardPlan = RE_EDIT_END_CARDS.includes(own.id) ? own : { ...own, id: plan.endCard.id as EndCardPlan["id"], name: plan.endCard.name };
          s.templateId ??= tpl.id;
          s.slots = [...(s.slots ?? []), { templateId: tpl.id, packshotUrl: m.p.images[0], productName: m.p.title, endCard, ...skuCopy(tpl, skuPlan) }];
        }
      }
    }
    const total = add(first, times({ low: RE_EDIT_USD, expected: RE_EDIT_USD, high: RE_EDIT_USD }, chosen.length * platforms.length));
    cost = {
      paid: total.high > 0,
      approvalRequired: total.high > 0,
      firstRenderUsd: first,
      perSkuUsd: { low: RE_EDIT_USD, expected: RE_EDIT_USD, high: RE_EDIT_USD },
      totalUsd: total,
      recommendedBudgetUsd: cents(total.high),
      note: `${templates.length} template first render(s) are paid (${groups.size} categor${groups.size === 1 ? "y" : "ies"} × ${platforms.length} platform(s)); each of the ${chosen.length} SKU re-edits after that is free.`,
      pricesAsOf: undefined,
      warnings: [...costWarnings],
    };
  } else {
    let total = ZERO;
    const costWarnings = new Set<string>();
    const briefCall = llmCostUsd(prices, llmModel, 6000, 6000).usd ?? 0;
    chosen.forEach(({ p, brief, promo }, i) => {
      let skuTotal: Range = { low: briefCall, expected: briefCall, high: briefCall };
      const rows: NonNullable<CatalogSkuPlan["full"]>["platforms"] = [];
      for (const platform of platforms) {
        const plan = scaffoldPlatformPlan(brief, platform, goal, plannerPromo(promo, runDate), runDate);
        const frames = scaffoldLockedFrames({ plan, productName: p.title });
        const forecast = estimateRunCost({ lockedFrames: frames, imageModel: opts.imageModel }, { prices, llm: [llmCalls(llmModel, "copy"), llmCalls(llmModel, "director"), directorReviewCall(frames.length)] });
        forecast.warnings.forEach((w) => costWarnings.add(w));
        rows.push({ platform, durationSec: plan.durationSec, frames: frames.length, costUsd: rangeOf(forecast) });
        skuTotal = add(skuTotal, rangeOf(forecast));
      }
      skus[i].full = { platforms: rows, costUsd: skuTotal };
      total = add(total, skuTotal);
    });
    const per = chosen.length ? times(total, 1 / chosen.length) : ZERO;
    cost = {
      paid: true,
      approvalRequired: true,
      firstRenderUsd: ZERO,
      perSkuUsd: per,
      totalUsd: total,
      recommendedBudgetUsd: cents(total.high),
      note: `Estimate only — nothing was compiled. ${chosen.length} SKU(s) × ${platforms.length} platform(s), each its own paid render (worst case includes QC rerolls).`,
      warnings: [...costWarnings],
    };
  }

  if (cost.paid && opts.budget) {
    const { budgetUsd, spentUsd } = opts.budget;
    const need = spentUsd + cost.totalUsd.high;
    const fits = budgetUsd != null && need <= budgetUsd + 1e-9;
    cost.budget = { approvedUsd: budgetUsd, spentUsd, fits, shortfallUsd: budgetUsd == null ? cents(cost.totalUsd.high) : fits ? 0 : cents(need - budgetUsd) };
    if (budgetUsd == null) cost.note += " No approved budget on this project — the owner approves one with set-budget before any paid render.";
    else if (!fits) cost.note += ` The approved budget ($${budgetUsd}) does not cover the worst case — raise it with set-budget (owner approval) or plan fewer SKUs.`;
  } else if (cost.paid) cost.note += " Paid renders need an owner-approved budget (set-budget); nothing is approved automatically.";

  return {
    version: 1,
    projectId,
    mode,
    goal,
    platforms,
    createdAt: runDate,
    skus,
    templates,
    skipped,
    cost,
    compiles: false,
    warnings,
  };
}

/** Compact view for API / operator responses (the full plan stays on CatalogRun.results). */
export function summarizeCatalogPlan(plan: CatalogPlan) {
  return {
    mode: plan.mode,
    goal: plan.goal,
    platforms: plan.platforms,
    skus: plan.skus.length,
    skipped: plan.skipped.length,
    templates: plan.templates.map((t) => ({ id: t.id, frames: t.frames.length, skus: t.skus.length, firstRenderUsd: t.firstRenderUsd })),
    cost: plan.cost,
    sample: plan.skus.slice(0, 5).map((s) => ({ sku: s.sku, title: s.title, category: s.category, templates: s.image?.templates, templateId: s.templateId, costUsd: s.full?.costUsd })),
    warnings: plan.warnings.slice(0, 20),
  };
}
