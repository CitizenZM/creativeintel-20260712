import { describe, expect, it } from "vitest";
import { DEFAULT_STYLE } from "@/services/video-gen/edit/brand-style";
import { contrastRatio, ctaColors, needsPlate, paletteFrom } from "./palette";
import { TEMPLATES } from "./templates";
import type { AdPalette, ColorToken } from "./types";

describe("paletteFrom", () => {
  it("keeps the default look without a kit", () => {
    const p = paletteFrom(DEFAULT_STYLE, []);
    expect(p.button).toBe(DEFAULT_STYLE.button);
    expect(p.accent).toBe(DEFAULT_STYLE.offerBg);
    expect(p.bg).toMatch(/^#[0-9A-F]{6}$/i);
  });
  it("uses a dark brand colour as the background", () => {
    const p = paletteFrom(DEFAULT_STYLE, [{ hex: "#0A1F44", usage: "background" }]);
    expect(p.bg).toBe("#0A1F44");
  });
});

describe("template text contrast", () => {
  const p = paletteFrom(DEFAULT_STYLE, []);
  const bgOf = (t: (typeof TEMPLATES)[number]): ColorToken => t.background.base;
  for (const t of TEMPLATES) {
    it(`${t.id}: every text style reads on its background (≥ 4.5:1)`, () => {
      for (const s of Object.values(t.text)) expect(contrastRatio(p[s!.color as keyof AdPalette], p[bgOf(t)])).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe("ctaColors", () => {
  it("swaps the button off a background of the same colour", () => {
    const p: AdPalette = { ...paletteFrom(DEFAULT_STYLE, []), festive: "#B3001B", button: "#C8102E" };
    const c = ctaColors(p, p.festive);
    expect(c.bg).not.toBe(p.button);
    expect(contrastRatio(c.fg, c.bg)).toBeGreaterThanOrEqual(4.5);
  });
  it("keeps the brand button where it stands out", () => {
    const p = paletteFrom(DEFAULT_STYLE, []);
    expect(ctaColors(p, p.bg).bg).toBe(p.button);
  });
});

describe("needsPlate", () => {
  it("puts a red logo on a plate over a red background, not over dark navy", () => {
    expect(needsPlate("#D2202F", "#B3001B")).toBe(true);
    expect(needsPlate("#D2202F", "#F5F3EF")).toBe(false);
    expect(needsPlate("#FFFFFF", "#F5F3EF")).toBe(true);
  });
});
