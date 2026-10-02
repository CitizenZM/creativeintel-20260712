/**
 * On-screen text for the v2 edit, drawn with sharp (pango) as transparent PNGs
 * and overlaid by ffmpeg (the Vercel ffmpeg build has no drawtext):
 *
 *   kinetic caption  2–3 words at a time, the spoken word highlighted —
 *                    readable with the sound off, which is how most feeds play
 *   hook headline    big Anton, top third, only during the hook
 *   claim chip       a short spec/benefit the voiceover doesn't already say
 *   offer card       black on yellow, on the end card
 *   CTA button       a pill that lands on a beat with a click
 *
 * All text sits inside the platform safe zone (top 14 % / bottom 20 % clear).
 */
import { ensureFontconfig, pangoEscape } from "../glm-assemble";
import { DEFAULT_STYLE, type BrandStyle } from "./brand-style";


type Canvas = { w: number; h: number };

/** Type scales with the frame's short side, so 4:5 / 1:1 / 16:9 exports read like the 9:16 master. */
const unit = (c: Canvas) => Math.min(c.w, c.h);

async function sharpLib() {
  return (await import("sharp")).default;
}

async function renderMarkup(markup: string, opts: { family: string; fontFile: string; size: number; width: number }): Promise<Buffer> {
  await ensureFontconfig(opts.fontFile);
  const sharp = await sharpLib();
  return sharp({
    text: {
      text: markup,
      font: `${opts.family} ${opts.size}`,
      fontfile: opts.fontFile,
      width: opts.width,
      align: "centre",
      rgba: true,
      dpi: 72,
      spacing: Math.round(opts.size * 0.15),
    },
  })
    .png()
    .toBuffer();
}

/** Text with a soft dark shadow underneath (no box), for captions over footage. */
async function shadowed(markup: string, plainMarkup: string, opts: { family: string; fontFile: string; size: number; width: number }): Promise<Buffer> {
  const sharp = await sharpLib();
  const fg = await renderMarkup(markup, opts);
  const sh = await renderMarkup(plainMarkup, opts);
  const { width = 1, height = 1 } = await sharp(fg).metadata();
  const pad = Math.round(opts.size * 0.4);
  const blurred = await sharp(sh).blur(Math.max(2, opts.size * 0.09)).toBuffer();
  return sharp({ create: { width: width + pad * 2, height: height + pad * 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: blurred, top: pad + Math.round(opts.size * 0.05), left: pad },
      { input: blurred, top: pad + Math.round(opts.size * 0.05), left: pad },
      { input: fg, top: pad, left: pad },
    ])
    .png()
    .toBuffer();
}

type Look = Pick<BrandStyle, "highlight" | "button" | "buttonText" | "offerBg" | "offerText" | "headline" | "body">;

/** One state of a kinetic caption: the group's words, word `active` highlighted. */
export function kineticCaptionPng(words: string[], active: number, canvas: Canvas, look: Look = DEFAULT_STYLE): Promise<Buffer> {
  const size = Math.round(unit(canvas) * 0.074);
  const markup = words
    .map((w, i) => `<span foreground="${i === active ? look.highlight : "white"}">${pangoEscape(w.toUpperCase())}</span>`)
    .join(" ");
  const plain = `<span foreground="black">${pangoEscape(words.join(" ").toUpperCase())}</span>`;
  return shadowed(markup, plain, { family: look.body.family, fontFile: look.body.file, size, width: Math.round(canvas.w * 0.86) });
}

/** The hook headline: big headline face, last word highlighted. */
export function hookHeadlinePng(text: string, canvas: Canvas, look: Look = DEFAULT_STYLE): Promise<Buffer> {
  const size = Math.round(unit(canvas) * 0.092);
  const w = text.trim().split(/\s+/);
  const last = w.pop() ?? "";
  const markup = `<span foreground="white">${pangoEscape(w.join(" ").toUpperCase())}</span>${w.length ? " " : ""}<span foreground="${look.highlight}">${pangoEscape(last.toUpperCase())}</span>`;
  const plain = `<span foreground="black">${pangoEscape(text.toUpperCase())}</span>`;
  return shadowed(markup, plain, { family: look.headline.family, fontFile: look.headline.file, size, width: Math.round(canvas.w * 0.84) });
}

