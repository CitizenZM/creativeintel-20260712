import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { ctaButtonPng, finePrintPng, hookHeadlinePng, kineticCaptionPng, offerCardPng, wrapWidth } from "./text-layers";

const c = { w: 1080, h: 1920 };
const tiktok = { ...c, safeW: 876 };
const dims = async (b: Buffer) => {
  const m = await sharp(b).metadata();
  return { w: m.width ?? 0, h: m.height ?? 0 };
};

describe("wrapWidth", () => {
  it("is today's share of the frame without a safe width", () => {
    expect(wrapWidth(c, 0.86, 30)).toBe(929);
  });
  it("leaves room for the layer's own padding inside the safe width", () => {
    expect(wrapWidth(tiktok, 0.86, 30)).toBe(876 - 60);
  });
});

describe("text layers inside the platform safe width", { timeout: 60_000 }, () => {
  it("captions, offer pill, CTA and fine print never exceed the safe width", async () => {
    const pngs = await Promise.all([
      kineticCaptionPng(["UNWRAP", "THE", "HOLIDAYS", "WITH", "FREE", "INSTALLATION"], 2, tiktok),
      offerCardPng("BLACK FRIDAY DEAL — SHOP AT TCL.COM", tiktok),
      ctaButtonPng("Shop the Black Friday deal now", tiktok),
      finePrintPng("*Free installation on QM7L 65\" and larger, while supplies last. Offer valid 11/20–12/2 at TCL.com; see site for details.", tiktok),
    ]);
    for (const p of pngs) expect((await dims(p)).w).toBeLessThanOrEqual(876);
  });
  it("a long hook headline wraps and shrinks rather than growing past three lines", async () => {
    const short = await dims(await hookHeadlinePng("WANT A GIFT?", tiktok));
    const long = await dims(await hookHeadlinePng("SURPRISE — TCL HOLIDAY FREE INSTALLATION INCLUDED ON EVERY QM7L THIS BLACK FRIDAY", tiktok));
    expect(long.w).toBeLessThanOrEqual(876);
    // A line of 0.092 × 1080 px type is ~120 px tall with spacing: three lines plus the shadow pad, no more.
    expect(long.h).toBeLessThanOrEqual(short.h * 3 + 40);
  });
});
