/**
 * End-card templates (library: services/creative/library.ts END_CARDS) rendered as PNG layers for the
 * v2 edit. Every readable layer sits in a fixed slot inside the strict 9:16 safe box (y 288–1220):
 *   LOGO .17 · HEADLINE .22 · MAIN .40 (badge / ticket / price / gift tag / sticker) · FINE .555 · BUTTON .607
 * Facts on a card (discount, price, code) are only drawn when the caller supplies them — the creative
 * selector refuses templates whose facts are missing or stale.
 */
import sharp from "sharp";
import { pangoEscape } from "../glm-assemble";
import { DEFAULT_STYLE } from "./brand-style";
import { pill, renderMarkup, type Look } from "./text-layers";

type Canvas = { w: number; h: number };

export type EndCardTemplate = "E01" | "E02" | "E03" | "E04" | "E08" | "E09" | "E12";
export const RENDERABLE_END_CARDS: EndCardTemplate[] = ["E01", "E02", "E03", "E04", "E08", "E09", "E12"];

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
}

export type LayerAnim = "none" | "pop" | "slam" | "pulse" | "bob" | "bounce";

export interface EndCardLayer {
  png: Buffer;
  /** Vertical centre as a share of the frame height. */
  y: number;
  /** Seconds after the end card starts. */
  delaySec: number;
  anim: LayerAnim;
  role: "headline" | "main" | "button" | "pointer";
}

/** Slots on a vertical canvas; landscape / square exports keep the classic spacing. */
export function endCardSlots(c: Canvas) {
  const vertical = c.h / c.w > 1.5;
  return vertical
    ? { logo: 0.17, headline: 0.22, main: 0.4, fine: 0.555, button: 0.607, caption: 0.6 }
    : { logo: 0.1, headline: 0.22, main: 0.45, fine: 0.9, button: 0.74, caption: 0.7 };
}

const unit = (c: Canvas) => Math.min(c.w, c.h);
const money = (v: number, cur = "$") => `${cur}${v % 1 === 0 ? v.toFixed(0) : v.toFixed(2)}`;

async function textPng(markup: string, look: Look, size: number, width: number, headline = true): Promise<Buffer> {
  const face = headline ? look.headline : look.body;
  return renderMarkup(markup, { family: face.family, fontFile: face.file, size, width });
}

async function onShape(svg: string, layers: { input: Buffer; top: number; left: number }[]): Promise<Buffer> {
  return sharp(Buffer.from(svg)).composite(layers).png().toBuffer();
}

async function centreOn(bg: Buffer, fg: Buffer, dy = 0): Promise<{ input: Buffer; top: number; left: number }> {
  const a = await sharp(bg).metadata();
  const b = await sharp(fg).metadata();
  return { input: fg, top: Math.max(0, Math.round(((a.height ?? 0) - (b.height ?? 0)) / 2 + dy)), left: Math.max(0, Math.round(((a.width ?? 0) - (b.width ?? 0)) / 2)) };
}

/** E02 — a 12-point starburst carrying "−30%" + "OFF". */
async function badge(pct: number, c: Canvas, look: Look): Promise<Buffer> {
  const R = Math.round(unit(c) * 0.21);
  const pts = Array.from({ length: 24 }, (_, i) => {
    const r = i % 2 ? R * 0.84 : R;
    const a = (Math.PI * 2 * i) / 24 - Math.PI / 2;
    return `${(R + r * Math.cos(a)).toFixed(1)},${(R + r * Math.sin(a)).toFixed(1)}`;
  }).join(" ");
  const svg = `<svg width="${R * 2}" height="${R * 2}"><g transform="rotate(-8 ${R} ${R})"><polygon points="${pts}" fill="${look.offerBg}" stroke="white" stroke-width="${Math.round(R * 0.04)}"/></g></svg>`;
  const big = await textPng(`<span foreground="${look.offerText}">−${Math.round(pct)}%</span>`, look, Math.round(R * 0.5), R * 2);
  const off = await textPng(`<span foreground="${look.offerText}">OFF</span>`, look, Math.round(R * 0.2), R * 2);
  const bg = Buffer.from(svg);
  return onShape(svg, [await centreOn(bg, big, -R * 0.1), await centreOn(bg, off, R * 0.36)]);
}

