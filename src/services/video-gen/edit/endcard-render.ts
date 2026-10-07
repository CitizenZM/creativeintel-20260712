/**
 * End-card templates (library: services/creative/library.ts END_CARDS) rendered as PNG layers for the
 * v2 edit. Every readable layer sits in a fixed slot inside the strict 9:16 safe box (y 288–1220):
 *   LOGO .178 · HEADLINE .238 · MAIN .40 (badge / ticket / price / tag / quote / carousel / QR) · FINE .555 · BUTTON .603
 * The brand logo, fine print and CTA button are drawn by the edit for every template (the button is
 * hidden only by E09 / E12); a template only adds its own layers.
 *
 * Themes give every card several looks: "brand" (the Brand Kit colours on the footage — the default),
 * "dark" (a dark scrim with dark plates), "light" (clean white cards and plates) and "festive"
 * (Christmas / New Year: red, green and gold with a snow sparkle layer).
 */
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { pangoEscape } from "../glm-assemble";
import { DEFAULT_STYLE } from "./brand-style";
import { encodeQr } from "./qr";
import { pill, renderMarkup, shadowed, type Look } from "./text-layers";

type Canvas = { w: number; h: number };

export type EndCardTemplate = "E01" | "E02" | "E03" | "E04" | "E05" | "E06" | "E07" | "E08" | "E09" | "E10" | "E11" | "E12";
export const RENDERABLE_END_CARDS: EndCardTemplate[] = ["E01", "E02", "E03", "E04", "E05", "E06", "E07", "E08", "E09", "E10", "E11", "E12"];

export type EndCardTheme = "brand" | "dark" | "light" | "festive";
export const END_CARD_THEMES: EndCardTheme[] = ["brand", "dark", "light", "festive"];

export interface EndCardSku {
  imageUrl?: string | null;
  imagePath?: string | null;
  label: string;
  price?: number | null;
}

export interface EndCardData {
  headline?: string | null;
  pct?: number | null;
  code?: string | null;
  price?: number | null;
  comparePrice?: number | null;
  currency?: string | null;
  tag?: string | null;
  sticker?: string | null;
  button?: string | null;
  /** Look of the card; default "brand". */
  theme?: EndCardTheme | null;
  /** E05: the real calendar deadline ("Ends Sunday"). */
  deadline?: string | null;
  /** E06 / E10: store or review rating out of 5. */
  rating?: number | null;
  reviewCount?: number | string | null;
  /** E06: a short real review (clipped to 14 words) and who wrote it. */
  quote?: string | null;
  quoteBy?: string | null;
  /** E07: two or more products for the carousel (the first is the hero). */
  skus?: EndCardSku[] | null;
  /** E10: the app. */
  appName?: string | null;
  appIconUrl?: string | null;
  appIconPath?: string | null;
  benefits?: string[] | null;
  downloads?: string | null;
  /** E11: the landing URL encoded in the QR code. */
  url?: string | null;
}

/**
 * pop / slam / pulse / wipe / fade scale or fade the layer itself (its PNG input must loop — see
 * layerInputArgs); bounce / bob / rise / drift move the overlay.
 */
export type LayerAnim = "none" | "pop" | "slam" | "pulse" | "bob" | "bounce" | "wipe" | "fade" | "rise" | "drift";

export interface EndCardLayer {
  png: Buffer;
  /** Vertical centre as a share of the frame height. */
  y: number;
  /** Seconds after the end card starts. */
  delaySec: number;
  /** Shown for this long (frame sequences: star fill, carousel, shine); default until the end. */
  durSec?: number;
  anim: LayerAnim;
  role: "backdrop" | "decor" | "headline" | "main" | "button" | "pointer";
}

export interface EndCardResult {
  layers: EndCardLayer[];
  hideButton: boolean;
  fineY?: number;
  /** The themed look — the edit draws the CTA button with it. */
  look: Look;
}

/** Slots on a vertical canvas; landscape / square exports keep the classic spacing. */
export function endCardSlots(c: Canvas) {
  const vertical = c.h / c.w > 1.5;
  return vertical
    ? { logo: 0.178, headline: 0.238, main: 0.4, fine: 0.555, button: 0.603, caption: 0.6 }
    : { logo: 0.1, headline: 0.22, main: 0.45, fine: 0.9, button: 0.74, caption: 0.7 };
}

const unit = (c: Canvas) => Math.min(c.w, c.h);
const isVertical = (c: Canvas) => c.h / c.w > 1.5;
const money = (v: number, cur = "$") => `${cur}${v % 1 === 0 ? v.toFixed(0) : v.toFixed(2)}`;
const svgPng = (svg: string) => sharp(Buffer.from(svg)).png().toBuffer();
async function size(b: Buffer): Promise<{ w: number; h: number }> {
  const m = await sharp(b).metadata();
  return { w: m.width ?? 0, h: m.height ?? 0 };
}

// ─── Themes ──────────────────────────────────────────────────────────────────────────────────────

export interface Palette {
  theme: EndCardTheme;
  look: Look;
  /** Free text (labels over footage). */
  text: string;
  /** Light theme: free text sits on a white plate instead of a shadow. */
  textPlate: string | null;
  plate: string;
  plateText: string;
  muted: string;
  card: string;
  cardText: string;
  cardSub: string;
  stroke: string | null;
  accent: string;
  price: string;
  badgeBg: string;
  badgeText: string;
  badgeStroke: string;
  starOn: string;
  starOff: string;
  urgent: string;
  tag: { fill: string; stroke: string; text: string; hole: string };
  sticker: { bg: string; fg: string };
}

export function endCardPalette(theme: EndCardTheme | null | undefined, look: Look): Palette {
  const base: Palette = {
    theme: "brand",
    look,
    text: "#FFFFFF",
    textPlate: null,
    plate: "rgba(0,0,0,0.62)",
    plateText: "#FFFFFF",
    muted: "#B8B8B8",
    card: "#FFFFFF",
    cardText: "#111111",
    cardSub: "#6B6B6B",
    stroke: null,
    accent: look.button,
    price: look.highlight,
    badgeBg: look.offerBg,
    badgeText: look.offerText,
    badgeStroke: "#FFFFFF",
    starOn: "#FFC531",
    starOff: "rgba(255,255,255,0.32)",
    urgent: "#E5322D",
    tag: { fill: "#C9A06A", stroke: "#8C6A43", text: "#3B2A16", hole: "#7A5A35" },
    sticker: { bg: "#FFFFFF", fg: "#111111" },
  };
  switch (theme ?? "brand") {
    case "dark":
      return {
        ...base,
        theme: "dark",
        look: { ...look, offerBg: "#121216", offerText: look.highlight },
        accent: look.highlight,
        plate: "rgba(16,16,20,0.92)",
        card: "#1B1D22",
        cardText: "#FFFFFF",
        cardSub: "#A3A7AF",
        stroke: "rgba(255,255,255,0.22)",
        starOff: "rgba(255,255,255,0.22)",
        tag: { fill: "#24262C", stroke: look.highlight, text: "#FFFFFF", hole: "#000000" },
      };
    case "light":
      return {
        ...base,
        theme: "light",
        look: { ...look, offerBg: "#FFFFFF", offerText: "#111111" },
        text: "#111111",
        textPlate: "rgba(255,255,255,0.95)",
        plate: "rgba(255,255,255,0.95)",
        plateText: "#111111",
        muted: "#8A8A8A",
        stroke: "rgba(0,0,0,0.10)",
        price: look.button,
        badgeBg: look.button,
        badgeText: look.buttonText,
      };
    case "festive": {
      const red = "#C8102E";
      const green = "#146B3A";
      const gold = "#F5C542";
      return {
        ...base,
        theme: "festive",
        look: { ...look, highlight: gold, offerBg: red, offerText: "#FFFFFF", button: green, buttonText: "#FFFFFF" },
        plate: "rgba(14,72,40,0.92)",
        muted: "#CFE0D3",
        card: "#FFFDF6",
        cardText: "#5E0B16",
        cardSub: "#8B6B3E",
        stroke: gold,
        accent: red,
        price: gold,
        badgeBg: red,
        badgeText: "#FFFFFF",
        badgeStroke: gold,
        starOn: gold,
        urgent: red,
        tag: { fill: red, stroke: gold, text: "#FFFFFF", hole: "#5E0B16" },
        sticker: { bg: "#FFFFFF", fg: red },
      };
    }
    default:
      return base;
  }
}

