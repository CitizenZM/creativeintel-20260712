import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { END_CARD_THEMES, endCardLayers, endCardPalette, endCardSlots, layerFilter, layerInputArgs, RENDERABLE_END_CARDS, type EndCardData, type EndCardTemplate } from "./endcard-render";
import { encodeQr, qrVersionFor, _rs } from "./qr";
import { DEFAULT_STYLE } from "./brand-style";
import { SAFE_BOX } from "@/services/creative/library";

const c = { w: 1080, h: 1920 };

/** Every non-backdrop layer's box (at rest) inside the strict safe box. */
async function expectInSafeBox(layers: { png: Buffer; y: number; role: string; anim: string }[]) {
  for (const l of layers) {
    if (l.role === "backdrop") continue;
    const m = await sharp(l.png).metadata();
    const top = l.y * c.h - (m.height ?? 0) / 2;
    const bottom = l.y * c.h + (m.height ?? 0) / 2 + (l.anim === "bob" ? 18 : 0);
    expect(top, `${l.role} top`).toBeGreaterThanOrEqual(SAFE_BOX.top);
    expect(bottom, `${l.role} bottom`).toBeLessThanOrEqual(SAFE_BOX.bottom);
    expect(m.width ?? 0, `${l.role} width`).toBeLessThanOrEqual(c.w);
  }
}

describe("end-card slots", () => {
  it("keep every readable layer inside the strict 9:16 safe box", () => {
    const s = endCardSlots(c);
    for (const y of [s.logo, s.headline, s.main, s.fine, s.button, s.caption]) {
      expect(y * c.h).toBeGreaterThanOrEqual(SAFE_BOX.top);
      expect(y * c.h).toBeLessThanOrEqual(SAFE_BOX.bottom - 50);
    }
    expect(endCardSlots({ w: 1920, h: 1080 }).button).toBe(0.74);
  });
  it("every library card renders", () => {
    expect(RENDERABLE_END_CARDS).toEqual(["E01", "E02", "E03", "E04", "E05", "E06", "E07", "E08", "E09", "E10", "E11", "E12"]);
  });
});

