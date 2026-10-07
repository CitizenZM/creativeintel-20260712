/**
 * Image-ad colours from the brand look (edit/brand-style: highlight, button, offer colours, fonts)
 * plus the kit's dark background colour when it has one; contrast helpers keep text, the CTA and
 * the logo readable on every template background. Pure.
 */
import { luminance, type BrandStyle } from "@/services/video-gen/edit/brand-style";
import type { AdPalette } from "./types";

const HEX = /^#?([0-9a-f]{6})$/i;

export function rgb(hex: string): [number, number, number] {
  const m = HEX.exec(hex.trim());
  if (!m) return [128, 128, 128];
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) as [number, number, number];
}

const toHex = (c: number[]) => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;

export function mix(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return toHex(x.map((v, i) => v + (y[i] - v) * t));
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

const distance = (a: string, b: string) => {
  const x = rgb(a);
  const y = rgb(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};

type KitColor = { hex?: string; usage?: string };

export function paletteFrom(style: Pick<BrandStyle, "highlight" | "button" | "buttonText" | "offerBg" | "offerText">, colors: KitColor[] = []): AdPalette {
  const valid = colors.filter((c) => HEX.test(c.hex ?? "")).map((c) => ({ ...c, hex: (c.hex!.startsWith("#") ? c.hex! : `#${c.hex}`).toUpperCase() }));
  const dark = valid.find((c) => ["background", "primary", "secondary"].includes((c.usage ?? "").toLowerCase()) && luminance(c.hex) < 0.06);
  const bg = dark?.hex ?? "#0E1117";
  return {
    bg,
    bg2: mix(bg, "#FFFFFF", 0.12),
    paper: "#F5F3EF",
    ink: "#FFFFFF",
    inkDark: "#121317",
    accent: style.offerBg,
    accentText: style.offerText,
    button: style.button,
    buttonText: style.buttonText,
    highlight: style.highlight,
    gold: "#E8B04A",
    festive: "#9E0F1F",
    festive2: "#4C0711",
    white: "#FFFFFF",
    muted: "#C9CED8",
  };
}

/** The CTA pill: the brand button unless it disappears into the background, then the next readable pair. */
export function ctaColors(p: AdPalette, bgHex: string): { bg: string; fg: string } {
  const stands = (c: string) => contrastRatio(c, bgHex) >= 2.2 && distance(c, bgHex) > 90;
  const options = [
    { bg: p.button, fg: p.buttonText },
    { bg: p.accent, fg: p.accentText },
    { bg: p.white, fg: p.inkDark },
    { bg: p.inkDark, fg: p.white },
  ];
  return options.find((o) => stands(o.bg) && contrastRatio(o.fg, o.bg) >= 4.5) ?? options[3];
}

/** A logo that would vanish into the background goes on a plate. */
export function needsPlate(logoHex: string, bgHex: string): boolean {
  return contrastRatio(logoHex, bgHex) < 2.2;
}