// ─── Primitives ──────────────────────────────────────────────────────────────────────────────────

async function textPng(markup: string, look: Look, px: number, width: number, headline = true): Promise<Buffer> {
  const face = headline ? look.headline : look.body;
  return renderMarkup(markup, { family: face.family, fontFile: face.file, size: px, width: Math.max(10, Math.round(width)) });
}

/** Transparent canvas with images placed at (left, top); parts outside the canvas are cropped. */
async function compose(W: number, H: number, items: { input: Buffer; left: number; top: number }[], bgSvg?: string): Promise<Buffer> {
  const ops: sharp.OverlayOptions[] = [];
  for (const it of items) {
    const s = await size(it.input);
    const x0 = Math.max(0, it.left);
    const y0 = Math.max(0, it.top);
    const x1 = Math.min(W, it.left + s.w);
    const y1 = Math.min(H, it.top + s.h);
    if (x1 - x0 < 1 || y1 - y0 < 1) continue;
    const input = x0 === it.left && y0 === it.top && x1 - x0 === s.w && y1 - y0 === s.h ? it.input : await sharp(it.input).extract({ left: x0 - it.left, top: y0 - it.top, width: x1 - x0, height: y1 - y0 }).png().toBuffer();
    ops.push({ input, left: Math.round(x0), top: Math.round(y0) });
  }
  const base = bgSvg ? sharp(Buffer.from(bgSvg)) : sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
  return base.composite(ops).png().toBuffer();
}

/** Stack images vertically, centred, with `gap` between. */
async function column(items: Buffer[], gap: number): Promise<Buffer> {
  const sz = await Promise.all(items.map(size));
  const W = Math.max(...sz.map((s) => s.w));
  const H = sz.reduce((n, s) => n + s.h, 0) + gap * (items.length - 1);
  let y = 0;
  return compose(W, H, items.map((input, i) => {
    const it = { input, left: Math.round((W - sz[i].w) / 2), top: y };
    y += sz[i].h + gap;
    return it;
  }));
}

/** Lay images out left to right, vertically centred. */
async function row(items: Buffer[], gap: number): Promise<Buffer> {
  const sz = await Promise.all(items.map(size));
  const H = Math.max(...sz.map((s) => s.h));
  const W = sz.reduce((n, s) => n + s.w, 0) + gap * (items.length - 1);
  let x = 0;
  return compose(W, H, items.map((input, i) => {
    const it = { input, left: x, top: Math.round((H - sz[i].h) / 2) };
    x += sz[i].w + gap;
    return it;
  }));
}

