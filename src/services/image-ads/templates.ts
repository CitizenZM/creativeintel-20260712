/**
 * Image-ad templates — pure data. Boxes are fractions of the format's safe rect, per layout class;
 * the two display sizes share compact layouts. Readable boxes never overlap each other and never
 * sit on the product (a badge or gift tag may); layout.test.ts enforces it for every template × format.
 */
import type { Layout, LayoutClass, Rect, TemplateDef } from "./types";

const R = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

const HEADLINE_DARK = { font: "headline", color: "ink", emphasis: "highlight", maxLines: 3, align: "centre", valign: "middle", uppercase: true, capPct: 0.11 } as const;

export const TEMPLATES: TemplateDef[] = [
  {
    id: "hero-product",
    name: "Hero product",
    useFor: "cold prospecting, evergreen — the product big, one promise",
    background: { kind: "glow", base: "bg", base2: "bg2", glow: "accent" },
    text: {
      headline: HEADLINE_DARK,
      sub: { font: "body", color: "muted", maxLines: 2, align: "centre", valign: "top", capPct: 0.045 },
    },
    badges: ["burst", "strike", "coupon"],
    requires: [],
    layouts: {
      square: { logo: R(0.36, 0, 0.28, 0.08), headline: R(0.04, 0.1, 0.92, 0.17), sub: R(0.1, 0.28, 0.8, 0.07), product: R(0.08, 0.37, 0.84, 0.48), badge: R(0.74, 0.36, 0.26, 0.26), cta: R(0.28, 0.88, 0.44, 0.12) },
      portrait: { logo: R(0.35, 0, 0.3, 0.065), headline: R(0.03, 0.085, 0.94, 0.16), sub: R(0.08, 0.255, 0.84, 0.065), product: R(0.04, 0.34, 0.92, 0.5), badge: R(0.7, 0.33, 0.3, 0.235), cta: R(0.25, 0.88, 0.5, 0.1) },
      tall: { logo: R(0.33, 0, 0.34, 0.055), headline: R(0.03, 0.075, 0.94, 0.15), sub: R(0.06, 0.235, 0.88, 0.07), product: R(0.02, 0.33, 0.96, 0.5), badge: R(0.68, 0.32, 0.32, 0.21), cta: R(0.22, 0.89, 0.56, 0.08) },
      wide: { product: R(0, 0.04, 0.5, 0.92), badge: R(0, 0, 0.17, 0.34), logo: R(0.56, 0, 0.22, 0.12), headline: R(0.54, 0.16, 0.46, 0.36), sub: R(0.54, 0.54, 0.46, 0.14), cta: R(0.54, 0.76, 0.3, 0.22) },
    },
  },
  {
    id: "split-benefit",
    name: "Split benefit",
    useFor: "consideration — product on a brand panel, three reasons to buy",
    background: { kind: "paper", base: "paper" },
    text: {
      headline: { font: "headline", color: "inkDark", emphasis: "button", maxLines: 3, align: "left", valign: "middle", uppercase: true, capPct: 0.1 },
      bullets: { font: "body", color: "inkDark", maxLines: 2, align: "left", valign: "middle", capPct: 0.042 },
    },
    badges: ["coupon", "strike", "burst"],
    requires: [],
    layouts: {
      square: { panels: [{ box: R(0, 0, 0.47, 1), color: "bg" }], product: R(0.02, 0.14, 0.42, 0.72), badge: R(0, 0, 0.34, 0.17), logo: R(0.52, 0, 0.3, 0.08), headline: R(0.52, 0.11, 0.48, 0.27), bullets: R(0.52, 0.41, 0.48, 0.38), cta: R(0.52, 0.84, 0.42, 0.13) },
      portrait: { panels: [{ box: R(0, 0, 1, 0.44), color: "bg" }], logo: R(0, 0, 0.26, 0.06), badge: R(0.64, 0, 0.36, 0.13), product: R(0.08, 0.07, 0.84, 0.34), headline: R(0, 0.47, 1, 0.15), bullets: R(0.04, 0.64, 0.92, 0.21), cta: R(0.25, 0.88, 0.5, 0.1) },
      tall: { panels: [{ box: R(0, 0, 1, 0.44), color: "bg" }], logo: R(0, 0, 0.26, 0.05), badge: R(0.62, 0, 0.38, 0.12), product: R(0.06, 0.06, 0.88, 0.35), headline: R(0, 0.47, 1, 0.14), bullets: R(0.04, 0.63, 0.92, 0.23), cta: R(0.22, 0.9, 0.56, 0.08) },
      wide: { panels: [{ box: R(0, 0, 0.46, 1), color: "bg" }], product: R(0.02, 0.06, 0.42, 0.88), badge: R(0, 0, 0.24, 0.24), logo: R(0.52, 0, 0.2, 0.12), headline: R(0.52, 0.15, 0.48, 0.28), bullets: R(0.52, 0.46, 0.48, 0.3), cta: R(0.52, 0.8, 0.28, 0.2) },
    },
  },
  {
    id: "before-after",
    name: "Before / after",
    useFor: "problem → solution, competitor contrast, objection busting",
    background: { kind: "dark", base: "bg", base2: "bg2" },
    text: {
      headline: { ...HEADLINE_DARK, maxLines: 2, capPct: 0.09 },
      sub: { font: "body", color: "muted", maxLines: 2, align: "centre", valign: "middle", capPct: 0.04 },
    },
    badges: ["burst", "strike"],
    requires: [],
    layouts: {
      square: { headline: R(0.04, 0, 0.92, 0.15), before: R(0, 0.17, 0.49, 0.6), after: R(0.51, 0.17, 0.49, 0.6), badge: R(0.8, 0.16, 0.2, 0.2), sub: R(0.05, 0.79, 0.9, 0.07), logo: R(0, 0.89, 0.24, 0.09), cta: R(0.5, 0.88, 0.5, 0.12) },
      portrait: { headline: R(0.03, 0, 0.94, 0.13), before: R(0, 0.15, 1, 0.32), after: R(0, 0.49, 1, 0.32), badge: R(0.76, 0.4, 0.24, 0.18), sub: R(0.05, 0.83, 0.9, 0.06), logo: R(0, 0.91, 0.25, 0.07), cta: R(0.45, 0.905, 0.55, 0.095) },
      tall: { headline: R(0.03, 0, 0.94, 0.12), before: R(0, 0.14, 1, 0.33), after: R(0, 0.49, 1, 0.33), badge: R(0.74, 0.4, 0.26, 0.17), sub: R(0.05, 0.84, 0.9, 0.055), logo: R(0, 0.92, 0.25, 0.06), cta: R(0.45, 0.915, 0.55, 0.085) },
      wide: { before: R(0, 0, 0.33, 0.78), after: R(0.34, 0, 0.33, 0.78), badge: R(0.54, 0, 0.13, 0.26), headline: R(0.69, 0.02, 0.31, 0.4), sub: R(0.69, 0.45, 0.31, 0.22), cta: R(0.69, 0.8, 0.31, 0.2), logo: R(0, 0.84, 0.2, 0.16) },
    },
  },
  {
    id: "testimonial-rating",
    name: "Testimonial + rating",
    useFor: "cold purchase, high ticket — real stars and a real buyer quote",
    background: { kind: "paper", base: "paper" },
    text: {
      quote: { font: "body", color: "inkDark", maxLines: 5, align: "centre", valign: "middle", capPct: 0.06 },
    },
    badges: [],
    requires: ["rating"],
    compactBadge: "rating",
    layouts: {
      square: { logo: R(0.36, 0, 0.28, 0.08), rating: R(0.15, 0.1, 0.7, 0.13), quote: R(0.04, 0.25, 0.92, 0.27), product: R(0.15, 0.54, 0.7, 0.32), cta: R(0.28, 0.88, 0.44, 0.12) },
      portrait: { logo: R(0.35, 0, 0.3, 0.06), rating: R(0.12, 0.08, 0.76, 0.11), quote: R(0.03, 0.21, 0.94, 0.26), product: R(0.08, 0.49, 0.84, 0.36), cta: R(0.25, 0.88, 0.5, 0.1) },
      tall: { logo: R(0.33, 0, 0.34, 0.05), rating: R(0.1, 0.07, 0.8, 0.1), quote: R(0.03, 0.19, 0.94, 0.25), product: R(0.04, 0.46, 0.92, 0.4), cta: R(0.22, 0.9, 0.56, 0.08) },
      wide: { product: R(0, 0.04, 0.42, 0.92), logo: R(0.46, 0, 0.2, 0.12), rating: R(0.46, 0.15, 0.54, 0.18), quote: R(0.46, 0.36, 0.54, 0.4), cta: R(0.46, 0.8, 0.3, 0.2) },
    },
  },
  {
    id: "offer-burst",
    name: "Offer burst",
    useFor: "promo, sale events — the discount is the hero",
    background: { kind: "stripes", base: "accent" },
    text: {
      headline: { font: "headline", color: "accentText", maxLines: 2, align: "centre", valign: "middle", uppercase: true, capPct: 0.12 },
      sub: { font: "body", color: "accentText", maxLines: 2, align: "centre", valign: "middle", capPct: 0.045 },
      deadline: { font: "body", color: "accentText", maxLines: 1, align: "centre", valign: "middle", uppercase: true, capPct: 0.035 },
    },
    badges: ["burst", "strike", "coupon"],
    requires: ["offer"],
    layouts: {
      square: { headline: R(0.04, 0, 0.92, 0.13), badge: R(0.02, 0.15, 0.44, 0.44), product: R(0.44, 0.15, 0.56, 0.55), sub: R(0.04, 0.72, 0.92, 0.07), deadline: R(0.1, 0.8, 0.8, 0.05), logo: R(0, 0.88, 0.24, 0.1), cta: R(0.42, 0.87, 0.58, 0.13) },
      portrait: { headline: R(0.03, 0, 0.94, 0.11), badge: R(0.22, 0.12, 0.56, 0.33), product: R(0.04, 0.46, 0.92, 0.3), sub: R(0.05, 0.775, 0.9, 0.055), deadline: R(0.1, 0.835, 0.8, 0.045), logo: R(0, 0.91, 0.25, 0.07), cta: R(0.45, 0.895, 0.55, 0.105) },
      tall: { headline: R(0.03, 0, 0.94, 0.1), badge: R(0.2, 0.11, 0.6, 0.3), product: R(0.03, 0.42, 0.94, 0.33), sub: R(0.05, 0.77, 0.9, 0.05), deadline: R(0.1, 0.83, 0.8, 0.04), logo: R(0, 0.915, 0.25, 0.06), cta: R(0.45, 0.9, 0.55, 0.1) },
      wide: { badge: R(0, 0.02, 0.27, 0.56), product: R(0.25, 0.04, 0.35, 0.92), headline: R(0.62, 0, 0.38, 0.3), sub: R(0.62, 0.33, 0.38, 0.2), deadline: R(0.62, 0.56, 0.38, 0.1), cta: R(0.62, 0.78, 0.38, 0.22), logo: R(0, 0.8, 0.22, 0.2) },
    },
  },
  {
    id: "gift-festive",
    name: "Gift / festive",
    useFor: "Q4, Valentine's, Mother's Day — the gift they'll actually use",
    background: { kind: "festive", base: "festive", base2: "festive2", glow: "gold" },
    text: {
      headline: { font: "headline", color: "white", emphasis: "gold", maxLines: 3, align: "centre", valign: "middle", uppercase: true, capPct: 0.1 },
      sub: { font: "body", color: "white", maxLines: 3, align: "centre", valign: "middle", capPct: 0.045 },
    },
    badges: [],
    requires: [],
    compactBadge: "tag",
    layouts: {
      square: { headline: R(0.04, 0, 0.92, 0.15), product: R(0.02, 0.18, 0.62, 0.64), tag: R(0.6, 0.18, 0.4, 0.3), sub: R(0.66, 0.52, 0.34, 0.26), logo: R(0, 0.88, 0.24, 0.1), cta: R(0.42, 0.87, 0.58, 0.13) },
      portrait: { headline: R(0.03, 0, 0.94, 0.12), tag: R(0.55, 0.13, 0.45, 0.17), product: R(0.04, 0.25, 0.92, 0.46), sub: R(0.05, 0.73, 0.9, 0.1), logo: R(0, 0.91, 0.25, 0.07), cta: R(0.45, 0.895, 0.55, 0.105) },
      tall: { headline: R(0.03, 0, 0.94, 0.11), tag: R(0.52, 0.12, 0.48, 0.15), product: R(0.03, 0.25, 0.94, 0.45), sub: R(0.05, 0.72, 0.9, 0.1), logo: R(0, 0.915, 0.25, 0.06), cta: R(0.45, 0.9, 0.55, 0.1) },
      wide: { logo: R(0, 0, 0.2, 0.14), product: R(0, 0.18, 0.48, 0.82), tag: R(0.3, 0, 0.24, 0.36), headline: R(0.56, 0, 0.44, 0.34), sub: R(0.56, 0.38, 0.44, 0.36), cta: R(0.56, 0.8, 0.34, 0.2) },
    },
  },
];

