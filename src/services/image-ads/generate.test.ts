import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

const db = vi.hoisted(() => ({
  project: { findUnique: vi.fn(), update: vi.fn() },
  brandKit: { findUnique: vi.fn() },
}));
const storage = vi.hoisted(() => ({ uploadBuffer: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/services/storage", () => storage);
vi.mock("@/services/video-gen/edit/brand-style", async (orig) => {
  const real = await orig<typeof import("@/services/video-gen/edit/brand-style")>();
  return { ...real, loadBrandStyle: vi.fn(async () => real.DEFAULT_STYLE) };
});

import { generateImageAdSet, renderImageAdSet } from "./generate";
import { deriveCopy } from "./copy";
import { paletteFrom } from "./palette";
import { DEFAULT_STYLE } from "@/services/video-gen/edit/brand-style";

async function packshot(): Promise<Buffer> {
  return sharp({ create: { width: 400, height: 260, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: { create: { width: 300, height: 180, channels: 4, background: { r: 30, g: 30, b: 40, alpha: 1 } } }, left: 50, top: 40 }])
    .png()
    .toBuffer();
}

const brief = {
  product: { name: "TCL QM8L TV", brand: "TCL", model: "QM8L" },
  bigIdea: { proposition: "The TV that hangs like art" },
  sellingPoints: [{ claim: "6,000 nits peak brightness", proofVisual: { shot: "x", overlayText: "6,000 nits" } }],
};

describe("renderImageAdSet", () => {
  it("renders every template × format it has facts for and skips the rest with a reason", async () => {
    const copy = deriveCopy({ brief, brandName: "TCL", promo: { price: 1499.99, comparePrice: 2499.99 } });
    const look = { palette: paletteFrom(DEFAULT_STYLE, []), headline: DEFAULT_STYLE.headline, body: DEFAULT_STYLE.body };
    const out = await renderImageAdSet({
      copy,
      promo: { price: 1499.99, comparePrice: 2499.99 },
      look,
      assets: { product: await packshot() },
      templates: ["offer-burst", "testimonial-rating"],
      formats: ["300x250"],
    });
    expect(out.items.map((i) => `${i.template}@${i.format}`)).toEqual(["offer-burst@300x250"]);
    expect(out.skipped).toEqual([{ template: "testimonial-rating", reason: "missing rating" }]);
    const m = await sharp(out.items[0].png).metadata();
    expect([m.width, m.height]).toEqual([300, 250]);
    expect(out.items[0].notes.filter((n) => /overlaps|safe area/.test(n))).toEqual([]);
  }, 120_000);
});

describe("generateImageAdSet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.project.findUnique.mockResolvedValue({ id: "p1", brandName: "TCL", productName: "QM8L", productBrief: brief, campaignPlan: null, productPageImages: [], imageAdSets: null });
    db.brandKit.findUnique.mockResolvedValue({ colorsHex: [], assets: [] });
    storage.uploadBuffer.mockImplementation(async (i: { filename: string; buffer: Buffer }) => ({ url: `https://cdn.test/${i.filename}`, provider: "vercel-blob", bytes: i.buffer.length, publicId: i.filename }));
  });

  it("uploads each PNG and stores the set on the project", async () => {
    const set = await generateImageAdSet("p1", { templates: ["hero-product"], formats: ["728x90"], assets: { product: await packshot() } });
    expect(set.items).toHaveLength(1);
    expect(set.items[0]).toMatchObject({ template: "hero-product", format: "728x90", w: 728, h: 90, url: expect.stringMatching(/^https:\/\/cdn\.test\/.+\.png$/) });
    expect(storage.uploadBuffer).toHaveBeenCalledWith(expect.objectContaining({ contentType: "image/png", folder: "image-ads/p1" }));
    expect(db.project.update).toHaveBeenCalledWith({ where: { id: "p1" }, data: { imageAdSets: [expect.objectContaining({ version: 1, items: set.items })] } });
  }, 120_000);

  it("refuses to ship without hosted storage", async () => {
    storage.uploadBuffer.mockResolvedValue({ url: "data:image/png;base64,xx", provider: "inline", bytes: 1, publicId: "x" });
    await expect(generateImageAdSet("p1", { templates: ["hero-product"], formats: ["728x90"], assets: { product: await packshot() } })).rejects.toThrow(/storage/i);
  }, 120_000);

  it("needs a product image", async () => {
    await expect(generateImageAdSet("p1", { templates: ["hero-product"], formats: ["728x90"] })).rejects.toThrow(/product image/i);
  });
});