/** Content on a rounded plate. */
async function onPlate(content: Buffer, padX: number, padY: number, fill: string, radius: number, stroke: string | null, minW = 0): Promise<Buffer> {
  const s = await size(content);
  const W = Math.max(minW, s.w + padX * 2);
  const H = s.h + padY * 2;
  const sw = stroke ? 3 : 0;
  const svg = `<svg width="${W}" height="${H}"><rect x="${sw / 2}" y="${sw / 2}" width="${W - sw}" height="${H - sw}" rx="${radius}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="${sw}"` : ""}/></svg>`;
  return compose(W, H, [{ input: content, left: Math.round((W - s.w) / 2), top: padY }], svg);
}

function starPath(cx: number, cy: number, R: number): string {
  return Array.from({ length: 10 }, (_, i) => {
    const r = i % 2 ? R * 0.45 : R;
    const a = (Math.PI * i) / 5 - Math.PI / 2;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(" ");
}

async function loadImage(src: { url?: string | null; path?: string | null }): Promise<Buffer | null> {
  try {
    if (src.path) return await readFile(src.path);
    if (src.url) {
      const res = await fetch(src.url, { signal: AbortSignal.timeout(15_000) });
      return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
    }
  } catch {
    /* fall through */
  }
  return null;
}

/** Multiply a PNG's alpha by `a` (0–1). */
async function withOpacity(png: Buffer, a: number): Promise<Buffer> {
  if (a >= 0.999) return png;
  return sharp(png)
    .ensureAlpha()
    .composite([{ input: Buffer.from([255, 255, 255, Math.round(255 * a)]), raw: { width: 1, height: 1, channels: 4 }, tile: true, blend: "dest-in" }])
    .png()
    .toBuffer();
}

// ─── Builders: E02–E04, E08, E09, E12 ────────────────────────────────────────────────────────────

/** E02 — a 12-point starburst carrying "−30%" + "OFF". */
async function badge(pct: number, c: Canvas, p: Palette): Promise<Buffer> {
  const R = Math.round(unit(c) * 0.21);
  const pts = Array.from({ length: 24 }, (_, i) => {
    const r = i % 2 ? R * 0.84 : R;
    const a = (Math.PI * 2 * i) / 24 - Math.PI / 2;
    return `${(R + r * Math.cos(a)).toFixed(1)},${(R + r * Math.sin(a)).toFixed(1)}`;
  }).join(" ");
  const svg = `<svg width="${R * 2}" height="${R * 2}"><g transform="rotate(-8 ${R} ${R})"><polygon points="${pts}" fill="${p.badgeBg}" stroke="${p.badgeStroke}" stroke-width="${Math.round(R * 0.04)}"/></g></svg>`;
  const big = await textPng(`<span foreground="${p.badgeText}">−${Math.round(pct)}%</span>`, p.look, Math.round(R * 0.5), R * 1.6);
  const off = await textPng(`<span foreground="${p.badgeText}">OFF</span>`, p.look, Math.round(R * 0.2), R * 1.6);
  const [bs, os] = await Promise.all([size(big), size(off)]);
  return compose(R * 2, R * 2, [
    { input: big, left: Math.round(R - bs.w / 2), top: Math.round(R - bs.h / 2 - R * 0.1) },
    { input: off, left: Math.round(R - os.w / 2), top: Math.round(R - os.h / 2 + R * 0.36) },
  ], svg);
}

/** E03 — a ticket with notched sides, a perforation and the code. */
async function ticket(code: string, stub: string, c: Canvas, p: Palette): Promise<Buffer> {
  const W = Math.round(Math.min(c.w * 0.555, unit(c) * 0.555));
  const H = Math.round(W * 0.42);
  const n = Math.round(H * 0.16);
  const stubW = Math.round(W * 0.34);
  const st = p.stroke ? ` stroke="${p.stroke}" stroke-width="3"` : "";
  const svg = `<svg width="${W}" height="${H}"><path d="M1.5,1.5 H${W - 1.5} V${H / 2 - n} A${n},${n} 0 0 0 ${W - 1.5},${H / 2 + n} V${H - 1.5} H1.5 V${H / 2 + n} A${n},${n} 0 0 0 1.5,${H / 2 - n} Z" fill="${p.card}"${st}/><line x1="${stubW}" y1="${H * 0.1}" x2="${stubW}" y2="${H * 0.9}" stroke="${p.cardSub}" stroke-opacity="0.6" stroke-width="4" stroke-dasharray="12,10"/></svg>`;
  const stubTxt = await textPng(`<span foreground="${p.accent}">${pangoEscape(stub.toUpperCase())}</span>`, p.look, Math.round(H * 0.11), stubW - n * 2 - 16);
  const codeTxt = await textPng(`<span foreground="${p.cardText}">${pangoEscape(code.toUpperCase())}</span>`, p.look, Math.round(H * 0.3), W - stubW - 30);
  const [sm, cm] = await Promise.all([size(stubTxt), size(codeTxt)]);
  return compose(W, H, [
    { input: stubTxt, top: Math.round((H - sm.h) / 2), left: Math.round(n + 8 + (stubW - n - 8 - sm.w) / 2) },
    { input: codeTxt, top: Math.round((H - cm.h) / 2), left: stubW + Math.round((W - stubW - cm.w) / 2) },
  ], svg);
}

/** E04 — old price struck through in red, the new price big, a "Save $X" chip, on a plate. */
async function priceCard(price: number, compare: number, cur: string, c: Canvas, p: Palette): Promise<Buffer> {
  const W = Math.round(unit(c) * 0.555);
  const oldTxt = await textPng(`<span foreground="${p.muted}">${money(compare, cur)}</span>`, p.look, Math.round(unit(c) * 0.07), W - 40);
  const newTxt = await textPng(`<span foreground="${p.price}">${money(price, cur)}</span>`, p.look, Math.round(unit(c) * 0.14), W - 40);
  const chip = await pill(`SAVE ${money(Math.round(compare - price), cur)}`, c, { size: Math.round(unit(c) * 0.04), fg: p.badgeText, bg: p.badgeBg, family: p.look.body.family, fontFile: p.look.body.file, widthPct: 0.45 });
  const [om, nm, cm] = await Promise.all([oldTxt, newTxt, chip].map(size));
  const H = om.h + nm.h + cm.h + 70;
  const st = p.stroke ? ` stroke="${p.stroke}" stroke-width="3"` : "";
  const svg = `<svg width="${W}" height="${H}"><rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="36" fill="${p.plate}"${st}/></svg>`;
  const ox = Math.round((W - om.w) / 2);
  const oy = 20;
  const strike = await svgPng(`<svg width="${om.w + 20}" height="${om.h}"><line x1="0" y1="${om.h * 0.55}" x2="${om.w + 20}" y2="${om.h * 0.45}" stroke="#E5322D" stroke-width="${Math.max(6, Math.round(unit(c) * 0.008))}"/></svg>`);
  return compose(W, H, [
    { input: oldTxt, top: oy, left: ox },
    { input: strike, top: oy, left: Math.max(0, ox - 10) },
    { input: newTxt, top: oy + om.h + 10, left: Math.round((W - nm.w) / 2) },
    { input: chip, top: oy + om.h + nm.h + 25, left: Math.round((W - cm.w) / 2) },
  ], svg);
}

/** E08 — a gift tag with a punched hole and string. */
async function giftTag(text: string, c: Canvas, p: Palette): Promise<Buffer> {
  const W = Math.round(unit(c) * 0.46);
  const H = Math.round(W * 0.62);
  const svg = `<svg width="${W}" height="${H + 40}"><path d="M${W * 0.5},0 L${W * 0.5},40" stroke="${p.tag.stroke}" stroke-width="5"/><path d="M${H * 0.3},40 H${W - 2} V${H + 38} H${H * 0.3} L2,${40 + H / 2} Z" fill="${p.tag.fill}" stroke="${p.tag.stroke}" stroke-width="4"/><circle cx="${H * 0.3}" cy="${40 + H / 2}" r="${H * 0.07}" fill="${p.tag.hole}"/></svg>`;
  const t = await textPng(`<span foreground="${p.tag.text}">${pangoEscape(text)}</span>`, p.look, Math.round(H * 0.17), Math.round(W * 0.66));
  const tm = await size(t);
  return compose(W, H + 40, [{ input: t, top: 40 + Math.round((H - tm.h) / 2), left: Math.round(H * 0.3 + (W - H * 0.3 - tm.w) / 2) }], svg);
}

/** E09 — a down arrow that bobs toward the platform's own CTA. */
async function arrow(c: Canvas, p: Palette): Promise<Buffer> {
  const W = Math.round(unit(c) * 0.11);
  const H = Math.round(W * 1.2);
  return svgPng(`<svg width="${W}" height="${H}"><path d="M${W * 0.32},3 H${W * 0.68} V${H * 0.55} H${W - 3} L${W / 2},${H - 3} L3,${H * 0.55} H${W * 0.32} Z" fill="${p.look.button}" stroke="white" stroke-width="5"/></svg>`);
}

/** E12 — a native, creator-style sticker. */
async function sticker(text: string, c: Canvas, p: Palette): Promise<Buffer> {
  return pill(text, c, { size: Math.round(unit(c) * 0.05), fg: p.sticker.fg, bg: p.sticker.bg, family: p.look.body.family, fontFile: p.look.body.file, widthPct: 0.5 });
}

// ─── E05 urgency bar ─────────────────────────────────────────────────────────────────────────────

/** The bar itself (wipes in) and its text (pops after) — same size so they line up. */
async function urgencyBar(deadline: string, c: Canvas, p: Palette): Promise<{ bar: Buffer; text: Buffer }> {
  const W = Math.round(Math.min(c.w * 0.76, unit(c) * 0.76));
  const H = Math.round(unit(c) * 0.115);
  const g = Math.round(H * 0.16);
  const TW = W + g * 2;
  const TH = H + g * 2;
  const st = p.stroke ? ` stroke="${p.stroke}" stroke-width="4"` : ` stroke="rgba(255,255,255,0.85)" stroke-width="3"`;
  const bar = await svgPng(
    `<svg width="${TW}" height="${TH}"><defs><filter id="gl" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="${g * 0.45}"/></filter></defs>` +
      `<rect x="${g}" y="${g}" width="${W}" height="${H}" rx="${H * 0.2}" fill="${p.urgent}" opacity="0.7" filter="url(#gl)"/>` +
      `<rect x="${g}" y="${g}" width="${W}" height="${H}" rx="${H * 0.2}" fill="${p.urgent}"${st}/></svg>`,
  );
  const r = H * 0.27;
  const clock = await svgPng(
    `<svg width="${Math.round(r * 2 + 8)}" height="${Math.round(r * 2 + 8)}"><circle cx="${r + 4}" cy="${r + 4}" r="${r}" fill="none" stroke="white" stroke-width="${Math.max(4, r * 0.16)}"/>` +
      `<path d="M${r + 4},${r + 4 - r * 0.6} V${r + 4} L${r + 4 + r * 0.45},${r + 4 + r * 0.3}" fill="none" stroke="white" stroke-width="${Math.max(4, r * 0.16)}" stroke-linecap="round"/></svg>`,
  );
  const label = await textPng(`<span foreground="#FFFFFF">${pangoEscape(deadline.toUpperCase())}</span>`, p.look, Math.round(H * 0.42), W - r * 2 - 70);
  const line = await row([clock, label], Math.round(H * 0.16));
  const ls = await size(line);
  const text = await compose(TW, TH, [{ input: line, left: Math.round((TW - ls.w) / 2), top: Math.round((TH - ls.h) / 2) }]);
  return { bar, text };
}

// ─── E06 rating + testimonial ────────────────────────────────────────────────────────────────────

/** Five stars: the empty row plus one fill layer per star (same canvas so they stack in place). */
async function starRow(rating: number, c: Canvas, p: Palette): Promise<{ base: Buffer; fills: Buffer[] }> {
  const S = Math.round(unit(c) * 0.074);
  const gap = Math.round(S * 0.2);
  const pad = 6;
  const W = S * 5 + gap * 4 + pad * 2;
  const H = S + pad * 2;
  const cx = (i: number) => pad + i * (S + gap) + S / 2;
  // No plate in any theme (a plated row would crowd the logo): stars carry their own soft shadow.
  const shadow = `<defs><filter id="sh"><feGaussianBlur stdDeviation="3"/></filter></defs>`;
  const off = p.theme === "light" ? "rgba(255,255,255,0.55)" : p.starOff;
  const base = await svgPng(
    `<svg width="${W}" height="${H}">${shadow}` +
      Array.from({ length: 5 }, (_, i) => `<polygon points="${starPath(cx(i), H / 2 + 2, S / 2)}" fill="black" opacity="0.45" filter="url(#sh)"/><polygon points="${starPath(cx(i), H / 2, S / 2)}" fill="${off}"/>`).join("") +
      `</svg>`,
  );
  const r = Math.max(0, Math.min(5, rating));
  const fills: Buffer[] = [];
  for (let i = 0; i < 5; i++) {
    const share = Math.max(0, Math.min(1, r - i));
    if (share <= 0.04) break;
    const x0 = cx(i) - S / 2;
    fills.push(
      await svgPng(
        `<svg width="${W}" height="${H}"><defs><clipPath id="c"><rect x="${x0 - 2}" y="0" width="${(S + 4) * share}" height="${H}"/></clipPath></defs>` +
          `<polygon points="${starPath(cx(i), H / 2, S / 2)}" fill="${p.starOn}" clip-path="url(#c)"/></svg>`,
      ),
    );
  }
  return { base, fills };
}

const fmtCount = (n: number | string) => (typeof n === "number" ? n.toLocaleString("en-US") : n);

/** "★ 4.6 · 12,480 reviews" with a drawn star (the fonts carry no star glyph). */
async function ratingLine(rating: number, extra: string | null, c: Canvas, p: Palette, px: number, opts: { star?: boolean; onPlate?: boolean } = {}): Promise<Buffer> {
  const S = Math.round(px * 0.95);
  const txt = `${rating.toFixed(1)}${extra ? `  ·  ${extra}` : ""}`;
  const face = p.look.body;
  const plain = opts.onPlate || p.textPlate;
  const color = opts.onPlate ? p.plateText : p.text;
  const label = plain
    ? await renderMarkup(`<span foreground="${color}">${pangoEscape(txt)}</span>`, { family: face.family, fontFile: face.file, size: px, width: Math.round(c.w * 0.7) })
    : await shadowed(`<span foreground="${color}">${pangoEscape(txt)}</span>`, `<span foreground="black">${pangoEscape(txt)}</span>`, { family: face.family, fontFile: face.file, size: px, width: Math.round(c.w * 0.7) });
  const line = opts.star === false ? label : await row([await svgPng(`<svg width="${S}" height="${S}"><polygon points="${starPath(S / 2, S / 2 + 1, S / 2 - 1)}" fill="${p.starOn}"/></svg>`), label], Math.round(px * 0.3));
  return p.textPlate && !opts.onPlate ? onPlate(line, Math.round(px * 0.6), Math.round(px * 0.3), p.textPlate, px, null) : line;
}

/** A quote card: ≤ 14 words in italics with the attribution under it. */
async function quoteCard(quote: string, by: string, c: Canvas, p: Palette): Promise<Buffer> {
  const W = Math.round(unit(c) * 0.555);
  const words = quote.replace(/^["“”']+|["“”']+$/g, "").trim().split(/\s+/);
  const clipped = words.length > 14 ? `${words.slice(0, 14).join(" ")}…` : words.join(" ");
  const px = Math.round(unit(c) * 0.04);
  const body = await renderMarkup(`<span foreground="${p.cardText}"><i>“${pangoEscape(clipped)}”</i></span>`, { family: p.look.body.family, fontFile: p.look.body.file, size: px, width: W - 80 });
  const att = await renderMarkup(`<span foreground="${p.cardSub}">— ${pangoEscape(by)}</span>`, { family: p.look.body.family, fontFile: p.look.body.file, size: Math.round(px * 0.62), width: W - 80 });
  const mark = await svgPng(`<svg width="${Math.round(px * 1.6)}" height="${Math.round(px * 0.5)}"><rect width="${Math.round(px * 1.6)}" height="${Math.round(px * 0.5)}" rx="${px * 0.25}" fill="${p.accent}"/></svg>`);
  const inner = await column([mark, body, att], Math.round(px * 0.45));
  return onPlate(inner, 40, Math.round(px * 0.9), p.card, 28, p.stroke, W);
}

// ─── E07 carousel ────────────────────────────────────────────────────────────────────────────────

async function skuTile(img: Buffer, sku: EndCardSku, cur: string, c: Canvas, p: Palette): Promise<Buffer> {
  const TW = Math.round(unit(c) * 0.333);
  const TH = Math.round(TW * 1.28);
  const pic = await sharp(img).resize({ width: TW - 40, height: Math.round(TH * 0.6), fit: "inside" }).png().toBuffer();
  const ps = await size(pic);
  const label = await renderMarkup(`<span foreground="${p.cardText}">${pangoEscape(sku.label)}</span>`, { family: p.look.body.family, fontFile: p.look.body.file, size: Math.round(unit(c) * 0.03), width: TW - 30 });
  const ls = await size(label);
  const well = p.theme === "dark" ? [{ input: await svgPng(`<svg width="${TW - 24}" height="${Math.round(TH * 0.6) + 8}"><rect width="${TW - 24}" height="${Math.round(TH * 0.6) + 8}" rx="20" fill="#E9EBEF"/></svg>`), left: 12, top: 12 }] : [];
  const items = [
    ...well,
    { input: pic, left: Math.round((TW - ps.w) / 2), top: 20 + Math.round((TH * 0.6 - ps.h) / 2) },
    { input: label, left: Math.round((TW - ls.w) / 2), top: Math.round(TH * 0.6) + 32 },
  ];
  if (sku.price) {
    const price = await textPng(`<span foreground="${p.theme === "light" || p.theme === "brand" ? p.look.button : p.theme === "festive" ? "#C8102E" : p.look.highlight}">${money(sku.price, cur)}</span>`, p.look, Math.round(unit(c) * 0.046), TW - 30);
    const prs = await size(price);
    items.push({ input: price, left: Math.round((TW - prs.w) / 2), top: Math.min(TH - prs.h - 10, Math.round(TH * 0.6) + 40 + ls.h) });
  }
  const st = p.stroke ? ` stroke="${p.stroke}" stroke-width="3"` : "";
  return compose(TW, TH, items, `<svg width="${TW}" height="${TH}"><rect x="1.5" y="1.5" width="${TW - 3}" height="${TH - 3}" rx="28" fill="${p.card}"${st}/></svg>`);
}

