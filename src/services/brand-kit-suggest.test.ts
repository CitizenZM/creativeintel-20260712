import { describe, expect, it } from "vitest";
import {
  buildSuggestSources,
  emptyFieldKeys,
  extractLogoUrlFromHtml,
  mergeSuggestions,
  pickPackshotUrls,
  type ExistingKitValues,
} from "./brand-kit-suggest";

const EMPTY_KIT: ExistingKitValues = {
  colorsHex: null,
  fonts: null,
  ctaOptions: null,
  offerText: null,
  landingUrl: null,
  claimsAllowed: undefined,
  claimsForbidden: null,
  toneGuidelines: null,
  doNotShow: null,
  skuName: null,
  skuDimensionsCm: null,
  productSummary: null,
};

describe("emptyFieldKeys", () => {
  it("lists every field as empty for a fresh kit", () => {
    expect(emptyFieldKeys(EMPTY_KIT)).toEqual([
      "colors",
      "fonts",
      "cta",
      "offer",
      "landingUrl",
      "claimsAllowed",
      "claimsForbidden",
      "tone",
      "doNotShow",
      "skuName",
      "skuDimensions",
      "productSummary",
    ]);
  });

  it("treats an explicit empty claimsAllowed array as filled (user said 'no claims')", () => {
    const kit = { ...EMPTY_KIT, claimsAllowed: [] };
    expect(emptyFieldKeys(kit)).not.toContain("claimsAllowed");
  });

  it("treats null claimsAllowed as empty", () => {
    const kit = { ...EMPTY_KIT, claimsAllowed: null };
    expect(emptyFieldKeys(kit)).toContain("claimsAllowed");
  });

  it("excludes fields that already have a value", () => {
    const kit: ExistingKitValues = {
      ...EMPTY_KIT,
      colorsHex: [{ hex: "#000000" }],
      skuName: "Widget Pro",
    };
    const empty = emptyFieldKeys(kit);
    expect(empty).not.toContain("colors");
    expect(empty).not.toContain("skuName");
    expect(empty).toContain("fonts");
  });
});

describe("buildSuggestSources", () => {
  it("includes the best-available context lines in priority order", () => {
    const text = buildSuggestSources(
      {
        brandName: "Acme",
        brandUrl: "https://acme.com",
        productUrl: "https://acme.com/products/widget",
        productPageTitle: "Widget Pro",
        productPageText: "The best widget for home use.",
        productPageImages: null,
        category: "Home Goods",
        campaignGoal: "Awareness",
      },
      { productCategory: "Widgets", productDescription: "A widget" },
      [{ title: "Fast shipping", description: "Ships same day" }]
    );
    expect(text).toContain("BRAND: Acme");
    expect(text).toContain("CATEGORY: Home Goods");
    expect(text).toContain("PRODUCT PAGE TITLE: Widget Pro");
    expect(text).toContain("PRODUCT DESCRIPTION: A widget");
    expect(text).toContain("Fast shipping");
  });

  it("omits sections that are missing", () => {
    const text = buildSuggestSources(
      {
        brandName: "Acme",
        brandUrl: null,
        productUrl: null,
        productPageTitle: null,
        productPageText: null,
        productPageImages: null,
        category: null,
        campaignGoal: null,
      },
      null,
      []
    );
    expect(text).toBe("BRAND: Acme");
  });
});

