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
import { CAPTION_FONT, ensureFontconfig, pangoEscape, SUBTITLE_FONT } from "../glm-assemble";

export const HIGHLIGHT = "#FFD400";

type Canvas = { w: number; h: number };

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

/** One state of a kinetic caption: the group's words, word `active` highlighted. */
export function kineticCaptionPng(words: string[], active: number, canvas: Canvas): Promise<Buffer> {
  const size = Math.round(canvas.w * 0.074);
  const markup = words
    .map((w, i) => `<span foreground="${i === active ? HIGHLIGHT : "white"}">${pangoEscape(w.toUpperCase())}</span>`)
    .join(" ");
  const plain = `<span foreground="black">${pangoEscape(words.join(" ").toUpperCase())}</span>`;
  return shadowed(markup, plain, { family: "Montserrat Bold", fontFile: SUBTITLE_FONT, size, width: Math.round(canvas.w * 0.86) });
}

/** The hook headline: big Anton, last word highlighted. */
export function hookHeadlinePng(text: string, canvas: Canvas): Promise<Buffer> {
  const size = Math.round(canvas.w * 0.092);
  const w = text.trim().split(/\s+/);
  const last = w.pop() ?? "";
  const markup = `<span foreground="white">${pangoEscape(w.join(" ").toUpperCase())}</span>${w.length ? " " : ""}<span foreground="${HIGHLIGHT}">${pangoEscape(last.toUpperCase())}</span>`;
  const plain = `<span foreground="black">${pangoEscape(text.toUpperCase())}</span>`;
  return shadowed(markup, plain, { family: "Anton", fontFile: CAPTION_FONT, size, width: Math.round(canvas.w * 0.84) });
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
export function claimChipPng(text: string, canvas: Canvas): Promise<Buffer> {
  return pill(text, canvas, { size: Math.round(canvas.w * 0.05), fg: "white", bg: "rgba(0,0,0,0.62)", family: "Montserrat Bold", fontFile: SUBTITLE_FONT, widthPct: 0.8 });
}

/** The offer on the end card: black Anton on the highlight colour. */
export function offerCardPng(text: string, canvas: Canvas): Promise<Buffer> {
  return pill(text.toUpperCase(), canvas, { size: Math.round(canvas.w * 0.075), fg: "#111111", bg: HIGHLIGHT, family: "Anton", fontFile: CAPTION_FONT, widthPct: 0.8 });
}

/** The CTA button that lands on a beat. */
export function ctaButtonPng(text: string, canvas: Canvas): Promise<Buffer> {
  return pill(`${text.toUpperCase()}  ›`, canvas, { size: Math.round(canvas.w * 0.058), fg: "white", bg: "#E4002B", family: "Montserrat Bold", fontFile: SUBTITLE_FONT, widthPct: 0.7 });
}