/** One carousel state: centre `k`, shifted left by `u` (0–1) of a slot. */
async function carouselFrame(tiles: Buffer[], k: number, u: number, c: Canvas): Promise<Buffer> {
  const N = tiles.length;
  const ts = await size(tiles[0]);
  const CW = Math.round(Math.min(c.w * 0.92, unit(c) * 0.92));
  const CH = ts.h;
  const dx = Math.round(ts.w * 0.86);
  const placed: { pos: number; i: number }[] = [];
  for (let i = 0; i < N; i++) {
    let d = (((i - k) % N) + N) % N;
    if (d > N / 2) d -= N;
    let pos = d - u;
    if (pos < -1.5) pos += N;
    if (Math.abs(pos) <= 1.5) placed.push({ pos, i });
  }
  placed.sort((a, b) => Math.abs(b.pos) - Math.abs(a.pos));
  const items = [];
  for (const { pos, i } of placed) {
    const a = Math.abs(pos);
    const scale = 1 - 0.3 * Math.min(1, a);
    const opacity = a <= 1 ? 1 - 0.4 * a : 0.6 * (1 - (a - 1) / 0.5);
    const tw = Math.max(2, Math.round(ts.w * scale));
    // Side tiles stay opaque (footage must not show through labels) and are dimmed; only tiles
    // entering / leaving fade out.
    const resized = await sharp(tiles[i]).resize({ width: tw }).png().toBuffer();
    const dim = Math.min(0.4, a * 0.4);
    const rs = await size(resized);
    const shaded = dim > 0.01 ? await sharp(resized).composite([{ input: await svgPng(`<svg width="${rs.w}" height="${rs.h}"><rect width="${rs.w}" height="${rs.h}" fill="black" opacity="${dim.toFixed(2)}"/></svg>`), blend: "atop" }]).png().toBuffer() : resized;
    const t = await withOpacity(shaded, a <= 1 ? 1 : opacity / 0.6);
    const s = await size(t);
    items.push({ input: t, left: Math.round(CW / 2 + pos * dx - s.w / 2), top: Math.round((CH - s.h) / 2) });
  }
  return compose(CW, CH, items);
}

