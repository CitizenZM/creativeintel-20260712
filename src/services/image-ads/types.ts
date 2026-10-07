/**
 * Image Ads (static ad sets from the same plan as the video) — shared types.
 * Layout boxes are fractions of a format's SAFE rect; panels may bleed to the canvas edge.
 */
import type { BrandFont } from "@/services/video-gen/edit/brand-style";

export type FormatId = "1080x1080" | "1080x1350" | "1080x1920" | "1200x628" | "1000x1500" | "300x250" | "728x90";

/** Layout family a format uses (picked by the shape of its safe rect). */
export type LayoutClass = "square" | "portrait" | "tall" | "wide" | "small" | "banner";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AdFormat {
  id: FormatId;
  label: string;
  w: number;
  h: number;
  /** Readable text, logo, badge and CTA stay inside this rect (pixels). */
  safe: Rect;
  layout: LayoutClass;
  placements: string[];
}

export type TemplateId = "hero-product" | "split-benefit" | "before-after" | "testimonial-rating" | "offer-burst" | "gift-festive";

/** Readable roles must sit inside the safe rect and never overlap each other. */
export type TextRole = "logo" | "headline" | "sub" | "badge" | "cta" | "bullets" | "rating" | "quote" | "tag" | "deadline";
/** Imagery: may sit under a badge / tag, never under text. */
export type ImageRole = "product" | "before" | "after";
export type Role = TextRole | ImageRole;

export type ColorToken = "bg" | "bg2" | "paper" | "ink" | "inkDark" | "accent" | "accentText" | "button" | "buttonText" | "highlight" | "gold" | "festive" | "festive2" | "white" | "muted";

export interface TextStyle {
  font: "headline" | "body";
  color: ColorToken;
  /** Last word in this colour (hook-style emphasis). */
  emphasis?: ColorToken;
  maxLines: number;
  align?: "left" | "centre";
  valign?: "top" | "middle" | "bottom";
  uppercase?: boolean;
  /** Cap on the type size as a share of min(format w, h), so a tall box doesn't get comic type. */
  capPct?: number;
}

export interface Panel {
  /** Safe-rect fractions; an edge at ≤ 0 or ≥ 1 bleeds to the canvas edge. */
  box: Rect;
  color: ColorToken;
  radius?: number;
}

export type Layout = Partial<Record<Role, Rect>> & { panels?: Panel[] };

export type BackgroundKind = "glow" | "paper" | "dark" | "stripes" | "festive";

export interface TemplateDef {
  id: TemplateId;
  name: string;
  /** What it's for (shown in the Studio). */
  useFor: string;
  background: { kind: BackgroundKind; base: ColorToken; base2?: ColorToken; glow?: ColorToken };
  text: Partial<Record<"headline" | "sub" | "bullets" | "deadline" | "quote", TextStyle>>;
  /** Offer badge kinds this template prefers, best first (only drawn when the facts exist). */
  badges: BadgeKind[];
  /** Facts the template needs; it is skipped (with a note) when they're missing. */
  requires: ("rating" | "quote" | "offer")[];
  layouts: Record<Exclude<LayoutClass, "small" | "banner">, Layout>;
  /** On the compact formats (300×250, 728×90) this role takes the badge slot. */
  compactBadge?: "badge" | "rating" | "tag";
}

export type BadgeKind = "burst" | "strike" | "coupon";

export interface BadgeSpec {
  kind: BadgeKind;
  pct?: number;
  price?: number;
  comparePrice?: number;
  currency?: string;
  code?: string;
  /** Small line on the ticket stub ("Extra 10% off"). */
  stub?: string;
}

export interface ImageAdPromo {
  pct?: number | null;
  price?: number | null;
  comparePrice?: number | null;
  currency?: string | null;
  code?: string | null;
  deadline?: string | null;
  /** Event label ("Black Friday") for the offer headline. */
  label?: string | null;
}

export interface ImageAdProof {
  rating?: number | null;
  reviewCount?: number | null;
  quote?: string | null;
  author?: string | null;
}

export interface ImageAdCopy {
  brandName: string;
  productName: string;
  headline: string;
  sub: string;
  bullets: string[];
  cta: string;
  offerHeadline: string;
  giftHeadline: string;
  giftTag: string;
  deadline: string | null;
  beforeLabel: string;
  afterLabel: string;
  rating: { value: number; count: number | null } | null;
  quote: { text: string; author: string } | null;
}

export interface AdPalette {
  bg: string;
  bg2: string;
  paper: string;
  ink: string;
  inkDark: string;
  accent: string;
  accentText: string;
  button: string;
  buttonText: string;
  highlight: string;
  gold: string;
  festive: string;
  festive2: string;
  white: string;
  muted: string;
}

export interface AdLook {
  palette: AdPalette;
  headline: BrandFont;
  body: BrandFont;
}
