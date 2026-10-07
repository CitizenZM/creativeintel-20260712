import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { composeCtaHero, ctaHeroDecision, cutOutPackshot, HERO_LAYOUT } from "./cta-hero";

describe("ctaHeroDecision", () => {
  it("keeps an unreviewed CTA clip (no consistency record)", () => {
    expect(ctaHeroDecision(null)).toEqual({ use: false, reason: "unreviewed" });
  });
  it("keeps a centred, big product", () => {
    expect(ctaHeroDecision({ start: [0.22, 0.3, 0.78, 0.76], end: [0.24, 0.32, 0.78, 0.77], present: true })).toEqual({ use: false, reason: "hero" });
  });
  it("uses the packshot when the product is missing, off-centre or small at the start or the end of the clip", () => {
    expect(ctaHeroDecision({ start: null, end: null, present: false })).toEqual({ use: true, reason: "no product" });
    expect(ctaHeroDecision({ start: [0.55, 0.45, 0.98, 0.95], present: true }).reason).toBe("off-centre");
    expect(ctaHeroDecision({ start: [0.4, 0.4, 0.6, 0.6], present: true }).reason).toBe("small");
    // the first live run's CTA: centred at the start, drifting into the lower-right corner by the end
    expect(ctaHeroDecision({ start: [0.24, 0.33, 0.77, 0.76], end: [0.45, 0.5, 0.98, 0.99], present: true })).toMatchObject({ use: true, reason: "off-centre" });
  });
});

const canvas = { w: 270, h: 480 };

async function packshotOnWhite(): Promise<Buffer> {
  // a dark tablet with a lighter screen, on a white studio background
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect width="400" height="500" fill="#ffffff"/><rect x="80" y="60" width="240" height="380" rx="18" fill="#202020"/><rect x="96" y="76" width="208" height="348" fill="#e8e4da"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

describe("cutOutPackshot", () => {
  it("makes the white studio background transparent and trims to the product", async () => {
    const cut = await cutOutPackshot(await packshotOnWhite());
    const { data, info } = await sharp(cut).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(info.width).toBeLessThanOrEqual(250);
    expect(info.height).toBeLessThanOrEqual(390);
    // the product's light screen stays opaque (it is not connected to the border)
    const mid = ((info.height >> 1) * info.width + (info.width >> 1)) * 4;
    expect(data[mid + 3]).toBe(255);
  });
});

describe("composeCtaHero", () => {
  it("puts the packshot big and centred over a blurred, darkened copy of the last shot", async () => {
    const bg = await sharp({ create: { width: 540, height: 960, channels: 3, background: { r: 200, g: 120, b: 60 } } }).jpeg().toBuffer();
    const out = await composeCtaHero({ packshot: await packshotOnWhite(), background: bg, canvas });
    const { data, info } = await sharp(out).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([canvas.w, canvas.h]);
    const px = (x: number, y: number) => { const i = (Math.round(y) * info.width + Math.round(x)) * 3; return [data[i], data[i + 1], data[i + 2]]; };
    // the bezel (dark) at the product's left edge, at the layout's centre height
    const leftEdge = px(canvas.w / 2 - (canvas.h * HERO_LAYOUT.vertical.height * (240 / 380)) / 2 + 3, canvas.h * HERO_LAYOUT.vertical.y);
    expect(Math.max(...leftEdge)).toBeLessThan(80);
    // the corner is the darkened background, not white
    const corner = px(5, 5);
    expect(corner[0]).toBeGreaterThan(120);
    expect(corner[2]).toBeLessThan(120);
  });
});