// ─── E10 app install ─────────────────────────────────────────────────────────────────────────────

async function appIcon(name: string, img: Buffer | null, c: Canvas, p: Palette): Promise<{ icon: Buffer; shines: Buffer[] }> {
  const S = Math.round(unit(c) * 0.185);
  const pad = Math.round(S * 0.12);
  const T = S + pad * 2;
  const r = S * 0.22;
  const mask = `<svg width="${S}" height="${S}"><rect width="${S}" height="${S}" rx="${r}" fill="white"/></svg>`;
  let face: Buffer;
  if (img) {
    face = await sharp(img).resize({ width: S, height: S, fit: "cover" }).composite([{ input: Buffer.from(mask), blend: "dest-in" }]).png().toBuffer();
  } else {
    // No icon art: the app's initial on a brand gradient.
    const bg = `<svg width="${S}" height="${S}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.look.button}"/><stop offset="1" stop-color="${p.theme === "festive" ? "#146B3A" : "#111111"}"/></linearGradient></defs><rect width="${S}" height="${S}" rx="${r}" fill="url(#g)"/></svg>`;
    const letter = await textPng(`<span foreground="#FFFFFF">${pangoEscape(name.trim()[0]?.toUpperCase() ?? "A")}</span>`, p.look, Math.round(S * 0.55), S);
    const ls = await size(letter);
    face = await compose(S, S, [{ input: letter, left: Math.round((S - ls.w) / 2), top: Math.round((S - ls.h) / 2) }], bg);
  }
  const shadow = await svgPng(`<svg width="${T}" height="${T}"><defs><filter id="b"><feGaussianBlur stdDeviation="${pad * 0.35}"/></filter></defs><rect x="${pad}" y="${pad + pad * 0.3}" width="${S}" height="${S}" rx="${r}" fill="black" opacity="0.45" filter="url(#b)"/></svg>`);
  const icon = await compose(T, T, [{ input: shadow, left: 0, top: 0 }, { input: face, left: pad, top: pad }]);
  const shines: Buffer[] = [];
  for (const f of [0.15, 0.4, 0.65, 0.9]) {
    const x = pad + S * (f * 1.6 - 0.3);
    shines.push(
      await svgPng(
        `<svg width="${T}" height="${T}"><defs><clipPath id="m"><rect x="${pad}" y="${pad}" width="${S}" height="${S}" rx="${r}"/></clipPath><linearGradient id="s" x1="0" x2="1"><stop offset="0" stop-color="white" stop-opacity="0"/><stop offset="0.5" stop-color="white" stop-opacity="0.55"/><stop offset="1" stop-color="white" stop-opacity="0"/></linearGradient></defs>` +
          `<g clip-path="url(#m)"><polygon points="${x},${pad} ${x + S * 0.3},${pad} ${x + S * 0.05},${pad + S} ${x - S * 0.25},${pad + S}" fill="url(#s)"/></g></svg>`,
      ),
    );
  }
  return { icon, shines };
}

/** Two checked benefit lines on a plate. */
async function benefitBlock(lines: string[], c: Canvas, p: Palette): Promise<Buffer> {
  const px = Math.round(unit(c) * 0.036);
  const W = Math.round(unit(c) * 0.555);
  const ck = Math.round(px * 1.1);
  const check = await svgPng(`<svg width="${ck}" height="${ck}"><circle cx="${ck / 2}" cy="${ck / 2}" r="${ck / 2}" fill="${p.theme === "festive" ? "#C8102E" : p.look.button}"/><path d="M${ck * 0.27},${ck * 0.52} L${ck * 0.44},${ck * 0.69} L${ck * 0.74},${ck * 0.33}" fill="none" stroke="white" stroke-width="${Math.max(3, ck * 0.12)}" stroke-linecap="round" stroke-linejoin="round"/></svg>`);
  const rows = [];
  for (const l of lines) {
    const t = await renderMarkup(`<span foreground="${p.plateText}">${pangoEscape(l)}</span>`, { family: p.look.body.family, fontFile: p.look.body.file, size: px, width: W - ck - 80 });
    rows.push(await row([check, t], Math.round(px * 0.45)));
  }
  return onPlate(await column(rows, Math.round(px * 0.45)), 32, Math.round(px * 0.55), p.plate, 26, p.stroke, W);
}

