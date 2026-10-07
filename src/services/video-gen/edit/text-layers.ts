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
 * All readable text sits inside the strict safe box on 9:16 (y 288–1220: TikTok, Reels and Shorts reserve the
 * bottom ~35 % and the top ~15 %); see services/creative/library.ts SAFE_BOX.
 */
import { ensureFontconfig, pangoEscape } from "../glm-assemble";
import { DEFAULT_STYLE, type BrandStyle } from "./brand-style";
import { joinTokens, sepBetween } from "../voiceover";
import { NATIVE_CAPTION, nativeSafeBox } from "./caption-style";

/** Arabic / Hebrew text: a leading RLM makes the paragraph right-to-left even when it opens on a Latin brand name. */
const RTL_TEXT = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
export const withBaseDirection = (markup: string) => (RTL_TEXT.test(markup) ? `\u200F${markup}` : markup);


/** `safeW`: the platform safe box's width (safe-layout.ts) — every wrap width stays inside it. */
type Canvas = { w: number; h: number; safeW?: number };

/** Wrap width for a layer: `pct` of the frame, capped by the safe width minus the layer's own padding on both sides. */
export function wrapWidth(c: Canvas, pct: number, pad: number): number {
  const w = Math.round(c.w * pct);
  return Math.max(10, c.safeW ? Math.min(w, Math.round(c.safeW - 2 * pad)) : w);
}

/**
 * Type size that keeps `markup` within `maxLines` at `width`: a long line wraps first, then the type
 * steps down (to 60 % at most) instead of growing a tall block.
 */
export async function fittedSize(markup: string, opts: { family: string; fontFile: string; size: number; width: number }, maxLines: number): Promise<number> {
  const sharp = await sharpLib();
  let size = opts.size;
  for (let i = 0; i < 5; i++) {
    const [all, one] = await Promise.all([renderMarkup(markup, { ...opts, size }), renderMarkup("<span>Ag</span>", { ...opts, size })]);
    const h = (await sharp(all).metadata()).height ?? 0;
    const h1 = (await sharp(one).metadata()).height ?? 1;
    const gap = Math.round(size * 0.15);
    const lines = Math.round((h + gap) / (h1 + gap));
    if (lines <= maxLines || size <= opts.size * 0.6) break;
    size = Math.max(Math.round(opts.size * 0.6), Math.round(size * 0.88));
  }
  return size;
}

/** Type scales with the frame's short side, so 4:5 / 1:1 / 16:9 exports read like the 9:16 master. */
const unit = (c: Canvas) => Math.min(c.w, c.h);

async function sharpLib() {
  return (await import("sharp")).default;
}

export async function renderMarkup(markup: string, opts: { family: string; fontFile: string; size: number; width: number; spacing?: number }): Promise<Buffer> {
  await ensureFontconfig(opts.fontFile);
  const sharp = await sharpLib();
  return sharp({
    text: {
      text: withBaseDirection(markup),
      font: `${opts.family} ${opts.size}`,
      fontfile: opts.fontFile,
      width: opts.width,
      align: "centre",
      rgba: true,
      dpi: 72,
      spacing: Math.round(opts.size * (opts.spacing ?? 0.15)),
    },
  })
    .png()
    .toBuffer();
}

