import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectFeedFormat, normalizeAvailability, parseCsv, parseFeed, parsePrice, stripHtml } from "./feeds";

const fx = (name: string) => readFileSync(path.join(__dirname, "__fixtures__", name), "utf8");

describe("parsePrice", () => {
  it("reads amount and currency in the usual feed spellings", () => {
    expect(parsePrice("29.99 USD")).toEqual({ amount: 29.99, currency: "USD" });
    expect(parsePrice("USD 29.99")).toEqual({ amount: 29.99, currency: "USD" });
    expect(parsePrice("$1,299.00")).toEqual({ amount: 1299, currency: "USD" });
    expect(parsePrice("1.299,50 EUR")).toEqual({ amount: 1299.5, currency: "EUR" });
    expect(parsePrice("12,5 €")).toEqual({ amount: 12.5, currency: "EUR" });
    expect(parsePrice("£40")).toEqual({ amount: 40, currency: "GBP" });
    expect(parsePrice(89.99)).toEqual({ amount: 89.99, currency: null });
    expect(parsePrice("")).toEqual({ amount: null, currency: null });
    expect(parsePrice("call us")).toEqual({ amount: null, currency: null });
  });
});

describe("stripHtml / availability", () => {
  it("drops tags, decodes entities and keeps list items apart", () => {
    expect(stripHtml("<p>Crispy &amp; golden</p><ul><li>One</li><li>Two&nbsp;x</li></ul>")).toBe("Crispy & golden. One. Two x");
    expect(stripHtml("Tiny camera &mdash; 39 g")).toBe("Tiny camera — 39 g");
    expect(stripHtml(null)).toBe("");
  });
  it("maps feed spellings to one vocabulary", () => {
    expect(normalizeAvailability("in stock")).toBe("in_stock");
    expect(normalizeAvailability("InStock")).toBe("in_stock");
    expect(normalizeAvailability("available for order")).toBe("in_stock");
    expect(normalizeAvailability("out of stock")).toBe("out_of_stock");
    expect(normalizeAvailability("preorder")).toBe("preorder");
    expect(normalizeAvailability("backorder")).toBe("backorder");
    expect(normalizeAvailability(true)).toBe("in_stock");
    expect(normalizeAvailability(undefined)).toBe("unknown");
  });
});

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, embedded commas and newlines, CRLF and BOM", () => {
    const rows = parseCsv('﻿a,b,c\r\n1,"x, ""y""","multi\nline"\r\n2,,\n');
    expect(rows).toEqual([
      ["a", "b", "c"],
      ["1", 'x, "y"', "multi\nline"],
      ["2", "", ""],
    ]);
  });
  it("splits on tabs for TSV", () => {
    expect(parseCsv("a\tb\n1\t2", "\t")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("detectFeedFormat", () => {
  it("recognizes each fixture", () => {
    expect(detectFeedFormat(fx("shopify-products.json"))).toBe("shopify");
    expect(detectFeedFormat(fx("google-merchant.xml"))).toBe("google-xml");
    expect(detectFeedFormat(fx("google-merchant.tsv"))).toBe("google-tsv");
    expect(detectFeedFormat(fx("meta-catalog.csv"))).toBe("meta-csv");
    expect(detectFeedFormat(fx("generic.csv"))).toBe("generic-csv");
  });
});

describe("parseFeed — Shopify products.json", () => {
  const out = parseFeed(fx("shopify-products.json"), { sourceUrl: "https://shop.example/products.json" });
  it("normalizes one record per product, sale price from compare_at_price", () => {
    expect(out.format).toBe("shopify");
    expect(out.products).toHaveLength(3);
    const fryer = out.products[0];
    expect(fryer).toMatchObject({
      sku: "CS-LE-5QT-BLK",
      title: "Cosori Pro LE Air Fryer 5 Qt",
      price: 119.99,
      salePrice: 89.99,
      brand: "Cosori",
      category: "Air Fryers",
      availability: "in_stock",
      url: "https://shop.example/products/cosori-pro-le-air-fryer",
      images: ["https://cdn.shopify.com/s/files/1/airfryer-front.jpg", "https://cdn.shopify.com/s/files/1/airfryer-side.jpg"],
    });
    expect(fryer.description).toContain("Crispy & golden");
    expect(fryer.description).not.toMatch(/<|&amp;|&ndash;/);
    expect(fryer.features).toEqual(["5 qt basket fits a 4 lb whole chicken", "Dishwasher-safe, nonstick basket cleans in seconds", "9 one-touch presets – fries, wings, steak"]);
    expect(fryer.customLabels.tags).toBe("kitchen, bestseller");
  });
  it("edge cases: no sku → handle, compare_at == price → no sale, no images, unavailable, trimmed title", () => {
    const [, earrings, light] = out.products;
    expect(earrings).toMatchObject({ sku: "huggie-hoop-earrings", price: 24, salePrice: null, images: [], availability: "out_of_stock" });
    expect(light).toMatchObject({ title: "Rockbros USB-C Bike Light 1000 Lumens", category: null, salePrice: null, price: 39.99 });
  });
  it("takes the currency from the caller (products.json has none)", () => {
    expect(parseFeed(fx("shopify-products.json"), { currency: "cad" }).products[0].currency).toBe("CAD");
  });
});

describe("parseFeed — Google Merchant XML", () => {
  const out = parseFeed(fx("google-merchant.xml"));
  it("reads g: fields, all images, labels and sale dates; first id wins on duplicates", () => {
    expect(out.format).toBe("google-xml");
    expect(out.products.map((p) => p.sku)).toEqual(["LV-CORE300", "TCL-85QM8", "LV-FILTER"]);
    const p = out.products[0];
    expect(p).toMatchObject({
      title: "Levoit Core 300 True HEPA Air Purifier",
      price: 99.99,
      salePrice: 79.99,
      currency: "USD",
      brand: "Levoit",
      category: "Home & Garden > Household Appliances > Climate Control Appliances > Air Purifiers",
      availability: "in_stock",
      url: "https://levoit.example/products/core-300?utm_source=feed",
      images: ["https://levoit.example/img/core300.jpg", "https://levoit.example/img/core300-2.jpg", "https://levoit.example/img/core300-3.jpg"],
      customLabels: { custom_label_0: "bfcm", custom_label_2: "hero", product_type: "Air Purifiers", sale_ends: "2026-11-30T23:59-08:00" },
    });
    expect(p.description).toBe("Cleans a 219 sq ft room in 12 minutes. 24 dB sleep mode & 3-stage filtration.");
    expect(out.skipped).toEqual([{ row: 4, sku: "LV-CORE300", reason: "duplicate sku" }]);
  });
  it("g:title, thousands separators, preorder, missing image", () => {
    const [, tv, filter] = out.products;
    expect(tv).toMatchObject({ title: 'TCL 85" QM8 Mini LED 4K TV', price: 1299, availability: "preorder", salePrice: null });
    expect(filter).toMatchObject({ images: [], availability: "out_of_stock", description: "" });
  });
});

describe("parseFeed — Google Merchant TSV", () => {
  const out = parseFeed(fx("google-merchant.tsv"));
  it("splits additional images on commas and decodes entities", () => {
    expect(out.format).toBe("google-tsv");
    expect(out.products[0]).toMatchObject({
      sku: "NXT-14",
      price: 299.99,
      salePrice: 249.99,
      currency: "USD",
      description: "Paper-like matte screen & 8000 mAh battery",
      images: ["https://tcl.example/img/nxt14.jpg", "https://tcl.example/img/nxt14-b.jpg", "https://tcl.example/img/nxt14-c.jpg"],
      customLabels: { custom_label_0: "q4" },
    });
    expect(out.products[1]).toMatchObject({ sku: "NXT-11", images: [], availability: "out_of_stock", price: 199 });
  });
});

describe("parseFeed — Meta catalog CSV", () => {
  const out = parseFeed(fx("meta-catalog.csv"));
  it("reads quoted multi-line fields and Meta columns; rows without a title are skipped with a reason", () => {
    expect(out.format).toBe("meta-csv");
    expect(out.products).toHaveLength(2);
    expect(out.products[0]).toMatchObject({
      sku: "OTT-P3",
      price: 129.99,
      salePrice: 99.99,
      category: "vehicles & parts > car electronics",
      images: ["https://img.example/p3.jpg", "https://img.example/p3-b.jpg", "https://img.example/p3-c.jpg"],
      customLabels: { custom_label_0: "amazon", custom_label_1: "bfcm, top", item_group_id: "P3" },
    });
    expect(out.products[0].description).toBe("Wireless CarPlay & Android Auto, plug-and-play. Works with 2016+ factory wired CarPlay cars.");
    expect(out.products[1]).toMatchObject({ sku: "OTT-MINI", description: "Tiny wireless adapter", availability: "in_stock", salePrice: null });
    expect(out.skipped).toEqual([{ row: 3, sku: "OTT-BAD", reason: "no title" }]);
  });
});

describe("parseFeed — generic CSV", () => {
  const out = parseFeed(fx("generic.csv"));
  it("maps common column aliases and merges Shopify-export image rows by handle", () => {
    expect(out.format).toBe("generic-csv");
    expect(out.products).toHaveLength(2);
    expect(out.products[0]).toMatchObject({
      sku: "CINSAAQ",
      title: "Insta360 X5 360 Camera",
      price: 599.99,
      salePrice: 549.99,
      currency: "USD",
      brand: "Insta360",
      category: "360 Cameras",
      images: ["https://img.example/x5-front.jpg", "https://img.example/x5-back.jpg"],
      features: ["Waterproof to 15 m", "185 min battery"],
    });
    expect(out.products[1]).toMatchObject({ sku: "CINSABK", currency: "EUR", description: "Tiny thumb-size camera — 39 g", salePrice: null });
  });
  it("honours an explicit format hint and reports unreadable input", () => {
    expect(parseFeed("sku,name,price\nA1,Thing,5.00", { format: "generic-csv" }).products[0]).toMatchObject({ sku: "A1", title: "Thing", price: 5 });
    expect(() => parseFeed("{not json", { format: "shopify" })).toThrow(/Shopify/);
    expect(() => parseFeed("   ")).toThrow(/empty/i);
  });
  it("drops a sale price that is not below the regular price (with a warning)", () => {
    const r = parseFeed("sku,title,price,sale_price\nA,Thing,10,12", { format: "generic-csv" });
    expect(r.products[0]).toMatchObject({ price: 10, salePrice: null });
    expect(r.warnings.join(" ")).toMatch(/A: sale price 12 ≥ price 10/);
  });
});
