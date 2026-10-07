/**
 * Ad copy for the static set, from the same research as the video: the sp-1 brief's big idea and
 * ranked selling points, the campaign plan's hook text and end card (button, headline, facts), the
 * promo and — only when supplied — real proof (rating, review quote). Facts are never invented:
 * a badge needs its number, the testimonial needs a rating. Pure.
 */
import type { BadgeKind, BadgeSpec, ImageAdCopy, ImageAdPromo, ImageAdProof, TemplateDef } from "./types";

export interface BriefLike {
  product?: { name?: string; brand?: string; model?: string };
  bigIdea?: { proposition?: string; alternates?: string[] };
  sellingPoints?: { claim: string; benefit?: string; proofVisual?: { overlayText?: string } }[];
  competitorGaps?: { gap: string }[];
}

export interface PlanLike {
  platforms?: {
    hookVariants?: { openingText?: string }[];
    endCard?: { id?: string; button?: string; headline?: string; data?: Record<string, string | number> };
  }[];
  promo?: ImageAdPromo;
}

const CONNECTOR = /^(&|\+|-|—|–|·|and|or|with|for|by|of|the|a|to|in|on)$/i;

export function clampWords(text: string, n: number): string {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length <= n) return words.join(" ");
  const out = words.slice(0, n);
  while (out.length > 1 && CONNECTOR.test(out[out.length - 1])) out.pop();
  return out.join(" ").replace(/[,;:\-–—]+$/, "");
}

export function pctFrom(p: Pick<ImageAdPromo, "pct" | "price" | "comparePrice">): number | null {
  if (p.pct && p.pct > 0) return Math.round(p.pct);
  if (p.price && p.comparePrice && p.comparePrice > p.price) return Math.round((1 - p.price / p.comparePrice) * 100);
  return null;
}

/** The plan's end-card facts (pct, price, code, deadline) back-fill whatever the promo leaves out. */
export function promoFrom(promo: ImageAdPromo | undefined, plan?: PlanLike | null): ImageAdPromo {
  const data = plan?.platforms?.find((p) => p.endCard?.data)?.endCard?.data ?? {};
  const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const base = { ...(plan?.promo ?? {}), ...(promo ?? {}) };
  return {
    ...base,
    pct: base.pct ?? num(data.pct),
    price: base.price ?? num(data.price),
    comparePrice: base.comparePrice ?? num(data.comparePrice),
    code: base.code ?? str(data.code),
    deadline: base.deadline ?? str(data.deadline),
    currency: base.currency ?? str(data.currency),
  };
}

/** The first badge kind (template order) whose facts exist. */
export function chooseBadge(prefs: BadgeKind[], promo: ImageAdPromo): BadgeSpec | null {
  const pct = pctFrom(promo);
  const currency = promo.currency || "$";
  for (const kind of prefs) {
    if (kind === "burst" && pct) return { kind, pct };
    if (kind === "strike" && promo.price && promo.comparePrice && promo.comparePrice > promo.price) return { kind, price: promo.price, comparePrice: promo.comparePrice, currency };
    if (kind === "coupon" && promo.code?.trim()) return { kind, code: promo.code.trim().toUpperCase(), stub: "Use code" };
  }
  return null;
}

export function formatDeadline(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `Ends ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
}

export function deriveCopy(input: {
  brief?: BriefLike | null;
  plan?: PlanLike | null;
  brandName: string;
  productName?: string | null;
  promo?: ImageAdPromo;
  proof?: ImageAdProof | null;
  /** The brand kit's approved CTA. */
  ctaText?: string | null;
  overrides?: Partial<ImageAdCopy>;
}): ImageAdCopy {
  const { brief, plan } = input;
  const promo = promoFrom(input.promo, plan);
  const productName = brief?.product?.name?.trim() || input.productName?.trim() || input.brandName;
  const short = brief?.product?.model?.trim() || clampWords(productName.replace(new RegExp(`^${input.brandName}\\s+`, "i"), ""), 3);
  const points = brief?.sellingPoints ?? [];
  const line = (p: (typeof points)[number] | undefined, n: number) => (p ? p.proofVisual?.overlayText?.trim() || clampWords(p.claim, n) : "");
  const p0 = plan?.platforms?.[0];
  const endCard = plan?.platforms?.find((p) => p.endCard)?.endCard;
  const pct = pctFrom(promo);
  const proof = input.proof ?? null;
  const copy: ImageAdCopy = {
    brandName: input.brandName,
    productName,
    headline: clampWords(brief?.bigIdea?.proposition?.trim() || p0?.hookVariants?.[0]?.openingText?.trim() || productName, 10),
    sub: line(points[0], 8),
    bullets: points.slice(0, 4).map((p) => line(p, 6)).filter(Boolean),
    cta: endCard?.button?.trim() || input.ctaText?.trim() || "Shop now",
    offerHeadline: promo.label?.trim() || endCard?.headline?.trim() || (pct ? `${pct}% off` : "Limited-time deal"),
    giftHeadline: (endCard?.id === "E08" && endCard.headline?.trim()) || "The gift they'll actually use",
    giftTag: (typeof endCard?.data?.tag === "string" && endCard.data.tag.trim()) || (pct ? `Gift it · save ${pct}%` : `Gift the ${short}`),
    deadline: formatDeadline(promo.deadline),
    beforeLabel: "Others",
    afterLabel: short,
    rating: proof?.rating && proof.rating > 0 ? { value: Math.round(proof.rating * 10) / 10, count: proof.reviewCount ?? null } : null,
    quote: proof?.quote?.trim() ? { text: proof.quote.trim(), author: proof.author?.trim() || "Verified buyer" } : null,
  };
  return { ...copy, ...(input.overrides ?? {}) };
}

/** Facts a template needs that this ad doesn't have (the template is skipped, with a note). */
export function missingFacts(t: TemplateDef, copy: ImageAdCopy, promo: ImageAdPromo): string[] {
  return t.requires.filter((r) => (r === "rating" ? !copy.rating : r === "quote" ? !copy.quote : !chooseBadge(["burst", "strike", "coupon"], promo)));
}