/** Text with a soft dark shadow underneath (no box), for captions over footage. */
export async function shadowed(markup: string, plainMarkup: string, opts: { family: string; fontFile: string; size: number; width: number }): Promise<Buffer> {
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

export type Look = Pick<BrandStyle, "highlight" | "button" | "buttonText" | "offerBg" | "offerText" | "headline" | "body">;

/** One state of a kinetic caption: the group's words, word `active` highlighted. */
export function kineticCaptionPng(words: string[], active: number, canvas: Canvas, look: Look = DEFAULT_STYLE): Promise<Buffer> {
  const size = Math.round(unit(canvas) * 0.074);
  // CJK tokens join without spaces (joinTokens); everything else word by word.
  const markup = words
    .map((w, i) => `${i ? sepBetween(words[i - 1], w) : ""}<span foreground="${i === active ? look.highlight : "white"}">${pangoEscape(w.toUpperCase())}</span>`)
    .join("");
  const plain = `<span foreground="black">${pangoEscape(joinTokens(words).toUpperCase())}</span>`;
  const width = wrapWidth(canvas, 0.86, Math.round(size * 0.4));
  const opts = { family: look.body.family, fontFile: look.body.file, size, width };
  // A caption is a 2–3 word phrase: in a safe box it steps its type down to stay on one line.
  return (canvas.safeW ? fittedSize(plain, opts, 1) : Promise.resolve(size)).then((s) => shadowed(markup, plain, { ...opts, size: s }));
}

/**
 * One state of a creator-native caption (TikTok / Reels look): white bold sentence-case words with a
 * solid black stroke, the spoken word in the platform yellow, at most two lines inside the safe width.
 * The stroke is the black text stamped around a circle under the fill (pango has no outline).
 */
export async function nativeCaptionPng(words: string[], active: number, canvas: Canvas, look: Look = DEFAULT_STYLE): Promise<Buffer> {
  const sharp = await sharpLib();
  const box = nativeSafeBox(canvas);
  const markup = (color: (i: number) => string) =>
    words.map((w, i) => `${i ? sepBetween(words[i - 1], w) : ""}<span foreground="${color(i)}">${pangoEscape(w)}</span>`).join("");
  let size = Math.round(unit(canvas) * 0.064);
  let stroke = 0;
  // Looser leading than the kinetic caption: two stroked lines must not touch.
  let opts = { family: look.body.family, fontFile: look.body.file, size, width: 1, spacing: 0.32 };
  let fg: Buffer = Buffer.alloc(0);
  for (let attempt = 0; attempt < 5; attempt++) {
    stroke = Math.max(3, Math.round(size * 0.1));
    opts = { ...opts, size, width: box.x1 - box.x0 - 2 * (stroke + 2) };
    fg = await renderMarkup(markup((i) => (i === active ? NATIVE_CAPTION.accent : "#FFFFFF")), opts);
    const lineH = (await sharp(await renderMarkup("Hg", opts)).metadata()).height ?? size;
    const h = (await sharp(fg).metadata()).height ?? size;
    // Two lines are 2 × line height plus the line spacing; anything taller would be a third line.
    if (h <= lineH * 2.6 || size < 24) break;
    size = Math.round(size * 0.88);
  }
  const outline = await renderMarkup(markup(() => "#000000"), opts);
  const { width = 1, height = 1 } = await sharp(fg).metadata();
  const pad = stroke + 2;
  const stamps: { input: Buffer; top: number; left: number }[] = [];
  const steps = 24;
  for (let k = 0; k < steps; k++) {
    const a = (2 * Math.PI * k) / steps;
    stamps.push({ input: outline, top: pad + Math.round(stroke * Math.sin(a)), left: pad + Math.round(stroke * Math.cos(a)) });
  }
  // Fill the stroke's inner ring too, so thick strokes have no gaps between stamps.
  for (let k = 0; k < 12; k++) {
    const a = (2 * Math.PI * k) / 12;
    stamps.push({ input: outline, top: pad + Math.round((stroke / 2) * Math.sin(a)), left: pad + Math.round((stroke / 2) * Math.cos(a)) });
  }
  return sharp({ create: { width: width + pad * 2, height: height + pad * 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([...stamps, { input: fg, top: pad, left: pad }])
    .png()
    .toBuffer();
}

/** The hook headline: big headline face, last word highlighted. */
export function hookHeadlinePng(text: string, canvas: Canvas, look: Look = DEFAULT_STYLE): Promise<Buffer> {
  const size = Math.round(unit(canvas) * 0.092);
  const w = text.trim().split(/\s+/);
  const last = w.pop() ?? "";
  const markup = `<span foreground="white">${pangoEscape(w.join(" ").toUpperCase())}</span>${w.length ? " " : ""}<span foreground="${look.highlight}">${pangoEscape(last.toUpperCase())}</span>`;
  const plain = `<span foreground="black">${pangoEscape(text.toUpperCase())}</span>`;
  const opts = { family: look.headline.family, fontFile: look.headline.file, size, width: wrapWidth(canvas, 0.84, Math.round(size * 0.4)) };
  return (canvas.safeW ? fittedSize(plain, opts, 3) : Promise.resolve(size)).then((s) => shadowed(markup, plain, { ...opts, size: s }));
}

/** A pill: text on a rounded rectangle. */
export async function pill(text: string, canvas: Canvas, style: { size: number; fg: string; bg: string; family: string; fontFile: string; widthPct: number; maxLines?: number }): Promise<Buffer> {
  const sharp = await sharpLib();
  const markup = `<span foreground="${style.fg}">${pangoEscape(text)}</span>`;
  const base = { family: style.family, fontFile: style.fontFile, size: style.size, width: wrapWidth(canvas, style.widthPct, Math.round(style.size * 0.7)) };
  // Inside a platform safe box, a long pill wraps to two lines and then steps its type down.
  if (canvas.safeW) base.size = await fittedSize(markup, base, style.maxLines ?? 2);
  style = { ...style, size: base.size };
  const fg = await renderMarkup(markup, base);
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
  // Right-to-left buttons end on the left: the chevron points that way.
  return pill(`${text.toUpperCase()}  ${RTL_TEXT.test(text) ? "‹" : "›"}`, canvas, { size: Math.round(unit(canvas) * 0.058), fg: look.buttonText, bg: look.button, family: look.body.family, fontFile: look.body.file, widthPct: 0.7 });
}

/** A comparison label: ours on the brand accent, the other side on a neutral dark pill. */
export function comparisonLabelPng(text: string, canvas: Canvas, look: Look = DEFAULT_STYLE, ours = true): Promise<Buffer> {
  return pill(text.toUpperCase(), canvas, {
    size: Math.round(unit(canvas) * 0.05),
    fg: ours ? look.buttonText : "#FFFFFF",
    bg: ours ? look.button : "rgba(40,40,40,0.85)",
    family: look.body.family,
    fontFile: look.body.file,
    // Inside the safe body band (x 240–840 of 1080).
    widthPct: 0.48,
  });
}

/** Legal fine print: small, light, wrapped to the safe width; sits above the bottom safe zone. */
export function finePrintPng(text: string, canvas: Canvas, look: Look = DEFAULT_STYLE): Promise<Buffer> {
  const size = Math.round(unit(canvas) * 0.019);
  return shadowed(`<span foreground="#E8E8E8">${pangoEscape(text)}</span>`, `<span foreground="black">${pangoEscape(text)}</span>`, {
    family: look.body.family,
    fontFile: look.body.file,
    size,
    width: wrapWidth(canvas, 0.86, Math.round(size * 0.4)),
  });
}

/** The landing domain under the button, small. */
export function domainPng(domain: string, canvas: Canvas, look: Look = DEFAULT_STYLE): Promise<Buffer> {
  const size = Math.round(unit(canvas) * 0.034);
  return shadowed(`<span foreground="white">${pangoEscape(domain)}</span>`, `<span foreground="black">${pangoEscape(domain)}</span>`, {
    family: look.body.family,
    fontFile: look.body.file,
    size,
    width: wrapWidth(canvas, 0.8, Math.round(size * 0.4)),
  });
}

/** The brand logo for the end card, fitted to a box on a soft dark plate so a light logo reads on any frame. */
export async function logoPng(url: string, canvas: Canvas): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const sharp = await sharpLib();
    // Fits the end card's logo slot inside the strict safe box (on 9:16: y 296–388 at slot .178).
    const boxW = Math.round(unit(canvas) * 0.3);
    const boxH = Math.round(unit(canvas) * 0.085);
    return await sharp(Buffer.from(await res.arrayBuffer()))
      .resize({ width: boxW, height: boxH, fit: "inside", withoutEnlargement: false })
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}