describe("endCardLayers", { timeout: 60_000 }, () => {
  let skus: EndCardData["skus"];
  beforeAll(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ec-test-"));
    skus = [];
    for (const [i, color] of ["#2A7DE1", "#E4002B", "#F2C14E"].entries()) {
      const f = path.join(dir, `p${i}.png`);
      await writeFile(f, await sharp({ create: { width: 300, height: 300, channels: 4, background: color } }).png().toBuffer());
      skus.push({ imagePath: f, label: `Model ${i + 1}`, price: 299 + i * 100 });
    }
  });

  it("refuses fact cards without their facts", async () => {
    expect(await endCardLayers("E02", { pct: null }, c)).toBeNull();
    expect(await endCardLayers("E03", { code: " " }, c)).toBeNull();
    expect(await endCardLayers("E04", { price: 999, comparePrice: 899 }, c)).toBeNull();
    expect(await endCardLayers("E05", { deadline: "  ", headline: "40% off" }, c)).toBeNull();
    expect(await endCardLayers("E06", { rating: null, quote: "Great" }, c)).toBeNull();
    expect(await endCardLayers("E07", { skus: [{ imagePath: "/nope.png", label: "One" }] }, c)).toBeNull();
    expect(await endCardLayers("E07", { skus: [{ label: "No image" }, { label: "Also none" }] }, c)).toBeNull();
    expect(await endCardLayers("E10", { appName: " ", rating: 4.8 }, c)).toBeNull();
    expect(await endCardLayers("E11", { url: "" }, c)).toBeNull();
    expect(await endCardLayers("E11", { url: "not a url" }, c)).toBeNull();
  });

  it("E05 urgency bar: wipe-in bar, its text, the offer line; button kept", async () => {
    const r = (await endCardLayers("E05", { deadline: "Ends Sunday", headline: "Up to 40% off" }, c))!;
    expect(r.hideButton).toBe(false);
    expect(r.layers.map((l) => l.anim)).toEqual(["wipe", "pop", "pop"]);
    await expectInSafeBox(r.layers);
    const noOffer = (await endCardLayers("E05", { deadline: "Ends Sunday" }, c))!;
    expect(noOffer.layers).toHaveLength(2);
  });

  it("E06 rating: stars fill one by one (partial last star), rating line, quote card", async () => {
    const r = (await endCardLayers("E06", { rating: 4.6, reviewCount: 12480, quote: "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen", quoteBy: "Verified buyer" }, c))!;
    const fills = r.layers.slice(1, -2);
    expect(fills).toHaveLength(5); // 4 full + the 0.6 star
    expect(fills.map((l) => l.delaySec)).toEqual([0.08, 0.16, 0.24, 0.32, 0.4].map((d) => expect.closeTo(d, 5)));
    expect(r.layers.at(-1)!.anim).toBe("rise");
    expect(r.hideButton).toBe(false);
    await expectInSafeBox(r.layers);
    const three = (await endCardLayers("E06", { rating: 3 }, c))!;
    expect(three.layers).toHaveLength(1 + 3 + 1);
  });

  it("E07 carousel: shifts every 0.6 s, then holds the hero; skips SKUs whose image fails", async () => {
    const r = (await endCardLayers("E07", { headline: "Find yours", skus }, c, DEFAULT_STYLE, { durationSec: 3.2 }))!;
    const main = r.layers.filter((l) => l.role === "main");
    expect(main).toHaveLength(3 * 3 + 1);
    expect(main.at(-1)!.durSec).toBeUndefined();
    expect(main.at(-1)!.delaySec).toBeCloseTo(0.1 + 3 * 0.6, 5);
    expect(main.slice(0, -1).every((l) => l.durSec! > 0)).toBe(true);
    // Sequence covers the timeline with no gap.
    for (let i = 1; i < main.length; i++) expect(main[i].delaySec).toBeCloseTo(main[i - 1].delaySec + main[i - 1].durSec!, 5);
    await expectInSafeBox(r.layers);
    const short = (await endCardLayers("E07", { skus }, c, DEFAULT_STYLE, { durationSec: 1.5 }))!;
    expect(short.layers).toHaveLength(1); // too short to cycle: a static hero
    const broken = (await endCardLayers("E07", { skus: [...skus!.slice(0, 2), { imagePath: "/missing.png", label: "Gone" }] }, c, DEFAULT_STYLE, { durationSec: 3.2 }))!;
    expect(broken.layers.filter((l) => l.role === "main")).toHaveLength(2 * 3 + 1);
  });

  it("E10 app card: icon + shine frames, name, rating, benefits, store pills; button kept", async () => {
    const r = (await endCardLayers("E10", { appName: "TCL Home", rating: 4.8, downloads: "2M+ downloads", benefits: ["Control every device", "Free on iOS & Android"] }, c))!;
    expect(r.layers.filter((l) => l.durSec)).toHaveLength(4);
    expect(r.layers).toHaveLength(1 + 4 + 3); // icon, shines, name+rating plate, benefits, store pills
    expect(r.hideButton).toBe(false);
    await expectInSafeBox(r.layers);
  });

  it("E11 QR card: header, white tile with a QR, pulsing scanner brackets", async () => {
    const r = (await endCardLayers("E11", { url: "https://www.tcl.com/us/en/qm8", pct: 15 }, c))!;
    expect(r.layers.map((l) => l.anim)).toEqual(["pop", "pop", "pulse"]);
    expect(r.hideButton).toBe(false);
    await expectInSafeBox(r.layers);
    const tile = await sharp(r.layers[1].png).metadata();
    const q = encodeQr("https://www.tcl.com/us/en/qm8");
    const m = Math.floor((1080 * 0.345) / (q.size + 8));
    expect(tile.width).toBe((q.size + 8) * m); // quiet zone = 4 modules each side
  });

  it("E09 / E12 hide the button; every other card keeps it", async () => {
    const data: EndCardData = { headline: "Deal", pct: 20, code: "X", price: 1, comparePrice: 2, deadline: "Ends Sunday", rating: 4.5, skus, appName: "A", url: "brand.com/x" };
    for (const id of RENDERABLE_END_CARDS) {
      const r = await endCardLayers(id as EndCardTemplate, data, c, DEFAULT_STYLE, { durationSec: 3.2 });
      expect(r, id).not.toBeNull();
      expect(r!.hideButton, id).toBe(id === "E09" || id === "E12");
    }
  });
});

describe("themes", { timeout: 60_000 }, () => {
  it("each theme is a distinct look; the default is the brand look", () => {
    expect(endCardPalette(undefined, DEFAULT_STYLE).look).toEqual(DEFAULT_STYLE);
    const looks = END_CARD_THEMES.map((t) => JSON.stringify(endCardPalette(t, DEFAULT_STYLE).look));
    expect(new Set(looks).size).toBe(4);
    expect(endCardPalette("festive", DEFAULT_STYLE).look.button).toBe("#146B3A");
  });

  it("dark adds a scrim, festive a scrim + snow, light / brand neither — all inside the safe box", async () => {
    const roles = async (theme: EndCardData["theme"]) => (await endCardLayers("E01", { headline: "Hi", theme }, c))!;
    expect((await roles("brand")).layers.map((l) => l.role)).toEqual(["headline"]);
    expect((await roles("light")).layers.map((l) => l.role)).toEqual(["headline"]);
    expect((await roles("dark")).layers.map((l) => l.role)).toEqual(["backdrop", "headline"]);
    const festive = await roles("festive");
    expect(festive.layers.map((l) => l.role)).toEqual(["backdrop", "decor", "headline"]);
    expect(festive.layers[1].anim).toBe("drift");
    await expectInSafeBox(festive.layers.map((l) => (l.anim === "drift" ? { ...l, anim: "none" } : l)));
    // drift sways ±8 px: keep that margin too.
    const snow = await sharp(festive.layers[1].png).metadata();
    expect(festive.layers[1].y * c.h - (snow.height ?? 0) / 2 - 8).toBeGreaterThanOrEqual(SAFE_BOX.top);
    expect(festive.layers[1].y * c.h + (snow.height ?? 0) / 2 + 8).toBeLessThanOrEqual(SAFE_BOX.bottom);
  });
});

