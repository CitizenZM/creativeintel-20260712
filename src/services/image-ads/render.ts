/**
 * One static ad: template × format → PNG. The background (gradient, glow, stripes, festive snow,
 * panels) is one SVG; product, offer badge, gift tag, rating, quote card, bullets, before/after
 * cards, logo, auto-fitted text and the CTA pill are composited on top with sharp. Returns the
 * drawn boxes too, so callers can verify nothing readable left the safe rect or overlaps.
 */
import sharp from "sharp";
import { chooseBadge } from "./copy";
import type { Cutout } from "./cutout";
import { overlaps, resolveLayout, resolvePanels, round, TEXT_ROLES, type PlacedBox } from "./layout";
import { contrastRatio, ctaColors, mix, needsPlate, rgb } from "./palette";
import { layoutFor } from "./templates";
import { fitText, textAt } from "./text";
import type { AdFormat, AdLook, AdPalette, BadgeSpec, ColorToken, ImageAdCopy, ImageAdPromo, Rect, Role, TemplateDef, TextStyle } from "./types";

export interface RenderAssets {
  product: Cutout | null;
  /** The "before" picture; without one the product is shown washed out (glare, low contrast). */
  before?: Buffer | null;
  logo?: Buffer | null;
}

export interface RenderInput {
  template: TemplateDef;
  format: AdFormat;
  copy: ImageAdCopy;
  promo: ImageAdPromo;
  look: AdLook;
  assets: RenderAssets;
}

export interface RenderedAd {
  png: Buffer;
  /** What was actually drawn (pixels), for QA. */
  drawn: PlacedBox[];
  notes: string[];
}

type Layer = { input: Buffer; left: number; top: number };

const money = (v: number, cur = "$") => `${cur}${v % 1 === 0 ? v.toLocaleString("en-US") : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The text each slot carries for this template. */
export function contentFor(t: TemplateDef, copy: ImageAdCopy, promo: ImageAdPromo, badge: BadgeSpec | null): { headline: string; sub: string; deadline: string; tag: string } {
  const priceLine =
    promo.price && promo.comparePrice && promo.comparePrice > promo.price && badge?.kind !== "strike"
      ? `Now ${money(promo.price, promo.currency || "$")} · was ${money(promo.comparePrice, promo.currency || "$")}`
      : "";
  switch (t.id) {
    case "offer-burst":
      return { headline: copy.offerHeadline, sub: priceLine || copy.sub, deadline: copy.deadline ?? "", tag: "" };
    case "gift-festive":
      return { headline: copy.giftHeadline, sub: copy.sub, deadline: "", tag: copy.giftTag };
    default:
      return { headline: copy.headline, sub: copy.sub, deadline: copy.deadline ?? "", tag: copy.giftTag };
  }
}

function svgDoc(w: number, h: number, body: string): Buffer {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`);
}