/** Generic store pills (text only — no official badge art). */
async function storeBadges(c: Canvas, p: Palette): Promise<Buffer> {
  const BW = Math.round(unit(c) * 0.25);
  const BH = Math.round(unit(c) * 0.083);
  const one = async (small: string, big: string) => {
    const s = await renderMarkup(`<span foreground="#FFFFFF">${small}</span>`, { family: p.look.body.family, fontFile: p.look.body.file, size: Math.round(BH * 0.2), width: BW });
    const b = await renderMarkup(`<span foreground="#FFFFFF">${big}</span>`, { family: p.look.body.family, fontFile: p.look.body.file, size: Math.round(BH * 0.36), width: BW });
    const col = await column([s, b], 2);
    const cs = await size(col);
    return compose(BW, BH, [{ input: col, left: Math.round((BW - cs.w) / 2), top: Math.round((BH - cs.h) / 2) }], `<svg width="${BW}" height="${BH}"><rect x="1.5" y="1.5" width="${BW - 3}" height="${BH - 3}" rx="${BH * 0.2}" fill="#000000" stroke="#A6A6A6" stroke-width="3"/></svg>`);
  };
  return row([await one("Download on the", "App Store"), await one("GET IT ON", "Google Play")], Math.round(unit(c) * 0.028));
}

// ─── E11 QR ──────────────────────────────────────────────────────────────────────────────────────

const shortUrl = (url: string) => url.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");

/** A white tile: QR (quiet zone 4 modules) with the short URL under it. */
async function qrTile(url: string, c: Canvas, p: Palette): Promise<Buffer> {
  const q = encodeQr(url.trim());
  // Tile side (QR + 4-module quiet zone each side) within 0.345 of the short side — clear of headline and fine print.
  const m = Math.max(3, Math.floor((unit(c) * 0.345) / (q.size + 8)));
  const side = (q.size + 8) * m;
  const rects: string[] = [];
  q.modules.forEach((r, y) => r.forEach((d, x) => d && rects.push(`<rect x="${(x + 4) * m}" y="${(y + 4) * m}" width="${m}" height="${m}"/>`)));
  const qr = await svgPng(`<svg width="${side}" height="${side}" shape-rendering="crispEdges"><rect width="${side}" height="${side}" fill="#FFFFFF"/><g fill="#000000">${rects.join("")}</g></svg>`);
  const label = await renderMarkup(`<span foreground="#111111">${pangoEscape(shortUrl(url))}</span>`, { family: p.look.body.family, fontFile: p.look.body.file, size: Math.round(unit(c) * 0.03), width: side - 20 });
  const ls = await size(label);
  const H = side + ls.h + Math.round(m * 2);
  const st = p.stroke ? ` stroke="${p.stroke}" stroke-width="4"` : "";
  return compose(side, H, [{ input: qr, left: 0, top: 0 }, { input: label, left: Math.round((side - ls.w) / 2), top: side - Math.round(m * 1.5) }], `<svg width="${side}" height="${H}"><rect x="2" y="2" width="${side - 4}" height="${H - 4}" rx="${m * 1.5}" fill="#FFFFFF"${st}/></svg>`);
}

/** Scanner corner brackets around the tile. */
async function scanBrackets(tile: Buffer, color: string): Promise<Buffer> {
  const s = await size(tile);
  const g = Math.round(s.w * 0.05);
  const W = s.w + g * 2;
  const H = s.h + g * 2;
  const L = Math.round(s.w * 0.16);
  const t = Math.max(6, Math.round(s.w * 0.022));
  const o = t / 2;
  const d = [
    `M${o},${L} V${o} H${L}`,
    `M${W - L},${o} H${W - o} V${L}`,
    `M${W - o},${H - L} V${H - o} H${W - L}`,
    `M${L},${H - o} H${o} V${H - L}`,
  ].join(" ");
  return svgPng(`<svg width="${W}" height="${H}"><path d="${d}" fill="none" stroke="${color}" stroke-width="${t}" stroke-linecap="round" stroke-linejoin="round"/></svg>`);
}

// ─── Theme layers ────────────────────────────────────────────────────────────────────────────────

/** A seeded snow + gold sparkle field over the safe box (festive). */
async function snowLayer(c: Canvas): Promise<{ png: Buffer; y: number }> {
  const vertical = isVertical(c);
  const top = vertical ? 300 / 1920 : 0.06;
  const bottom = vertical ? 1205 / 1920 : 0.94;
  const W = Math.round(c.w * 0.94);
  const H = Math.round(c.h * (bottom - top));
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const dots = Array.from({ length: 90 }, () => `<circle cx="${(rnd() * W).toFixed(0)}" cy="${(rnd() * H).toFixed(0)}" r="${(1.5 + rnd() * 3.5).toFixed(1)}" fill="white" opacity="${(0.35 + rnd() * 0.5).toFixed(2)}"/>`);
  const sparkles = Array.from({ length: 14 }, () => {
    const x = rnd() * W;
    const y = rnd() * H;
    const r = 7 + rnd() * 9;
    return `<path d="M${x},${y - r} Q${x},${y} ${x + r},${y} Q${x},${y} ${x},${y + r} Q${x},${y} ${x - r},${y} Q${x},${y} ${x},${y - r} Z" fill="#F5C542" opacity="${(0.6 + rnd() * 0.35).toFixed(2)}"/>`;
  });
  const png = await svgPng(`<svg width="${W}" height="${H}">${dots.join("")}${sparkles.join("")}</svg>`);
  return { png, y: (top + bottom) / 2 };
}

/** Full-frame scrim behind the card (dark: deep shade; festive: warm red vignette). Not readable content. */
async function backdrop(c: Canvas, p: Palette): Promise<Buffer | null> {
  if (p.theme === "dark") {
    return svgPng(`<svg width="${c.w}" height="${c.h}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.35"/><stop offset="0.16" stop-color="#05060A" stop-opacity="0.72"/><stop offset="0.32" stop-color="#05060A" stop-opacity="0.42"/><stop offset="0.48" stop-color="#05060A" stop-opacity="0.3"/><stop offset="0.62" stop-color="#05060A" stop-opacity="0.7"/><stop offset="1" stop-color="#000" stop-opacity="0.4"/></linearGradient></defs><rect width="${c.w}" height="${c.h}" fill="url(#g)"/></svg>`);
  }
  if (p.theme === "festive") {
    return svgPng(`<svg width="${c.w}" height="${c.h}"><defs><radialGradient id="g" cx="0.5" cy="0.42" r="0.75"><stop offset="0.25" stop-color="#3A0008" stop-opacity="0.12"/><stop offset="1" stop-color="#3A0008" stop-opacity="0.72"/></radialGradient></defs><rect width="${c.w}" height="${c.h}" fill="url(#g)"/></svg>`);
  }
  return null;
}

// ─── Templates ───────────────────────────────────────────────────────────────────────────────────

/**
 * The template's layers (logo, fine print and CTA button are drawn by the edit for every template).
 * Returns null when the template's data is missing — the caller falls back to the default close.
 * `durationSec` is the end card's length (timed sequences such as the carousel fit inside it).
 */