export const TEMPLATE_IDS = TEMPLATES.map((t) => t.id);

export function templateById(id: string): TemplateDef {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown image ad template ${id}`);
  return t;
}

/** Display sizes: logo · product · headline · offer · button — the template keeps its background and badge role. */
const COMPACT: Record<"small" | "banner", Layout> = {
  banner: { logo: R(0, 0.1, 0.12, 0.8), product: R(0.13, 0, 0.15, 1), headline: R(0.3, 0.04, 0.37, 0.92), badge: R(0.685, 0, 0.11, 1), cta: R(0.81, 0.17, 0.19, 0.66) },
  small: { logo: R(0, 0, 0.34, 0.11), headline: R(0, 0.13, 1, 0.23), product: R(0.03, 0.38, 0.6, 0.42), badge: R(0.65, 0.38, 0.35, 0.42), cta: R(0.18, 0.83, 0.64, 0.17) },
};

export function compactLayout(kind: "small" | "banner", t: TemplateDef): Layout {
  const base = { ...COMPACT[kind] };
  const role = t.compactBadge ?? "badge";
  if (role !== "badge") {
    base[role] = base.badge;
    delete base.badge;
  }
  return base;
}

export function layoutFor(t: TemplateDef, cls: LayoutClass): Layout {
  return cls === "small" || cls === "banner" ? compactLayout(cls, t) : t.layouts[cls];
}