/** A pill: text on a rounded rectangle. */
async function pill(text: string, canvas: Canvas, style: { size: number; fg: string; bg: string; family: string; fontFile: string; widthPct: number }): Promise<Buffer> {
  const sharp = await sharpLib();
  const fg = await renderMarkup(`<span foreground="${style.fg}">${pangoEscape(text)}</span>`, {
    family: style.family,
    fontFile: style.fontFile,
    size: style.size,
    width: Math.round(canvas.w * style.widthPct),
  });
  const { width = 1, height = 1 } = await sharp(fg).metadata();
  const padX = Math.round(style.size * 0.7);
  const padY = Math.round(style.size * 0.35);
  const W = width + padX * 2;
  const H = height + padY * 2;
  const r = Math.min(H / 2, style.size * 0.9);
  const rect = Buffer.from(`<svg width="${W}" height="${H}"><rect x="0" y="0" width="${W}" height="${H}" rx="${r}" ry="${r}" fill="${style.bg}"/></svg>`);
  return sharp(rect)
    .composite([{ input: fg, top: padY, left: padX }])
    .png()
    .toBuffer();
}

/** A short claim ("2,100+ dimming zones"): white on a translucent dark pill. */
export function claimChipPng(text: string, canvas: Canvas, look: Look = DEFAULT_STYLE): Promise<Buffer> {
  return pill(text, canvas, { size: Math.round(unit(canvas) * 0.05), fg: "white", bg: "rgba(0,0,0,0.62)", family: look.body.family, fontFile: look.body.file, widthPct: 0.8 });
}

/** The offer on the end card, on the brand's accent. */
export function offerCardPng(text: string, canvas: Canvas, look: Look = DEFAULT_STYLE): Promise<Buffer> {
  return pill(text.toUpperCase(), canvas, { size: Math.round(unit(canvas) * 0.075), fg: look.offerText, bg: look.offerBg, family: look.headline.family, fontFile: look.headline.file, widthPct: 0.8 });
}

/** The CTA button that lands on a beat. */
export function ctaButtonPng(text: string, canvas: Canvas, look: Look = DEFAULT_STYLE): Promise<Buffer> {
  return pill(`${text.toUpperCase()}  ›`, canvas, { size: Math.round(unit(canvas) * 0.058), fg: look.buttonText, bg: look.button, family: look.body.family, fontFile: look.body.file, widthPct: 0.7 });
}

/** A comparison label: ours on the brand accent, the other side on a neutral dark pill. */
export function comparisonLabelPng(text: string, canvas: Canvas, look: Look = DEFAULT_STYLE, ours = true): Promise<Buffer> {
  return pill(text.toUpperCase(), canvas, {
    size: Math.round(unit(canvas) * 0.05),
    fg: ours ? look.buttonText : "#FFFFFF",
    bg: ours ? look.button : "rgba(40,40,40,0.85)",
    family: look.body.family,
    fontFile: look.body.file,
    widthPct: 0.6,
  });
}

/** The landing domain under the button, small. */
export function domainPng(domain: string, canvas: Canvas, look: Look = DEFAULT_STYLE): Promise<Buffer> {
  const size = Math.round(unit(canvas) * 0.034);
  return shadowed(`<span foreground="white">${pangoEscape(domain)}</span>`, `<span foreground="black">${pangoEscape(domain)}</span>`, {
    family: look.body.family,
    fontFile: look.body.file,
    size,
    width: Math.round(canvas.w * 0.8),
  });
}

/** The brand logo for the end card, fitted to a box on a soft dark plate so a light logo reads on any frame. */
export async function logoPng(url: string, canvas: Canvas): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const sharp = await sharpLib();
    const boxW = Math.round(unit(canvas) * 0.34);
    const boxH = Math.round(unit(canvas) * 0.12);
    return await sharp(Buffer.from(await res.arrayBuffer()))
      .resize({ width: boxW, height: boxH, fit: "inside", withoutEnlargement: false })
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}