/** E03 — a white ticket with notched sides, a perforation and the code. */
async function ticket(code: string, stub: string, c: Canvas, look: Look): Promise<Buffer> {
  const W = Math.round(c.w * 0.58);
  const H = Math.round(W * 0.42);
  const n = Math.round(H * 0.16);
  const stubW = Math.round(W * 0.34);
  const svg = `<svg width="${W}" height="${H}"><path d="M0,0 H${W} V${H / 2 - n} A${n},${n} 0 0 0 ${W},${H / 2 + n} V${H} H0 V${H / 2 + n} A${n},${n} 0 0 0 0,${H / 2 - n} Z" fill="white"/><line x1="${stubW}" y1="${H * 0.1}" x2="${stubW}" y2="${H * 0.9}" stroke="#BBBBBB" stroke-width="4" stroke-dasharray="12,10"/></svg>`;
  const stubTxt = await textPng(`<span foreground="${look.button}">${pangoEscape(stub.toUpperCase())}</span>`, look, Math.round(H * 0.11), stubW - n * 2 - 16);
  const codeTxt = await textPng(`<span foreground="#111111">${pangoEscape(code.toUpperCase())}</span>`, look, Math.round(H * 0.3), W - stubW - 30);
  const sm = await sharp(stubTxt).metadata();
  const cm = await sharp(codeTxt).metadata();
  return onShape(svg, [
    { input: stubTxt, top: Math.round((H - (sm.height ?? 0)) / 2), left: Math.round(n + 8 + (stubW - n - 8 - (sm.width ?? 0)) / 2) },
    { input: codeTxt, top: Math.round((H - (cm.height ?? 0)) / 2), left: stubW + Math.round((W - stubW - (cm.width ?? 0)) / 2) },
  ]);
}

/** E04 — old price struck through in red, the new price big, a "Save $X" chip, on a dark plate. */
async function priceCard(price: number, compare: number, cur: string, c: Canvas, look: Look): Promise<Buffer> {
  const oldTxt = await textPng(`<span foreground="#B8B8B8">${money(compare, cur)}</span>`, look, Math.round(unit(c) * 0.07), c.w, true);
  const newTxt = await textPng(`<span foreground="${look.highlight}">${money(price, cur)}</span>`, look, Math.round(unit(c) * 0.14), c.w, true);
  const chip = await pill(`SAVE ${money(Math.round(compare - price), cur)}`, c, { size: Math.round(unit(c) * 0.04), fg: look.offerText, bg: look.offerBg, family: look.body.family, fontFile: look.body.file, widthPct: 0.5 });
  const [om, nm, cm] = await Promise.all([oldTxt, newTxt, chip].map((b) => sharp(b).metadata()));
  const W = Math.round(c.w * 0.7);
  const H = (om.height ?? 0) + (nm.height ?? 0) + (cm.height ?? 0) + 70;
  const svg = `<svg width="${W}" height="${H}"><rect width="${W}" height="${H}" rx="36" fill="rgba(0,0,0,0.62)"/></svg>`;
  const ox = Math.round((W - (om.width ?? 0)) / 2);
  const oy = 20;
  const strikeSvg = Buffer.from(`<svg width="${(om.width ?? 0) + 20}" height="${om.height ?? 0}"><line x1="0" y1="${(om.height ?? 0) * 0.55}" x2="${(om.width ?? 0) + 20}" y2="${(om.height ?? 0) * 0.45}" stroke="#E5322D" stroke-width="${Math.max(6, Math.round(unit(c) * 0.008))}"/></svg>`);
  return onShape(svg, [
    { input: oldTxt, top: oy, left: ox },
    { input: await sharp(strikeSvg).png().toBuffer(), top: oy, left: Math.max(0, ox - 10) },
    { input: newTxt, top: oy + (om.height ?? 0) + 10, left: Math.round((W - (nm.width ?? 0)) / 2) },
    { input: chip, top: oy + (om.height ?? 0) + (nm.height ?? 0) + 25, left: Math.round((W - (cm.width ?? 0)) / 2) },
  ]);
}

/** E08 — a kraft gift tag with a punched hole and string. */
async function giftTag(text: string, c: Canvas, look: Look): Promise<Buffer> {
  const W = Math.round(c.w * 0.46);
  const H = Math.round(W * 0.62);
  const svg = `<svg width="${W}" height="${H + 40}"><path d="M${W * 0.5},0 L${W * 0.5},40" stroke="#8C6A43" stroke-width="5"/><path d="M${H * 0.3},40 H${W} V${H + 40} H${H * 0.3} L0,${40 + H / 2} Z" fill="#C9A06A" stroke="#8C6A43" stroke-width="4"/><circle cx="${H * 0.3}" cy="${40 + H / 2}" r="${H * 0.07}" fill="#7A5A35"/></svg>`;
  const t = await textPng(`<span foreground="#3B2A16">${pangoEscape(text)}</span>`, look, Math.round(H * 0.17), Math.round(W * 0.66));
  const tm = await sharp(t).metadata();
  return onShape(svg, [{ input: t, top: 40 + Math.round((H - (tm.height ?? 0)) / 2), left: Math.round(H * 0.3 + (W - H * 0.3 - (tm.width ?? 0)) / 2) }]);
}