describe("mergeSuggestions", () => {
  it("only fills fields that are in the empty list", () => {
    const { data, suggestedKeys } = mergeSuggestions(
      ["cta"],
      { colors: [{ hex: "#111111" }], ctaOptions: [{ text: "Shop now" }] },
      { landingUrl: null }
    );
    expect(data.colorsHex).toBeUndefined();
    expect(data.ctaOptions).toEqual([{ text: "Shop now", priority: 1 }]);
    expect(suggestedKeys).toEqual(["cta"]);
  });

  it("drops invalid hex colours", () => {
    const { data } = mergeSuggestions(
      ["colors"],
      { colors: [{ hex: "#123456" }, { hex: "not-a-color" }] },
      { landingUrl: null }
    );
    expect(data.colorsHex).toEqual([{ hex: "#123456", name: undefined, usage: undefined }]);
  });

  it("uses the productUrl/brandUrl fallback for landingUrl, never inventing one", () => {
    const { data, suggestedKeys } = mergeSuggestions(["landingUrl"], {}, { landingUrl: "https://acme.com/p/1" });
    expect(data.landingUrl).toBe("https://acme.com/p/1");
    expect(suggestedKeys).toEqual(["landingUrl"]);
  });

  it("does not mark claimsAllowed suggested when the AI returns an empty list", () => {
    const { data, suggestedKeys } = mergeSuggestions(["claimsAllowed"], { claimsAllowed: [] }, { landingUrl: null });
    expect(data.claimsAllowed).toBeUndefined();
    expect(suggestedKeys).not.toContain("claimsAllowed");
  });

  it("fills claimsAllowed when the AI found real claims", () => {
    const { data, suggestedKeys } = mergeSuggestions(
      ["claimsAllowed"],
      { claimsAllowed: ["Made from recycled steel"] },
      { landingUrl: null }
    );
    expect(data.claimsAllowed).toEqual(["Made from recycled steel"]);
    expect(suggestedKeys).toContain("claimsAllowed");
  });

  it("ignores skuDimensions with no numeric values", () => {
    const { data, suggestedKeys } = mergeSuggestions(["skuDimensions"], { skuDimensionsCm: {} }, { landingUrl: null });
    expect(data.skuDimensionsCm).toBeUndefined();
    expect(suggestedKeys).not.toContain("skuDimensions");
  });
});

describe("pickPackshotUrls", () => {
  it("picks up to max distinct http(s) URLs", () => {
    const images = [
      { url: "https://a.com/1.jpg" },
      { url: "https://a.com/2.jpg" },
      { url: "https://a.com/1.jpg" },
      { url: "not-a-url" },
      { url: "https://a.com/3.jpg" },
    ];
    expect(pickPackshotUrls(images, 2)).toEqual(["https://a.com/1.jpg", "https://a.com/2.jpg"]);
  });

  it("returns an empty array for non-array input", () => {
    expect(pickPackshotUrls(null, 4)).toEqual([]);
    expect(pickPackshotUrls(undefined, 4)).toEqual([]);
  });
});

describe("extractLogoUrlFromHtml", () => {
  it("prefers an image the site labels as its logo, and ignores og:image banners", () => {
    const html = `<html><head><meta property="og:image" content="/summer-sale-banner.jpg"><link rel="icon" href="/favicon.ico"></head>
      <body><header><img class="site-logo" src="/assets/brand-logo.svg" alt="Brand"></header></body></html>`;
    expect(extractLogoUrlFromHtml(html, "https://brand.com")).toBe("https://brand.com/assets/brand-logo.svg");
  });

  it("does not use og:image as a logo", () => {
    const html = `<head><meta property="og:image" content="/banner.jpg"><link rel="icon" href="/favicon.ico"></head>`;
    expect(extractLogoUrlFromHtml(html, "https://brand.com")).toBe("https://brand.com/favicon.ico");
  });

  it("falls back to apple-touch-icon then favicon", () => {
    const touchIcon = `<link rel="apple-touch-icon" href="https://cdn.brand.com/touch.png">`;
    expect(extractLogoUrlFromHtml(`<head>${touchIcon}</head>`, "https://brand.com")).toBe(
      "https://cdn.brand.com/touch.png"
    );

    const favicon = `<link rel="icon" href="/fav.png">`;
    expect(extractLogoUrlFromHtml(`<head>${favicon}</head>`, "https://brand.com")).toBe(
      "https://brand.com/fav.png"
    );
  });

  it("returns null when nothing is found", () => {
    expect(extractLogoUrlFromHtml("<head></head>", "https://brand.com")).toBeNull();
  });
});