/** Deterministic pseudo-random sequence (snow positions). */
function lcg(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function background(t: TemplateDef, f: AdFormat, p: AdPalette, product: Rect | null): Buffer {
  const { w, h } = f;
  const c = (tok: ColorToken | undefined, fallback: string) => (tok ? p[tok] : fallback);
  const base = c(t.background.base, p.bg);
  const base2 = c(t.background.base2, mix(base, "#000000", 0.25));
  const glow = c(t.background.glow, p.accent);
  const u = Math.min(w, h);
  const parts: string[] = [];
  const defs: string[] = [];
  switch (t.background.kind) {
    case "glow": {
      defs.push(`<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${base2}"/><stop offset="1" stop-color="${base}"/></linearGradient>`);
      const cx = product ? product.x + product.w / 2 : w / 2;
      const cy = product ? product.y + product.h / 2 : h / 2;
      const r = product ? Math.max(product.w, product.h) * 0.75 : u * 0.5;
      defs.push(`<radialGradient id="r" cx="${cx}" cy="${cy}" r="${r}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${glow}" stop-opacity="0.42"/><stop offset="0.55" stop-color="${glow}" stop-opacity="0.12"/><stop offset="1" stop-color="${glow}" stop-opacity="0"/></radialGradient>`);
      parts.push(`<rect width="${w}" height="${h}" fill="url(#g)"/>`, `<rect width="${w}" height="${h}" fill="url(#r)"/>`);
      break;
    }
    case "dark":
      defs.push(`<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${base2}"/><stop offset="1" stop-color="${base}"/></linearGradient>`);
      parts.push(`<rect width="${w}" height="${h}" fill="url(#g)"/>`);
      break;
    case "stripes": {
      const sw = Math.max(6, Math.round(u / 16));
      defs.push(`<pattern id="s" width="${sw * 2}" height="${sw * 2}" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)"><rect width="${sw}" height="${sw * 2}" fill="${mix(base, "#000000", 0.05)}"/></pattern>`);
      defs.push(`<radialGradient id="v" cx="0.5" cy="0.45" r="0.75"><stop offset="0.6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.12"/></radialGradient>`);
      parts.push(`<rect width="${w}" height="${h}" fill="${base}"/>`, `<rect width="${w}" height="${h}" fill="url(#s)"/>`, `<rect width="${w}" height="${h}" fill="url(#v)"/>`);
      break;
    }
    case "festive": {
      defs.push(`<radialGradient id="f" cx="0.5" cy="0.42" r="0.8"><stop offset="0" stop-color="${base}"/><stop offset="1" stop-color="${base2}"/></radialGradient>`);
      parts.push(`<rect width="${w}" height="${h}" fill="url(#f)"/>`);
      const rnd = lcg(w * 7 + h);
      const n = Math.round((w * h) / 9000);
      for (let i = 0; i < n; i++) {
        const r = (0.6 + rnd() * 1.6) * Math.max(1, u / 540);
        parts.push(`<circle cx="${(rnd() * w).toFixed(1)}" cy="${(rnd() * h).toFixed(1)}" r="${r.toFixed(1)}" fill="#FFFFFF" fill-opacity="${(0.18 + rnd() * 0.45).toFixed(2)}"/>`);
      }
      const inset = Math.max(3, Math.round(u * 0.018));
      parts.push(`<rect x="${inset}" y="${inset}" width="${w - inset * 2}" height="${h - inset * 2}" fill="none" stroke="${glow}" stroke-width="${Math.max(1.5, u * 0.004).toFixed(1)}" stroke-opacity="0.85"/>`);
      break;
    }
    default:
      parts.push(`<rect width="${w}" height="${h}" fill="${base}"/>`);
  }
  for (const pnl of resolvePanels(layoutFor(t, f.layout).panels, f)) parts.push(`<rect x="${pnl.x}" y="${pnl.y}" width="${pnl.w}" height="${pnl.h}" rx="${pnl.radius}" fill="${p[pnl.color]}"/>`);
  return svgDoc(w, h, `<defs>${defs.join("")}</defs>${parts.join("")}`);
}

/** The colour under a box: a panel it sits in, else the template's base. */
function bgUnder(t: TemplateDef, f: AdFormat, p: AdPalette, r: Rect): string {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const panel = resolvePanels(layoutFor(t, f.layout).panels, f).find((q) => cx >= q.x && cx <= q.x + q.w && cy >= q.y && cy <= q.y + q.h);
  return panel ? p[panel.color] : p[t.background.base];
}

const readableOn = (bg: string, p: AdPalette) => (contrastRatio(p.ink, bg) >= contrastRatio(p.inkDark, bg) ? p.ink : p.inkDark);

async function fitInto(png: Buffer, box: Rect): Promise<{ input: Buffer; w: number; h: number }> {
  const out = await sharp(png).resize({ width: Math.max(1, Math.floor(box.w)), height: Math.max(1, Math.floor(box.h)), fit: "inside" }).png().toBuffer();
  const m = await sharp(out).metadata();
  return { input: out, w: m.width ?? 1, h: m.height ?? 1 };
}

function place(box: Rect, w: number, h: number, align: "left" | "centre" | "right" = "centre", valign: "top" | "middle" | "bottom" = "middle") {
  const left = align === "left" ? box.x : align === "right" ? box.x + box.w - w : box.x + (box.w - w) / 2;
  const top = valign === "top" ? box.y : valign === "bottom" ? box.y + box.h - h : box.y + (box.h - h) / 2;
  return { left: Math.round(left), top: Math.round(top) };
}

const unitOf = (f: AdFormat) => Math.min(f.w, f.h);
const compact = (f: AdFormat) => f.layout === "small" || f.layout === "banner";

function sizeLimits(f: AdFormat, style: Pick<TextStyle, "capPct">, box: Rect) {
  const u = unitOf(f);
  if (compact(f)) return { maxSize: box.h, minSize: 9 };
  return { maxSize: Math.min(box.h, (style.capPct ?? 0.1) * u), minSize: Math.max(12, Math.round(u * 0.018)) };
}

/** Drop shadow under the product: a soft ellipse at its base. */
function shadowSvg(w: number, h: number): Buffer {
  const sw = Math.round(w * 1.1);
  const sh = Math.max(8, Math.round(h * 0.12));
  return svgDoc(sw, sh, `<defs><filter id="b" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="${Math.max(2, sh * 0.22).toFixed(1)}"/></filter></defs><ellipse cx="${sw / 2}" cy="${sh / 2}" rx="${sw * 0.4}" ry="${sh * 0.26}" fill="#000" fill-opacity="0.45" filter="url(#b)"/>`);
}

async function productLayers(cut: Cutout | null, box: Rect, notes: string[]): Promise<{ layers: Layer[]; drawn: Rect | null }> {
  if (!cut) {
    notes.push("no product image");
    return { layers: [], drawn: null };
  }
  const fit = await fitInto(cut.png, box);
  const pos = place(box, fit.w, fit.h);
  const layers: Layer[] = [];
  if (cut.method !== "none") {
    const sh = shadowSvg(fit.w, fit.h);
    const sm = await sharp(sh).metadata();
    layers.push({ input: await sharp(sh).png().toBuffer(), left: Math.round(pos.left + fit.w / 2 - (sm.width ?? 0) / 2), top: Math.round(pos.top + fit.h - (sm.height ?? 0) * 0.55) });
  }
  layers.push({ input: fit.input, ...pos });
  return { layers, drawn: { x: pos.left, y: pos.top, w: fit.w, h: fit.h } };
}

/** "Before": the same picture washed out — desaturated, low contrast, a glare streak. */
async function washedOut(png: Buffer): Promise<Buffer> {
  const m = await sharp(png).metadata();
  const w = m.width ?? 1;
  const h = m.height ?? 1;
  const glare = svgDoc(w, h, `<defs><linearGradient id="gl" x1="0" y1="0" x2="1" y2="1"><stop offset="0.25" stop-color="#fff" stop-opacity="0"/><stop offset="0.45" stop-color="#fff" stop-opacity="0.7"/><stop offset="0.6" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#gl)"/>`);
  const dulled = await sharp(png).modulate({ saturation: 0.15, brightness: 0.85 }).linear(0.55, 50).blur(Math.max(4, Math.min(w, h) / 70)).png().toBuffer();
  return sharp(dulled).composite([{ input: await sharp(glare).png().toBuffer(), blend: "atop" }]).png().toBuffer();
}

async function pillPng(text: string, box: Rect, colors: { bg: string; fg: string }, look: AdLook, f: AdFormat, opts: { arrow?: boolean; maxH?: number } = {}): Promise<{ input: Buffer; w: number; h: number }> {
  const H = Math.round(Math.min(box.h, opts.maxH ?? box.h));
  const padX = Math.round(H * 0.42);
  const label = `${text.toUpperCase()}${opts.arrow ? "  ›" : ""}`;
  const t = await fitText({ text: label, face: look.body, color: colors.fg, maxLines: 1, maxSize: H * 0.46, minSize: compact(f) ? 8 : 12 }, { w: box.w - padX * 2, h: H * 0.62 });
  const W = Math.min(Math.floor(box.w), t.width + padX * 2);
  const svg = svgDoc(W, H, `<rect width="${W}" height="${H}" rx="${H / 2}" fill="${colors.bg}"/>`);
  return { input: await sharp(svg).composite([{ input: t.png, left: Math.round((W - t.width) / 2), top: Math.round((H - t.height) / 2) }]).png().toBuffer(), w: W, h: H };
}

async function burstPng(pct: number, size: number, fill: string, fg: string, look: AdLook, f: AdFormat): Promise<Buffer> {
  const S = Math.max(24, Math.floor(size));
  const R = S / 2;
  const pts = Array.from({ length: 32 }, (_, i) => {
    const r = i % 2 ? R * 0.84 : R * 0.98;
    const a = (Math.PI * 2 * i) / 32 - Math.PI / 2;
    return `${(R + r * Math.cos(a)).toFixed(1)},${(R + r * Math.sin(a)).toFixed(1)}`;
  }).join(" ");
  const svg = svgDoc(S, S, `<g transform="rotate(-8 ${R} ${R})"><polygon points="${pts}" fill="${fill}" stroke="#FFFFFF" stroke-width="${Math.max(1, S * 0.022).toFixed(1)}"/></g>`);
  const inner = S * 0.6;
  const min = compact(f) ? 7 : 10;
  const big = await fitText({ text: `−${Math.round(pct)}%`, face: look.headline, color: fg, maxLines: 1, maxSize: inner * 0.55, minSize: min }, { w: inner, h: inner * 0.56 });
  const off = await fitText({ text: "OFF", face: look.headline, color: fg, maxLines: 1, maxSize: inner * 0.26, minSize: min }, { w: inner * 0.7, h: inner * 0.28 });
  const gap = inner * 0.02;
  const total = big.height + gap + off.height;
  const y0 = (S - total) / 2;
  return sharp(svg)
    .composite([
      { input: big.png, left: Math.round((S - big.width) / 2), top: Math.round(y0) },
      { input: off.png, left: Math.round((S - off.width) / 2), top: Math.round(y0 + big.height + gap) },
    ])
    .png()
    .toBuffer();
}

async function strikePng(b: BadgeSpec, box: Rect, p: AdPalette, look: AdLook, f: AdFormat): Promise<Buffer> {
  const W = Math.floor(box.w);
  const H = Math.floor(Math.min(box.h, box.w * 1.05));
  const pad = Math.round(Math.min(W, H) * 0.08);
  const min = compact(f) ? 7 : 11;
  const iw = W - pad * 2;
  const cur = b.currency || "$";
  const old = await fitText({ text: money(b.comparePrice!, cur), face: look.headline, color: "#8A8F99", maxLines: 1, maxSize: H * 0.2, minSize: min }, { w: iw * 0.8, h: (H - pad * 2) * 0.24 });
  const now = await fitText({ text: money(b.price!, cur), face: look.headline, color: p.button, maxLines: 1, maxSize: H * 0.4, minSize: min }, { w: iw, h: (H - pad * 2) * 0.42 });
  const save = await fitText({ text: `SAVE ${money(Math.round(b.comparePrice! - b.price!), cur)}`, face: look.body, color: p.accentText, maxLines: 1, maxSize: H * 0.12, minSize: min }, { w: iw * 0.78, h: (H - pad * 2) * 0.16 });
  const chipH = Math.round(save.height * 1.7);
  const chipW = Math.min(iw, save.width + chipH);
  const total = old.height + now.height + chipH + pad * 0.4;
  let y = Math.round((H - total) / 2);
  const oy = y;
  const ox = Math.round((W - old.width) / 2);
  y += old.height;
  const ny = y;
  y += now.height + Math.round(pad * 0.4);
  const cy = y;
  const strokeW = Math.max(2, Math.round(old.height * 0.09));
  const card = svgDoc(W, H, `<rect width="${W}" height="${H}" rx="${Math.round(Math.min(W, H) * 0.1)}" fill="#FFFFFF"/><rect x="${Math.round((W - chipW) / 2)}" y="${cy}" width="${chipW}" height="${chipH}" rx="${chipH / 2}" fill="${p.accent}"/>`);
  // The red strike is drawn over the old price, so it goes in last.
  const strike = svgDoc(W, H, `<line x1="${ox - strokeW}" y1="${oy + old.height * 0.6}" x2="${ox + old.width + strokeW}" y2="${oy + old.height * 0.4}" stroke="#E5322D" stroke-width="${strokeW}" stroke-linecap="round"/>`);
  return sharp(card)
    .composite([
      { input: old.png, left: ox, top: oy },
      { input: now.png, left: Math.round((W - now.width) / 2), top: ny },
      { input: save.png, left: Math.round((W - save.width) / 2), top: Math.round(cy + (chipH - save.height) / 2) },
      { input: await sharp(strike).png().toBuffer(), left: 0, top: 0 },
    ])
    .png()
    .toBuffer();
}

async function couponPng(b: BadgeSpec, box: Rect, p: AdPalette, look: AdLook, f: AdFormat): Promise<Buffer> {
  const W = Math.floor(Math.min(box.w, box.h * 2.6));
  const H = Math.floor(Math.min(box.h, W / 2.2));
  const n = Math.round(H * 0.13);
  const stubW = Math.round(W * 0.36);
  const min = compact(f) ? 7 : 10;
  const notched = `M0,0 H${W} V${H / 2 - n} A${n},${n} 0 0 0 ${W},${H / 2 + n} V${H} H0 V${H / 2 + n} A${n},${n} 0 0 0 0,${H / 2 - n} Z`;
  const svg = svgDoc(
    W,
    H,
    `<defs><clipPath id="t"><path d="${notched}"/></clipPath></defs><path d="${notched}" fill="#FFFFFF"/>` +
      `<rect width="${stubW}" height="${H}" fill="${p.button}" clip-path="url(#t)"/>` +
      `<line x1="${stubW}" y1="${H * 0.1}" x2="${stubW}" y2="${H * 0.9}" stroke="#FFFFFF" stroke-width="${Math.max(1, Math.round(H * 0.025))}" stroke-dasharray="${Math.round(H * 0.06)},${Math.round(H * 0.05)}"/>`
  );
  const stub = await fitText({ text: (b.stub ?? "Use code").toUpperCase(), face: look.headline, color: p.buttonText, maxLines: 2, maxSize: H * 0.3, minSize: min, leading: 1.02 }, { w: stubW - n * 1.4, h: H * 0.7 });
  const code = await fitText({ text: b.code ?? "", face: look.headline, color: p.inkDark, maxLines: 1, maxSize: H * 0.5, minSize: min }, { w: W - stubW - n * 1.6, h: H * 0.62 });
  return sharp(svg)
    .composite([
      { input: stub.png, left: Math.round(n * 0.7 + (stubW - n * 0.7 - stub.width) / 2), top: Math.round((H - stub.height) / 2) },
      { input: code.png, left: Math.round(stubW + (W - stubW - n * 0.7 - code.width) / 2), top: Math.round((H - code.height) / 2) },
    ])
    .png()
    .toBuffer();
}

async function badgePng(b: BadgeSpec, box: Rect, t: TemplateDef, f: AdFormat, p: AdPalette, look: AdLook): Promise<Buffer> {
  if (b.kind === "burst") {
    const under = bgUnder(t, f, p, box);
    const onAccent = contrastRatio(p.accent, under) < 1.6 || rgb(p.accent).every((v, i) => Math.abs(v - rgb(under)[i]) < 40);
    const fill = onAccent ? p.button : p.accent;
    const fg = onAccent ? p.buttonText : p.accentText;
    return burstPng(b.pct ?? 0, Math.min(box.w, box.h), fill, fg, look, f);
  }
  if (b.kind === "strike") return strikePng(b, box, p, look, f);
  return couponPng(b, box, p, look, f);
}

async function giftTagPng(text: string, box: Rect, look: AdLook, f: AdFormat): Promise<Buffer> {
  const W = Math.floor(Math.min(box.w, box.h * 1.55));
  const str = Math.round(W * 0.09);
  const H = Math.floor(Math.min(box.h - str, W * 0.6));
  const hole = H * 0.3;
  const svg = svgDoc(
    W,
    H + str,
    `<path d="M${W * 0.5},0 L${W * 0.5},${str}" stroke="#E8B04A" stroke-width="${Math.max(1, W * 0.012)}"/>` +
      `<path d="M${hole},${str} H${W - 2} V${H + str - 2} H${hole} L2,${str + H / 2} Z" fill="#D2AC74" stroke="#8C6A43" stroke-width="${Math.max(1, W * 0.01)}"/>` +
      `<circle cx="${hole}" cy="${str + H / 2}" r="${H * 0.07}" fill="#7A5A35"/>`
  );
  const t = await fitText({ text, face: look.headline, color: "#3B2A16", maxLines: 2, maxSize: H * 0.3, minSize: compact(f) ? 7 : 11, uppercase: true }, { w: (W - hole) * 0.84, h: H * 0.74 });
  return sharp(svg)
    .composite([{ input: t.png, left: Math.round(hole + (W - hole - t.width) / 2), top: Math.round(str + (H - t.height) / 2) }])
    .png()
    .toBuffer();
}

function starsSvg(value: number, w: number, color: string): Buffer {
  const s = w / 5;
  const star = (cx: number, r: number) =>
    Array.from({ length: 10 }, (_, i) => {
      const rr = i % 2 ? r * 0.45 : r;
      const a = (Math.PI * i) / 5 - Math.PI / 2;
      return `${(cx + rr * Math.cos(a)).toFixed(1)},${(s / 2 + rr * Math.sin(a)).toFixed(1)}`;
    }).join(" ");
  const fillW = (Math.max(0, Math.min(5, value)) / 5) * w;
  const polys = Array.from({ length: 5 }, (_, i) => star(s * i + s / 2, s * 0.47));
  return svgDoc(
    Math.round(w),
    Math.round(s),
    `<defs><clipPath id="c"><rect width="${fillW.toFixed(1)}" height="${s}"/></clipPath></defs>` +
      polys.map((pp) => `<polygon points="${pp}" fill="#D9D9D9"/>`).join("") +
      `<g clip-path="url(#c)">${polys.map((pp) => `<polygon points="${pp}" fill="${color}"/>`).join("")}</g>`
  );
}

async function ratingPng(r: { value: number; count: number | null }, box: Rect, textColor: string, look: AdLook, f: AdFormat): Promise<Buffer> {
  const sw = Math.floor(Math.min(box.w, box.h * 0.55 * 5));
  const stars = await sharp(starsSvg(r.value, sw, "#FFB400")).png().toBuffer();
  const sh = Math.round(sw / 5);
  const label = r.count ? `${r.value.toFixed(1)} · ${r.count.toLocaleString("en-US")} reviews` : `${r.value.toFixed(1)} out of 5`;
  const t = await fitText({ text: label, face: look.body, color: textColor, maxLines: 1, maxSize: box.h * 0.32, minSize: compact(f) ? 7 : 11 }, { w: box.w, h: Math.max(8, box.h - sh - 4) });
  const W = Math.max(sw, t.width);
  const H = sh + 4 + t.height;
  return sharp({ create: { width: Math.ceil(W), height: Math.ceil(H), channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: stars, left: Math.round((W - sw) / 2), top: 0 },
      { input: t.png, left: Math.round((W - t.width) / 2), top: sh + 4 },
    ])
    .png()
    .toBuffer();
}

async function quoteCardPng(text: string, author: string, box: Rect, p: AdPalette, look: AdLook, style: TextStyle, f: AdFormat): Promise<Buffer> {
  const W = Math.floor(box.w);
  const H = Math.floor(box.h);
  const pad = Math.round(Math.min(W, H) * 0.09);
  const lim = sizeLimits(f, style, box);
  const q = await fitText({ text: `“${text}”`, face: look.body, color: p[style.color], maxLines: style.maxLines, maxSize: lim.maxSize, minSize: lim.minSize, align: "centre" }, { w: W - pad * 2, h: (H - pad * 2) * 0.76 });
  const a = await fitText({ text: `— ${author}`, face: look.body, color: "#6B7080", maxLines: 1, maxSize: Math.max(lim.minSize, q.size * 0.75), minSize: lim.minSize }, { w: W - pad * 2, h: (H - pad * 2) * 0.2 });
  const total = q.height + a.height + pad * 0.3;
  const y0 = Math.round((H - total) / 2);
  const card = svgDoc(W, H, `<rect width="${W}" height="${H}" rx="${Math.round(Math.min(W, H) * 0.08)}" fill="#FFFFFF" stroke="#E4E1DA" stroke-width="2"/>`);
  return sharp(card)
    .composite([
      { input: q.png, left: Math.round((W - q.width) / 2), top: y0 },
      { input: a.png, left: Math.round((W - a.width) / 2), top: Math.round(y0 + q.height + pad * 0.3) },
    ])
    .png()
    .toBuffer();
}

async function bulletsPng(items: string[], box: Rect, p: AdPalette, look: AdLook, style: TextStyle, f: AdFormat): Promise<Buffer> {
  const rows = items.slice(0, 3);
  const rowH = box.h / rows.length;
  const disc = Math.round(Math.min(rowH * 0.42, box.w * 0.1));
  const gap = Math.round(disc * 0.45);
  const tw = Math.floor(box.w - disc - gap);
  const lim = sizeLimits(f, style, { ...box, h: rowH });
  const fits = await Promise.all(rows.map((r) => fitText({ text: r, face: look[style.font], color: p[style.color], maxLines: style.maxLines, maxSize: lim.maxSize, minSize: lim.minSize, align: "left" }, { w: tw, h: rowH * 0.86 })));
  // One size for every row (the smallest fit), so the list reads as a list.
  const size = Math.min(...fits.map((x) => x.size));
  const rendered = await Promise.all(fits.map((x) => (x.size === size ? x : textAt({ text: x.text, face: look[style.font], color: p[style.color], align: "left" }, size, tw))));
  const check = await sharp(svgDoc(disc, disc, `<circle cx="${disc / 2}" cy="${disc / 2}" r="${disc / 2}" fill="${p.button}"/><path d="M${disc * 0.28},${disc * 0.52} L${disc * 0.44},${disc * 0.68} L${disc * 0.74},${disc * 0.34}" stroke="${p.buttonText}" stroke-width="${Math.max(1.5, disc * 0.12)}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`)).png().toBuffer();
  const layers: Layer[] = [];
  rendered.forEach((r, i) => {
    const y = i * rowH;
    layers.push({ input: check, left: 0, top: Math.round(y + (rowH - disc) / 2) });
    layers.push({ input: r.png, left: disc + gap, top: Math.round(y + (rowH - r.height) / 2) });
  });
  return sharp({ create: { width: Math.floor(box.w), height: Math.floor(box.h), channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(layers).png().toBuffer();
}

async function compareCard(img: Buffer | null, label: string, box: Rect, p: AdPalette, look: AdLook, f: AdFormat, ours: boolean): Promise<Buffer> {
  const W = Math.floor(box.w);
  const H = Math.floor(box.h);
  const r = Math.round(Math.min(W, H) * 0.05);
  const card = svgDoc(W, H, `<rect width="${W}" height="${H}" rx="${r}" fill="${ours ? mix(p.bg2, "#FFFFFF", 0.06) : mix(p.bg, "#000000", 0.2)}" stroke="${ours ? p.button : "#3A3F4B"}" stroke-width="${Math.max(1, Math.round(Math.min(W, H) * 0.008))}"/>`);
  const pillH = Math.round(Math.min(H * 0.14, unitOf(f) * 0.065));
  const pad = Math.round(Math.min(W, H) * 0.05);
  const layers: Layer[] = [];
  if (img) {
    const fit = await fitInto(img, { x: 0, y: 0, w: W - pad * 2, h: H - pillH - pad * 2.5 });
    layers.push({ input: fit.input, left: Math.round((W - fit.w) / 2), top: Math.round(pad + (H - pillH - pad * 2.5 - fit.h) / 2) });
  }
  // The label sits bottom-left: the offer badge owns the top-right corner.
  const pill = await pillPng(label, { x: 0, y: 0, w: (W - pad * 2) * 0.7, h: pillH }, ours ? { bg: p.button, fg: p.buttonText } : { bg: "#3A3F4B", fg: "#FFFFFF" }, look, f);
  layers.push({ input: pill.input, left: pad, top: H - pad - pill.h });
  return sharp(card).composite(layers).png().toBuffer();
}

async function logoLayer(logo: Buffer | null | undefined, brandName: string, box: Rect, under: string, p: AdPalette, look: AdLook, f: AdFormat): Promise<{ input: Buffer; w: number; h: number }> {
  if (logo) {
    const trimmed = await sharp(logo).trim().png().toBuffer().catch(() => logo);
    const { data, info } = await sharp(trimmed).resize(48, 48, { fit: "inside" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let n = 0;
    const sum = [0, 0, 0];
    for (let i = 0; i < info.width * info.height; i++) if (data[i * 4 + 3] > 128) (n++, (sum[0] += data[i * 4]), (sum[1] += data[i * 4 + 1]), (sum[2] += data[i * 4 + 2]));
    const avg = n ? `#${sum.map((s) => Math.round(s / n).toString(16).padStart(2, "0")).join("")}` : "#000000";
    if (!needsPlate(avg, under)) return fitInto(trimmed, { ...box, h: box.h * 0.9 });
    const pad = Math.round(box.h * 0.16);
    const inner = await fitInto(trimmed, { x: 0, y: 0, w: box.w - pad * 2, h: box.h - pad * 2 });
    const plateBg = contrastRatio(avg, "#FFFFFF") >= 2.2 ? "#FFFFFF" : p.inkDark;
    const W = inner.w + pad * 2;
    const H = inner.h + pad * 2;
    const plate = svgDoc(W, H, `<rect width="${W}" height="${H}" rx="${Math.round(H * 0.22)}" fill="${plateBg}"/>`);
    return { input: await sharp(plate).composite([{ input: inner.input, left: pad, top: pad }]).png().toBuffer(), w: W, h: H };
  }
  const t = await fitText({ text: brandName, face: look.headline, color: readableOn(under, p), maxLines: 1, maxSize: box.h * 0.85, minSize: compact(f) ? 8 : 12, uppercase: true }, { w: box.w, h: box.h });
  return { input: t.png, w: t.width, h: t.height };
}

const DEFAULT_HEADLINE: TextStyle = { font: "headline", color: "ink", maxLines: 2, align: "centre", valign: "middle", uppercase: true, capPct: 0.1 };

export async function renderImageAd(input: RenderInput): Promise<RenderedAd> {
  const { template: t, format: f, copy, promo, look } = input;
  const p = look.palette;
  const notes: string[] = [];
  const boxes = new Map<Role, Rect>(resolveLayout(layoutFor(t, f.layout), f).map((b) => [b.role, round(b)]));
  const badge = chooseBadge(t.badges.length ? t.badges : compact(f) ? ["burst", "strike", "coupon"] : [], promo);
  const content = contentFor(t, copy, promo, badge);
  const layers: Layer[] = [];
  const drawn: PlacedBox[] = [];
  const add = (role: Role, input: Buffer, left: number, top: number, w: number, h: number) => {
    layers.push({ input, left, top });
    drawn.push({ role, x: left, y: top, w, h });
  };

  const productBox = boxes.get("product") ?? boxes.get("after") ?? null;
  const bg = await sharp(background(t, f, p, productBox)).png().toBuffer();

  // Imagery first.
  if (boxes.has("before") && boxes.has("after")) {
    const prod = input.assets.product?.png ?? null;
    const before = input.assets.before ?? (prod ? await washedOut(prod) : null);
    if (!input.assets.before && prod) notes.push("before: simulated from the product photo — pass a real before / competitor image");
    for (const [role, img, label, ours] of [
      ["before", before, copy.beforeLabel, false],
      ["after", prod, copy.afterLabel, true],
    ] as const) {
      const b = boxes.get(role)!;
      add(role, await compareCard(img, label, b, p, look, f, ours), b.x, b.y, b.w, b.h);
    }
  } else if (productBox) {
    const pr = await productLayers(input.assets.product, productBox, notes);
    layers.push(...pr.layers);
    if (pr.drawn) drawn.push({ role: "product", ...pr.drawn });
  }

  const textSlot = async (role: "headline" | "sub" | "deadline", text: string) => {
    const b = boxes.get(role);
    if (!b || !text.trim()) return;
    const style = t.text[role] ?? (role === "headline" ? { ...DEFAULT_HEADLINE, color: (contrastRatio(p.ink, p[t.background.base]) >= 4.5 ? "ink" : "inkDark") as ColorToken } : null);
    if (!style) return;
    const lim = sizeLimits(f, style, b);
    const maxLines = compact(f) ? Math.min(2, style.maxLines) : style.maxLines;
    const under = bgUnder(t, f, p, b);
    const color = contrastRatio(p[style.color], under) >= 3 ? p[style.color] : readableOn(under, p);
    const r = await fitText({ text, face: look[style.font], color, emphasis: style.emphasis ? p[style.emphasis] : null, uppercase: style.uppercase, align: style.align, maxLines, leading: style.font === "headline" ? 1.02 : 1.2, balance: role === "headline", ...lim }, b);
    if (!r.fits) notes.push(`${role} still overflows at ${r.size}px`);
    else if (r.text !== (style.uppercase ? text.toUpperCase() : text).replace(/\s+/g, " ").trim()) notes.push(`${role} shortened to fit`);
    const pos = place(b, r.width, r.height, style.align === "left" ? "left" : "centre", style.valign ?? "middle");
    add(role, r.png, pos.left, pos.top, r.width, r.height);
  };

  await textSlot("headline", content.headline);
  await textSlot("sub", content.sub);
  await textSlot("deadline", content.deadline);

  const bulletsBox = boxes.get("bullets");
  if (bulletsBox && copy.bullets.length) {
    const style = t.text.bullets ?? { font: "body", color: "inkDark", maxLines: 2, align: "left", capPct: 0.042 };
    add("bullets", await bulletsPng(copy.bullets, bulletsBox, p, look, style as TextStyle, f), bulletsBox.x, bulletsBox.y, bulletsBox.w, bulletsBox.h);
  }

  const ratingBox = boxes.get("rating");
  if (ratingBox && copy.rating) {
    const png = await ratingPng(copy.rating, ratingBox, readableOn(bgUnder(t, f, p, ratingBox), p), look, f);
    const m = await sharp(png).metadata();
    const pos = place(ratingBox, m.width ?? 0, m.height ?? 0);
    add("rating", png, pos.left, pos.top, m.width ?? 0, m.height ?? 0);
  }

  const quoteBox = boxes.get("quote");
  if (quoteBox && (copy.quote || copy.rating)) {
    const text = copy.quote?.text ?? `Rated ${copy.rating!.value.toFixed(1)} out of 5${copy.rating!.count ? ` by ${copy.rating!.count.toLocaleString("en-US")} buyers` : ""}`;
    const style = t.text.quote ?? { font: "body", color: "inkDark", maxLines: 5, align: "centre", capPct: 0.06 };
    add("quote", await quoteCardPng(text, copy.quote?.author ?? copy.brandName, quoteBox, p, look, style as TextStyle, f), quoteBox.x, quoteBox.y, quoteBox.w, quoteBox.h);
  }

  const tagBox = boxes.get("tag");
  if (tagBox && content.tag) {
    const png = await giftTagPng(content.tag, tagBox, look, f);
    const m = await sharp(png).metadata();
    const pos = place(tagBox, m.width ?? 0, m.height ?? 0);
    add("tag", png, pos.left, pos.top, m.width ?? 0, m.height ?? 0);
  }

  const badgeBox = boxes.get("badge");
  if (badgeBox && badge) {
    const png = await badgePng(badge, badgeBox, t, f, p, look);
    const m = await sharp(png).metadata();
    const pos = place(badgeBox, m.width ?? 0, m.height ?? 0);
    add("badge", png, pos.left, pos.top, m.width ?? 0, m.height ?? 0);
  }

  const logoBox = boxes.get("logo");
  if (logoBox) {
    const under = bgUnder(t, f, p, logoBox);
    const l = await logoLayer(input.assets.logo, copy.brandName, logoBox, under, p, look, f);
    const cx = logoBox.x + logoBox.w / 2;
    const align = cx < f.w * 0.35 ? "left" : cx > f.w * 0.65 ? "right" : "centre";
    const pos = place(logoBox, l.w, l.h, align);
    add("logo", l.input, pos.left, pos.top, l.w, l.h);
  }

  const ctaBox = boxes.get("cta");
  if (ctaBox) {
    const colors = ctaColors(p, bgUnder(t, f, p, ctaBox));
    const pill = await pillPng(copy.cta, ctaBox, colors, look, f, { arrow: !compact(f), maxH: compact(f) ? ctaBox.h : unitOf(f) * 0.095 });
    const align = t.text.headline?.align === "left" && ctaBox.x <= f.safe.x + f.safe.w * 0.6 ? "left" : "centre";
    const pos = place(ctaBox, pill.w, pill.h, align);
    add("cta", pill.input, pos.left, pos.top, pill.w, pill.h);
  }

  // QA on what was drawn: readable layers in the safe rect, not on top of each other.
  const readable = drawn.filter((d) => (TEXT_ROLES as string[]).includes(d.role));
  for (const d of readable) {
    if (d.x < f.safe.x - 1 || d.y < f.safe.y - 1 || d.x + d.w > f.safe.x + f.safe.w + 1 || d.y + d.h > f.safe.y + f.safe.h + 1) notes.push(`${d.role} leaves the safe area`);
  }
  for (let i = 0; i < readable.length; i++) for (let j = i + 1; j < readable.length; j++) if (overlaps(readable[i], readable[j])) notes.push(`${readable[i].role} overlaps ${readable[j].role}`);

  const png = await sharp(bg).composite(layers.map((l) => ({ ...l, left: Math.max(0, l.left), top: Math.max(0, l.top) }))).png({ compressionLevel: 8 }).toBuffer();
  return { png, drawn, notes };
}