/** E09 — a down arrow that bobs toward the platform's own CTA. */
async function arrow(c: Canvas, look: Look): Promise<Buffer> {
  const W = Math.round(unit(c) * 0.11);
  const H = Math.round(W * 1.2);
  return sharp(Buffer.from(`<svg width="${W}" height="${H}"><path d="M${W * 0.32},0 H${W * 0.68} V${H * 0.55} H${W} L${W / 2},${H} L0,${H * 0.55} H${W * 0.32} Z" fill="${look.button}" stroke="white" stroke-width="5"/></svg>`)).png().toBuffer();
}

/** E12 — a native, creator-style white sticker with black text. */
async function sticker(text: string, c: Canvas, look: Look): Promise<Buffer> {
  return pill(text, c, { size: Math.round(unit(c) * 0.05), fg: "#111111", bg: "white", family: look.body.family, fontFile: look.body.file, widthPct: 0.7 });
}

/**
 * The template's layers (logo and fine print are drawn by the edit for every template).
 * Returns null when the template's facts are missing — the caller falls back to E01.
 */
export async function endCardLayers(id: EndCardTemplate, data: EndCardData, c: Canvas, look: Look = DEFAULT_STYLE): Promise<{ layers: EndCardLayer[]; hideButton: boolean; fineY?: number } | null> {
  const s = endCardSlots(c);
  const cur = data.currency || "$";
  const headline = data.headline?.trim();
  const head = async (): Promise<EndCardLayer[]> =>
    headline ? [{ png: await pill(headline.toUpperCase(), c, { size: Math.round(unit(c) * 0.062), fg: look.offerText, bg: look.offerBg, family: look.headline.family, fontFile: look.headline.file, widthPct: 0.8 }), y: s.headline, delaySec: 0.15, anim: "pop", role: "headline" }] : [];
  switch (id) {
    case "E01":
      return { layers: await head(), hideButton: false };
    case "E02":
      if (!data.pct || data.pct <= 0) return null;
      return { layers: [...(await head()), { png: await badge(data.pct, c, look), y: s.main, delaySec: 0.1, anim: "slam", role: "main" }], hideButton: false };
    case "E03":
      if (!data.code?.trim()) return null;
      return {
        layers: [
          { png: await textPng(`<span foreground="white">YOUR CODE:</span>`, look, Math.round(unit(c) * 0.055), c.w), y: s.headline, delaySec: 0, anim: "pop", role: "headline" },
          { png: await ticket(data.code.trim(), data.pct ? `Extra ${Math.round(data.pct)}% off` : "Coupon", c, look), y: s.main, delaySec: 0.15, anim: "pop", role: "main" },
        ],
        hideButton: false,
      };
    case "E04":
      if (!(data.price && data.comparePrice && data.comparePrice > data.price)) return null;
      return { layers: [...(await head()), { png: await priceCard(data.price, data.comparePrice, cur, c, look), y: s.main + 0.04, delaySec: 0.2, anim: "pop", role: "main" }], hideButton: false };
    case "E08":
      return { layers: [...(await head()), { png: await giftTag(data.tag?.trim() || (data.pct ? `Gift set · save ${Math.round(data.pct)}%` : "The gift they'll use"), c, look), y: s.main - 0.04, delaySec: 0.3, anim: "bounce", role: "main" }], hideButton: false };
    case "E09":
      return {
        layers: [
          ...(await head()),
          { png: await textPng(`<span foreground="white">${pangoEscape((data.button || "Tap Shop Now below").toUpperCase())}</span>`, look, Math.round(unit(c) * 0.055), Math.round(c.w * 0.8)), y: 0.565, delaySec: 0.2, anim: "pop", role: "pointer" },
          { png: await arrow(c, look), y: 0.612, delaySec: 0.3, anim: "bob", role: "pointer" },
        ],
        hideButton: true,
        // The pointer owns the bottom slots; the legal line moves up under the product.
        fineY: 0.52,
      };
    case "E12":
      return { layers: [{ png: await sticker(data.sticker?.trim() || "ok go get one before they sell out 🛒", c, look), y: s.main + 0.06, delaySec: 0.1, anim: "pop", role: "main" }], hideButton: true };
  }
}

/**
 * ffmpeg overlay for an animated layer on input [k]: scale envelopes are applied to the layer itself
 * (pop / slam / pulse) and positions to the overlay (bounce / bob). Times are absolute (the looped PNG
 * input runs from t = 0).
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
    : `'H*${y}-h/2'`;
  if (scaleExpr) {
    return [
      `[${k}:v]format=rgba,scale=w='max(2,trunc(iw*(${scaleExpr})/2)*2)':h=-2:eval=frame[ly${k}]`,
      `${from}[ly${k}]overlay=x=(W-w)/2:y=${yExpr}:eval=frame:${enable}${to}`,
    ];
  }
  return [`${from}[${k}:v]overlay=x=(W-w)/2:y=${yExpr}:eval=frame:${enable}${to}`];
}
