/**
 * Brand packaging for the v2 edit, from the project's Brand Kit: the accent
 * colour for highlights and the offer card, the CTA button colour, the brand's
 * headline / body fonts (fetched from Google Fonts as TTF and cached in /tmp —
 * the bundled Anton / Montserrat when a family isn't on Google Fonts), the logo
 * for the end card, the top approved CTA and the landing domain.
 */
import { writeFile, access } from "node:fs/promises";
import path from "node:path";
import { BRAND_FONT_DIR, CAPTION_FONT, SUBTITLE_FONT, ensureFontconfig } from "../glm-assemble";

export interface BrandFont {
  family: string;
  file: string;
}

export interface BrandStyle {
  highlight: string;
  button: string;
  buttonText: string;
  offerBg: string;
  offerText: string;
  headline: BrandFont;
  body: BrandFont;
  logoUrl: string | null;
  ctaText: string;
  domain: string | null;
  /** The Brand Kit's licensed music track (latest upload), replacing the synthesised bed. */
  musicUrl: string | null;
}

export const DEFAULT_STYLE: BrandStyle = {
  highlight: "#FFD400",
  button: "#E4002B",
  buttonText: "#FFFFFF",
  offerBg: "#FFD400",
  offerText: "#111111",
  headline: { family: "Anton", file: CAPTION_FONT },
  body: { family: "Montserrat Bold", file: SUBTITLE_FONT },
  logoUrl: null,
  ctaText: "Shop now",
  domain: null,
  musicUrl: null,
};

/** WCAG relative luminance of a #RRGGBB colour. */
export function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0.5;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

type Color = { hex?: string; usage?: string; name?: string };

/**
 * Colours from the kit: highlight text must read on dark footage (luminance ≥
 * 0.18, else the default yellow); the button takes the accent (or primary)
 * with black or white text by contrast.
 */
export function pickColors(colors: Color[]): Pick<BrandStyle, "highlight" | "button" | "buttonText" | "offerBg" | "offerText"> {
  const valid = colors.filter((c) => /^#?[0-9a-f]{6}$/i.test(c.hex ?? "")).map((c) => ({ ...c, hex: c.hex!.startsWith("#") ? c.hex! : `#${c.hex}` }));
  const by = (u: string) => valid.find((c) => (c.usage ?? "").toLowerCase() === u);
  const vivid = valid.filter((c) => luminance(c.hex) > 0.04 && luminance(c.hex) < 0.9);
  const accent = by("accent") ?? by("primary") ?? vivid[0];
  const out = { ...DEFAULT_STYLE };
  if (accent && luminance(accent.hex) > 0.04 && luminance(accent.hex) < 0.9) {
    out.button = accent.hex;
    out.buttonText = luminance(accent.hex) > 0.45 ? "#111111" : "#FFFFFF";
    if (luminance(accent.hex) >= 0.18) {
      out.highlight = accent.hex;
      out.offerBg = accent.hex;
      out.offerText = luminance(accent.hex) > 0.45 ? "#111111" : "#FFFFFF";
    }
  }
  return { highlight: out.highlight, button: out.button, buttonText: out.buttonText, offerBg: out.offerBg, offerText: out.offerText };
}

/** An approved CTA that names another brand (e.g. a copy-paste from another project) is skipped. */
export function pickCta(options: { text?: string; priority?: number }[], brandName: string, otherBrands: string[] = []): string {
  const others = otherBrands.map((b) => b.toLowerCase()).filter((b) => b && b !== brandName.toLowerCase());
  const ok = options
    .filter((o) => (o.text ?? "").trim() && (o.text ?? "").length <= 24)
    .filter((o) => !others.some((b) => (o.text ?? "").toLowerCase().includes(b)))
    .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
  return ok[0]?.text?.trim() || DEFAULT_STYLE.ctaText;
}

export async function googleFont(family: string, weight = 700): Promise<BrandFont | null> {
  const safe = family.replace(/[^A-Za-z0-9 ]/g, "").trim();
  if (!safe) return null;
  const file = path.join(BRAND_FONT_DIR, `${safe.replace(/\s+/g, "_")}-${weight}.ttf`);
  try {
    await access(file);
    return { family: `${safe} Bold`, file };
  } catch {
    // not cached yet
  }
  try {
    const css = await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(safe)}:wght@${weight}`, {
      headers: { "User-Agent": "Mozilla/4.0" }, // old UA → TrueType, which pango can load
      signal: AbortSignal.timeout(10_000),
    }).then((r) => (r.ok ? r.text() : ""));
    const url = /src: url\((https:[^)]+\.ttf)\)/.exec(css)?.[1];
    if (!url) return null;
    const ttf = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!ttf.ok) return null;
    await ensureFontconfig(CAPTION_FONT);
    await writeFile(file, Buffer.from(await ttf.arrayBuffer()));
    return { family: `${safe} Bold`, file };
  } catch {
    return null;
  }
}

export async function loadBrandStyle(projectId: string | null | undefined): Promise<BrandStyle> {
  if (!projectId) return DEFAULT_STYLE;
  try {
    const { prisma } = await import("@/lib/db");
    const [project, kit, others] = await Promise.all([
      prisma.project.findUnique({ where: { id: projectId }, select: { brandName: true } }),
      prisma.brandKit.findUnique({ where: { projectId }, include: { assets: { where: { kind: { in: ["LOGO", "MUSIC"] } }, orderBy: { createdAt: "asc" } } } }),
      prisma.project.findMany({ select: { brandName: true }, take: 200 }),
    ]);
    if (!kit) return DEFAULT_STYLE;
    const fonts = (Array.isArray(kit.fonts) ? kit.fonts : []) as { role?: string; family?: string }[];
    const [headline, body] = await Promise.all([
      googleFont(fonts.find((f) => f.role === "headline")?.family ?? ""),
      googleFont(fonts.find((f) => f.role === "body")?.family ?? ""),
    ]);
    const logos = kit.assets.filter((a) => a.kind === "LOGO");
    const logo = logos.find((a) => a.variant === "light") ?? logos[0];
    const music = kit.assets.filter((a) => a.kind === "MUSIC").pop();
    let domain: string | null = null;
    try {
      domain = kit.landingUrl ? new URL(kit.landingUrl).hostname.replace(/^www\./, "") : null;
    } catch {
      domain = null;
    }
    return {
      ...DEFAULT_STYLE,
      ...pickColors((Array.isArray(kit.colorsHex) ? kit.colorsHex : []) as Color[]),
      headline: headline ?? DEFAULT_STYLE.headline,
      body: body ?? DEFAULT_STYLE.body,
      logoUrl: logo?.url ?? null,
      ctaText: pickCta((Array.isArray(kit.ctaOptions) ? kit.ctaOptions : []) as { text?: string; priority?: number }[], project?.brandName ?? "", others.map((o) => o.brandName)),
      domain,
      musicUrl: music?.url ?? null,
    };
  } catch (err) {
    console.warn("[brand-style] falling back to the default look:", err instanceof Error ? err.message.slice(0, 160) : err);
    return DEFAULT_STYLE;
  }
}