describe("qr", () => {
  it("Reed–Solomon matches the ISO example (1-M, HELLO WORLD)", () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    expect(_rs.remainder(data, _rs.divisor(10))).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  });

  it("picks the smallest version and draws finder, timing and dark module", () => {
    expect(qrVersionFor("https://tcl.com/qm8")).toBe(2);
    expect(qrVersionFor("x".repeat(213))).toBe(10);
    expect(() => qrVersionFor("x".repeat(214))).toThrow(/too long/);
    const q = encodeQr("https://www.tcl.com/us/en/qm8");
    expect(q.size).toBe(q.version * 4 + 17);
    expect(q.modules).toHaveLength(q.size);
    const n = q.size;
    for (const [ox, oy] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
      for (let i = 0; i < 7; i++) {
        expect(q.modules[oy][ox + i]).toBe(true);
        expect(q.modules[oy + 6][ox + i]).toBe(true);
      }
      expect(q.modules[oy + 1][ox + 1]).toBe(false);
      expect(q.modules[oy + 3][ox + 3]).toBe(true);
    }
    for (let i = 8; i < n - 8; i++) expect(q.modules[6][i]).toBe(i % 2 === 0);
    expect(q.modules[n - 8][8]).toBe(true);
  });

  it("writes valid format bits (BCH) for the chosen mask", () => {
    const q = encodeQr("HELLO", 5);
    let bits = 0;
    for (let i = 0; i <= 5; i++) bits |= (q.modules[i][8] ? 1 : 0) << i;
    bits |= (q.modules[7][8] ? 1 : 0) << 6;
    bits |= (q.modules[8][8] ? 1 : 0) << 7;
    bits |= (q.modules[8][7] ? 1 : 0) << 8;
    for (let i = 9; i < 15; i++) bits |= (q.modules[8][14 - i] ? 1 : 0) << i;
    const raw = bits ^ 0x5412;
    expect(raw >>> 10).toBe(0b00101); // level M (00) + mask 5
    let rem = raw;
    for (let i = 14; i >= 10; i--) if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10);
    expect(rem).toBe(0);
  });
});

describe("layerFilter", () => {
  it("animates scale on the layer and position on the overlay", () => {
    const pop = layerFilter(5, "pop", 0.4, 12, 15, "[o3]", "[o4]");
    expect(pop[0]).toMatch(/^\[5:v\]format=rgba,scale=w=.*eval=frame\[ly5\]$/);
    expect(pop[0]).toContain("max(0.1,");
    expect(pop[1]).toContain("[o3][ly5]overlay=x=(W-w)/2:y='H*0.4-h/2'");
    expect(layerFilter(6, "bob", 0.6, 14, 15, "[o4]", "[o5]")[0]).toContain("abs(sin(2*PI*(t-14.000)))");
    expect(layerFilter(7, "wipe", 0.25, 12, 15, "[o5]", "[o6]")[0]).toContain(":h=ih:eval=frame");
    expect(layerFilter(8, "fade", 0.25, 12, 15, "[o6]", "[o7]")[0]).toContain("fade=t=in:st=12.000:d=0.25:alpha=1");
    expect(layerFilter(9, "rise", 0.4, 12, 15, "[o7]", "[o8]")[0]).toContain("pow(max(0,1-(t-12.000)/0.35),2)");
  });

  it("loops the PNG input of self-animated layers (a single-frame input freezes the envelope at t = 0)", () => {
    expect(layerInputArgs("a.png", "pop", 15)).toEqual(["-loop", "1", "-framerate", "30", "-t", "15.000", "-i", "a.png"]);
    expect(layerInputArgs("a.png", "fade", 15)[0]).toBe("-loop");
    expect(layerInputArgs("a.png", "bob", 15)).toEqual(["-i", "a.png"]);
    expect(layerInputArgs("a.png", undefined, 15)).toEqual(["-i", "a.png"]);
  });
});

describe("one-line headline pill", () => {
  it("keeps a long end-card headline on one line instead of wrapping into the logo", async () => {
    const { oneLinePill } = await import("./endcard-render");
    const { DEFAULT_STYLE } = await import("./brand-style");
    const sharp = (await import("sharp")).default;
    const c = { w: 1080, h: 1920 };
    const style = { size: 67, fg: "#111", bg: "#ffd400", family: DEFAULT_STYLE.headline.family, fontFile: DEFAULT_STYLE.headline.file, widthPct: 0.66 };
    const short = await sharp(await oneLinePill("SALE", c, style)).metadata();
    const long = await sharp(await oneLinePill("20% OFF THIS BLACK FRIDAY", c, style)).metadata();
    expect(long.height!).toBeLessThanOrEqual(short.height! * 1.25);
    expect(long.width!).toBeLessThanOrEqual(1080 * 0.84 + 2 * 67);
  }, 30_000);
});