export async function endCardLayers(id: EndCardTemplate, data: EndCardData, c: Canvas, look: Look = DEFAULT_STYLE, opts: { durationSec?: number } = {}): Promise<EndCardResult | null> {
  const p = endCardPalette(data.theme, look);
  const body = await templateLayers(id, data, c, p, opts.durationSec ?? 3);
  if (!body) return null;
  const pre: EndCardLayer[] = [];
  const bd = await backdrop(c, p);
  if (bd) pre.push({ png: bd, y: 0.5, delaySec: 0, anim: "fade", role: "backdrop" });
  if (p.theme === "festive") {
    const snow = await snowLayer(c);
    pre.push({ png: snow.png, y: snow.y, delaySec: 0.05, anim: "drift", role: "decor" });
  }
  return { ...body, layers: [...pre, ...body.layers], look: p.look };
}

async function templateLayers(id: EndCardTemplate, data: EndCardData, c: Canvas, p: Palette, durationSec: number): Promise<Omit<EndCardResult, "look"> | null> {
  const s = endCardSlots(c);
  const v = isVertical(c);
  const u = unit(c);
  const cur = data.currency || "$";
  const headline = data.headline?.trim();
  const headPill = (text: string) => pill(text.toUpperCase(), c, { size: Math.round(u * 0.062), fg: p.look.offerText, bg: p.look.offerBg, family: p.look.headline.family, fontFile: p.look.headline.file, widthPct: 0.66 });
  const head = async (y = s.headline): Promise<EndCardLayer[]> => (headline ? [{ png: await headPill(headline), y, delaySec: 0.15, anim: "pop", role: "headline" }] : []);
  switch (id) {
    case "E01":
      return { layers: await head(), hideButton: false };
    case "E02":
      if (!data.pct || data.pct <= 0) return null;
      return { layers: [...(await head()), { png: await badge(data.pct, c, p), y: s.main + 0.012, delaySec: 0.1, anim: "slam", role: "main" }], hideButton: false };
    case "E03":
      if (!data.code?.trim()) return null;
      return {
        layers: [
          { png: await headPill("Your code:"), y: s.headline, delaySec: 0, anim: "pop", role: "headline" },
          { png: await ticket(data.code.trim(), data.pct ? `Extra ${Math.round(data.pct)}% off` : "Coupon", c, p), y: s.main, delaySec: 0.15, anim: "pop", role: "main" },
        ],
        hideButton: false,
      };
    case "E04":
      if (!(data.price && data.comparePrice && data.comparePrice > data.price)) return null;
      return { layers: [...(await head()), { png: await priceCard(data.price, data.comparePrice, cur, c, p), y: s.main + 0.02, delaySec: 0.2, anim: "pop", role: "main" }], hideButton: false };
    case "E05": {
      const deadline = data.deadline?.trim();
      if (!deadline) return null;
      const bar = await urgencyBar(deadline, c, p);
      const offer = headline || (data.pct && data.pct > 0 ? `${Math.round(data.pct)}% off` : null);
      return {
        layers: [
          { png: bar.bar, y: s.headline + (v ? 0.012 : 0), delaySec: 0, anim: "wipe", role: "headline" },
          { png: bar.text, y: s.headline + (v ? 0.012 : 0), delaySec: 0.25, anim: "pop", role: "headline" },
          ...(offer ? [{ png: await headPill(offer), y: v ? 0.487 : 0.6, delaySec: 0.45, anim: "pop" as const, role: "main" as const }] : []),
        ],
        hideButton: false,
      };
    }
    case "E06": {
      if (!data.rating || data.rating <= 0) return null;
      const stars = await starRow(data.rating, c, p);
      const count = data.reviewCount ? `${fmtCount(data.reviewCount)} reviews` : null;
      const quote = data.quote?.trim();
      const layers: EndCardLayer[] = [
        { png: stars.base, y: s.headline - (v ? 0.012 : 0.02), delaySec: 0, anim: "fade", role: "headline" },
        ...stars.fills.map((png, i) => ({ png, y: s.headline - (v ? 0.012 : 0.02), delaySec: 0.08 + i * 0.08, anim: "fade" as const, role: "headline" as const })),
        { png: await onPlate(await ratingLine(data.rating, count, c, p, Math.round(u * 0.036), { star: false, onPlate: true }), Math.round(u * 0.022), Math.round(u * 0.011), p.textPlate ?? p.plate, Math.round(u * 0.03), null), y: s.headline + (v ? 0.036 : 0.085), delaySec: 0.45, anim: "fade", role: "headline" },
      ];
      if (quote) layers.push({ png: await quoteCard(quote, data.quoteBy?.trim() || "Verified buyer", c, p), y: s.main + (v ? 0.02 : 0.08), delaySec: 0.55, anim: "rise", role: "main" });
      else if (headline) layers.push({ png: await headPill(headline), y: s.main + 0.04, delaySec: 0.55, anim: "pop", role: "main" });
      return { layers, hideButton: false };
    }
    case "E07": {
      const valid = (data.skus ?? []).filter((k) => k && k.label?.trim() && (k.imageUrl || k.imagePath)).slice(0, 5);
      if (valid.length < 2) return null;
      const loaded = await Promise.all(valid.map((k) => loadImage({ url: k.imageUrl, path: k.imagePath })));
      const skus = valid.filter((_, i) => loaded[i]);
      const imgs = loaded.filter((b): b is Buffer => !!b);
      if (skus.length < 2) return null;
      const tiles = await Promise.all(skus.map((k, i) => skuTile(imgs[i], k, cur, c, p)));
      const y = s.main + (v ? 0.012 : 0.04);
      const layers: EndCardLayer[] = [...(await head())];
      const N = tiles.length;
      const step = 0.6;
      const t0 = 0.1;
      const shifts = t0 + N * step + 0.8 <= durationSec ? N : 0;
      if (!shifts) {
        layers.push({ png: await carouselFrame(tiles, 0, 0, c), y, delaySec: t0, anim: "pop", role: "main" });
        return { layers, hideButton: false };
      }
      for (let k = 0; k < N; k++) {
        const at = t0 + k * step;
        layers.push({ png: await carouselFrame(tiles, k, 0, c), y, delaySec: at, durSec: step - 0.15, anim: k === 0 ? "pop" : "none", role: "main" });
        layers.push({ png: await carouselFrame(tiles, k, 1 / 3, c), y, delaySec: at + step - 0.15, durSec: 0.075, anim: "none", role: "main" });
        layers.push({ png: await carouselFrame(tiles, k, 2 / 3, c), y, delaySec: at + step - 0.075, durSec: 0.075, anim: "none", role: "main" });
      }
      // Hold on the hero SKU.
      layers.push({ png: await carouselFrame(tiles, 0, 0, c), y, delaySec: t0 + N * step, anim: "none", role: "main" });
      return { layers, hideButton: false };
    }
    case "E08":
      return { layers: [...(await head()), { png: await giftTag(data.tag?.trim() || (data.pct ? `Gift set · save ${Math.round(data.pct)}%` : "The gift they'll use"), c, p), y: s.main - 0.02, delaySec: 0.3, anim: "pop", role: "main" }], hideButton: false };
    case "E09":
      return {
        layers: [
          ...(await head()),
          { png: await pill((data.button || "Tap Shop Now below").toUpperCase(), c, { size: Math.round(u * 0.046), fg: p.look.offerText, bg: p.look.offerBg, family: p.look.headline.family, fontFile: p.look.headline.file, widthPct: 0.62 }), y: v ? 0.523 : 0.62, delaySec: 0.2, anim: "pop", role: "pointer" },
          // Bobs 18 px down from here: bottom stays ≤ 1220 on 9:16.
          { png: await arrow(c, p), y: v ? 0.588 : 0.78, delaySec: 0.3, anim: "bob", role: "pointer" },
        ],
        hideButton: true,
        // The pointer owns the bottom slots; the legal line moves up under the product.
        fineY: v ? 0.475 : 0.5,
      };
    case "E10": {
      const name = data.appName?.trim();
      if (!name) return null;
      const img = await loadImage({ url: data.appIconUrl, path: data.appIconPath });
      const icon = await appIcon(name, img, c, p);
      const Y = v ? { icon: 0.268, name: 0.372, benefits: 0.45, badges: 0.517 } : { icon: 0.2, name: 0.39, benefits: 0.55, badges: 0.645 };
      const extra = data.downloads?.trim() || (data.reviewCount ? `${fmtCount(data.reviewCount)} ratings` : null);
      const benefits = (data.benefits ?? []).map((b) => b.trim()).filter(Boolean).slice(0, 2);
      const layers: EndCardLayer[] = [
        { png: icon.icon, y: Y.icon, delaySec: 0, anim: "pop", role: "main" },
        ...icon.shines.map((png, i) => ({ png, y: Y.icon, delaySec: 0.4 + i * 0.06, durSec: 0.06, anim: "none" as const, role: "decor" as const })),
      ];
      const nameTxt = await textPng(`<span foreground="${p.plateText}">${pangoEscape(name)}</span>`, p.look, Math.round(u * 0.05), u * 0.5);
      const info = data.rating && data.rating > 0 ? await column([nameTxt, await ratingLine(data.rating, extra, c, p, Math.round(u * 0.03), { onPlate: true })], Math.round(u * 0.006)) : nameTxt;
      layers.push({ png: await onPlate(info, Math.round(u * 0.04), Math.round(u * 0.018), p.plate, Math.round(u * 0.03), p.stroke), y: Y.name, delaySec: 0.2, anim: "fade", role: "headline" });
      if (benefits.length) layers.push({ png: await benefitBlock(benefits, c, p), y: Y.benefits, delaySec: 0.5, anim: "rise", role: "main" });
      layers.push({ png: await storeBadges(c, p), y: Y.badges, delaySec: 0.65, anim: "rise", role: "main" });
      return { layers, hideButton: false };
    }
    case "E11": {
      const url = data.url?.trim();
      if (!url || !/^(https?:\/\/)?[^\s/]+\.[^\s]+/i.test(url)) return null;
      const tile = await qrTile(url, c, p);
      const header = data.pct && data.pct > 0 ? `Scan for ${Math.round(data.pct)}% off` : "Scan to shop";
      return {
        layers: [
          { png: await headPill(header), y: s.headline, delaySec: 0.1, anim: "pop", role: "headline" },
          { png: tile, y: s.main + (v ? 0.005 : 0.06), delaySec: 0, anim: "pop", role: "main" },
          { png: await scanBrackets(tile, p.theme === "light" ? p.look.button : p.look.highlight), y: s.main + (v ? 0.005 : 0.06), delaySec: 0.3, anim: "pulse", role: "decor" },
        ],
        hideButton: false,
      };
    }
    case "E12":
      return { layers: [{ png: await sticker(data.sticker?.trim() || "ok go get one before they sell out 🛒", c, p), y: s.main + 0.06, delaySec: 0.1, anim: "pop", role: "main" }], hideButton: true };
  }
}

