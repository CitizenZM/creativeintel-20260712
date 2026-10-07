/**
 * Pango text for image ads, auto-fitted to a box (fit.ts): the largest size within the line limit,
 * shrinking words off the end ("…") only when even the minimum size can't hold it.
 */
import sharp from "sharp";
import { ensureFontconfig, pangoEscape } from "@/services/video-gen/glm-assemble";
import type { BrandFont } from "@/services/video-gen/edit/brand-style";
import { estimateSize, fitLoop, shortenText } from "./fit";

// macOS pango defaults to CoreText, which ignores `fontfile` (brand fonts fall back to Helvetica);
// the fontconfig backend loads them, as on Linux. Must be set before pango's first render.
if (process.platform === "darwin" && !process.env.PANGOCAIRO_BACKEND) process.env.PANGOCAIRO_BACKEND = "fc";

export interface FittedText {
  png: Buffer;
  width: number;
  height: number;
  size: number;
  text: string;
  fits: boolean;
}

export interface TextSpec {
  text: string;
  face: BrandFont;
  color: string;
  /** Last word in this colour. */
  emphasis?: string | null;
  uppercase?: boolean;
  align?: "left" | "centre";
  maxLines: number;
  maxSize: number;
  minSize: number;
  /** Baseline-to-baseline distance as a multiple of the size (default 1.15). */
  leading?: number;
  /** Even out the line lengths (headlines). */
  balance?: boolean;
}

function markup(text: string, color: string, emphasis?: string | null, lineHeight = 1): string {
  let body: string;
  if (!emphasis) body = `<span foreground="${color}">${pangoEscape(text)}</span>`;
  else {
    const words = text.trim().split(/\s+/);
    const last = words.pop() ?? "";
    const head = words.length ? `<span foreground="${color}">${pangoEscape(words.join(" "))} </span>` : "";
    body = `${head}<span foreground="${emphasis}">${pangoEscape(last)}</span>`;
  }
  return lineHeight < 0.99 ? `<span line_height="${lineHeight.toFixed(3)}">${body}</span>` : body;
}

async function render(m: string, face: BrandFont, size: number, width: number | null, align: "left" | "centre"): Promise<{ png: Buffer; width: number; height: number }> {
  const png = await sharp({
    text: { text: m, font: `${face.family} ${size}`, fontfile: face.file, ...(width ? { width: Math.max(1, Math.floor(width)) } : {}), align, rgba: true, dpi: 72, wrap: "word" },
  })
    .png()
    .toBuffer();
  const meta = await sharp(png).metadata();
  return { png, width: meta.width ?? 0, height: meta.height ?? 0 };
}

const REF = 100;
const metricsCache = new Map<string, Promise<{ lineHeight: number; advance: number }>>();

/**
 * Per face and target leading: the pango line_height factor that brings the baseline-to-baseline
 * distance to `leading` × size (display faces like Anton ship with ~1.5×), and the resulting advance
 * at REF px (two-line render minus one-line render).
 */
function faceMetrics(face: BrandFont, leading: number): Promise<{ lineHeight: number; advance: number }> {
  const key = `${face.file}|${face.family}|${leading}`;
  let hit = metricsCache.get(key);
  if (!hit) {
    hit = (async () => {
      const adv = async (lh: number) => {
        const one = await render(markup("HXg", "#000", null, lh), face, REF, null, "left");
        const two = await render(markup("HXg\nHXg", "#000", null, lh), face, REF, null, "left");
        return Math.max(1, two.height - one.height);
      };
      const natural = await adv(1);
      const lineHeight = Math.max(0.5, Math.min(1, (leading * REF) / natural));
      return { lineHeight, advance: lineHeight < 0.99 ? await adv(lineHeight) : natural };
    })();
    metricsCache.set(key, hit);
  }
  return hit;
}

export async function fitText(spec: TextSpec, box: { w: number; h: number }): Promise<FittedText> {
  await ensureFontconfig(spec.face.file);
  const align = spec.align ?? "centre";
  let text = (spec.uppercase ? spec.text.toUpperCase() : spec.text).replace(/\s+/g, " ").trim();
  const maxSize = Math.max(spec.minSize, Math.floor(spec.maxSize));
  const { lineHeight, advance: adv } = await faceMetrics(spec.face, spec.leading ?? 1.15);
  for (let attempt = 0; attempt < 8; attempt++) {
    const m = markup(text, spec.color, spec.emphasis, lineHeight);
    const natural = await render(m, spec.face, REF, null, align);
    // Lines = the first line's own height plus one advance per extra line.
    const lineCount = (r: { height: number }, s: number) => 1 + Math.max(0, Math.round((r.height - (natural.height * s) / REF) / ((adv * s) / REF)));
    const start = estimateSize({ width: natural.width, height: Math.max(natural.height, adv * 0.9), ref: REF }, box, spec.maxLines, maxSize);
    const r = await fitLoop((s) => render(m, spec.face, s, box.w, align), lineCount, { box, maxLines: spec.maxLines, maxSize, minSize: spec.minSize }, start);
    if (r.fits || attempt === 7 || shortenText(text) === text) {
      let out = r.out;
      const lines = lineCount(out, r.size);
      if (r.fits && spec.balance && lines >= 2 && text.split(" ").length >= 3) {
        // Balance the rag: the narrowest wrap width that keeps the same line count (no one-word widow).
        for (const k of [0.62, 0.72, 0.84]) {
          const tryW = Math.max(out.width * k, 10);
          const t = await render(m, spec.face, r.size, tryW, align);
          if (lineCount(t, r.size) === lines && t.width <= box.w) {
            out = t;
            break;
          }
        }
      }
      return { png: out.png, width: out.width, height: out.height, size: r.size, text, fits: r.fits };
    }
    text = shortenText(text);
  }
  throw new Error("unreachable");
}

/** One render at a fixed size (rows that must share a size, e.g. bullets). */
export async function textAt(spec: Omit<TextSpec, "maxSize" | "minSize" | "maxLines">, size: number, width: number): Promise<{ png: Buffer; width: number; height: number }> {
  await ensureFontconfig(spec.face.file);
  const text = spec.uppercase ? spec.text.toUpperCase() : spec.text;
  const { lineHeight } = await faceMetrics(spec.face, spec.leading ?? 1.15);
  return render(markup(text, spec.color, spec.emphasis, lineHeight), spec.face, size, width, spec.align ?? "centre");
}