// ─── ffmpeg ──────────────────────────────────────────────────────────────────────────────────────

/** Animations that scale / fade the layer's own stream and so need a looping PNG input. */
const SELF_ANIMATED = new Set<LayerAnim>(["pop", "slam", "pulse", "wipe", "fade"]);

/**
 * ffmpeg input args for an overlay PNG. A plain `-i x.png` is ONE frame: a filter on it is evaluated
 * once at t = 0 (a pop layer would freeze at its t = 0 scale — a 2 px sliver). Self-animated layers
 * loop for the length of the video so their filters see time advance.
 */
export function layerInputArgs(file: string, anim: LayerAnim | undefined, totalSec: number): string[] {
  return anim && SELF_ANIMATED.has(anim) ? ["-loop", "1", "-framerate", "30", "-t", totalSec.toFixed(3), "-i", file] : ["-i", file];
}

/**
 * ffmpeg overlay for an animated layer on input [k]: scale / fade envelopes are applied to the layer
 * itself (pop / slam / pulse / wipe / fade) and positions to the overlay (bounce / bob / rise / drift).
 * Times are absolute (the looped PNG input runs from t = 0).
 */
export function layerFilter(k: number, anim: LayerAnim, y: number, t0: number, t1: number, from: string, to: string): string[] {
  const T = t0.toFixed(3);
  const enable = `enable='between(t,${T},${t1.toFixed(3)})'`;
  const scaleExpr =
    anim === "pop" ? `if(lt(t,${T}+0.18),0.6+0.48*(t-${T})/0.18,if(lt(t,${T}+0.28),1.08-0.8*(t-${T}-0.18),1))`
    : anim === "slam" ? `1+1.2*exp(-12*max(0,t-${T}))*cos(14*max(0,t-${T}))`
    : anim === "pulse" ? `1+0.05*sin(2*PI*1.6*max(0,t-${T}))`
    : null;
  const yExpr =
    anim === "bounce" ? `'H*${y}-h/2-H*0.09*abs(cos(2*PI*1.6*(t-${T})))*exp(-3.2*(t-${T}))'`
    : anim === "bob" ? `'H*${y}-h/2+18*abs(sin(2*PI*(t-${T})))'`
    : anim === "rise" ? `'H*${y}-h/2+60*pow(max(0,1-(t-${T})/0.35),2)'`
    : anim === "drift" ? `'H*${y}-h/2+8*sin(2*PI*0.4*(t-${T}))'`
    : `'H*${y}-h/2'`;
  if (scaleExpr) {
    return [
      // Clamped: before t0 the envelope runs negative (the layer is disabled then, but scale still runs).
      `[${k}:v]format=rgba,scale=w='max(2,trunc(iw*max(0.1,${scaleExpr})/2)*2)':h=-2:eval=frame[ly${k}]`,
      `${from}[ly${k}]overlay=x=(W-w)/2:y=${yExpr}:eval=frame:${enable}${to}`,
    ];
  }
  if (anim === "wipe") {
    // The bar grows out from its centre over 0.3 s (height fixed).
    return [
      `[${k}:v]format=rgba,scale=w='max(2,trunc(iw*min(1,max(0.02,(t-${T})/0.3))/2)*2)':h=ih:eval=frame[ly${k}]`,
      `${from}[ly${k}]overlay=x=(W-w)/2:y=${yExpr}:eval=frame:${enable}${to}`,
    ];
  }
  if (anim === "fade") {
    return [`[${k}:v]format=rgba,fade=t=in:st=${T}:d=0.25:alpha=1[ly${k}]`, `${from}[ly${k}]overlay=x=(W-w)/2:y=${yExpr}:eval=init:${enable}${to}`];
  }
  return [`${from}[${k}:v]overlay=x=(W-w)/2:y=${yExpr}:eval=frame:${enable}${to}`];
}
