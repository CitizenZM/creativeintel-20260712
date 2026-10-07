import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const llm = vi.hoisted(() => ({ analyzeWithClaude: vi.fn(async () => { throw new Error("no model calls in briefLite"); }) }));
vi.mock("@/services/ai/claude-client", () => llm);

import { productBriefSchema } from "@/services/creative/product-brief";
import { briefLite, catalogCategory, extractSpecClaims } from "./brief-lite";
import { parseFeed } from "./feeds";
import type { CatalogProduct } from "./types";

const fx = (name: string) => readFileSync(path.join(__dirname, "__fixtures__", name), "utf8");
const shopify = parseFeed(fx("shopify-products.json"), { sourceUrl: "https://shop.example/products.json", currency: "USD" }).products;
const google = parseFeed(fx("google-merchant.xml")).products;

const bare = (over: Partial<CatalogProduct>): CatalogProduct => ({ sku: "X", title: "Thing", description: "", features: [], price: null, salePrice: null, currency: null, images: [], url: null, brand: null, category: null, availability: "unknown", customLabels: {}, ...over });

describe("catalogCategory", () => {
  it("classifies from title, feed category and product type", () => {
    expect(catalogCategory(shopify[0])).toBe("kitchen_appliance");
    expect(catalogCategory(shopify[1])).toBe("fashion_jewelry");
    expect(catalogCategory(shopify[2])).toBe("sports_outdoor_cycling");
    expect(catalogCategory(google[0])).toBe("home_air_cleaning");
    expect(catalogCategory(google[1])).toBe("tv");
    expect(catalogCategory(bare({ title: "Mystery box" }))).toBe("other");
  });
});

describe("extractSpecClaims", () => {
  it("pulls sentences that carry a real number + unit", () => {
    const claims = extractSpecClaims("Up to 5,000 nits peak brightness. Looks great. 144Hz native refresh.");
    expect(claims).toEqual(["Up to 5,000 nits peak brightness", "144Hz native refresh"]);
  });
});

describe("briefLite", () => {
  it("builds a valid sp-1 brief from feed fields with no model call", () => {
    const brief = briefLite(shopify[0]);
    expect(() => productBriefSchema.parse(brief)).not.toThrow();
    expect(llm.analyzeWithClaude).not.toHaveBeenCalled();
    expect(brief.category).toBe("kitchen_appliance");
    expect(brief.product).toMatchObject({ name: "Cosori Pro LE Air Fryer 5 Qt", brand: "Cosori", price: 89.99 });
    expect(brief.sellingPoints.length).toBeGreaterThanOrEqual(3);
    expect(brief.sellingPoints.length).toBeLessThanOrEqual(6);
    for (const sp of brief.sellingPoints) {
      expect(sp.claim.trim()).not.toBe("");
      expect(sp.proofVisual.shot.trim()).not.toBe("");
      expect(sp.sourceEvidence.length).toBeGreaterThan(0);
    }
    expect(brief.gaps.join(" ")).toMatch(/feed-only lite brief/);
  });

  it("matches each claim to the category playbook's proof shot", () => {
    const brief = briefLite(shopify[0]);
    const clean = brief.sellingPoints.find((s) => /Dishwasher/.test(s.claim))!;
    expect(clean.proofVisual.shot).toMatch(/wiped|dishwasher/i);
    const chicken = brief.sellingPoints.find((s) => /whole chicken/.test(s.claim))!;
    expect(chicken.proofVisual.shot).toMatch(/chicken/i);
    expect(chicken.evidenceStrength).toBe("measured_spec");
  });

  it("ranks numeric spec claims over plain copy and fills big idea, objections, keywords and a beat map", () => {
    const brief = briefLite(google[1]);
    expect(brief.sellingPoints[0].claim).toMatch(/5,000 nits|144Hz/);
    expect(brief.bigIdea.proposition.split(/\s+/).length).toBeLessThanOrEqual(12);
    expect(brief.objections.length).toBeGreaterThan(0);
    expect(brief.keywords.length).toBeGreaterThan(3);
    expect(brief.beatMap.beats.map((b) => b.purpose)).toEqual(expect.arrayContaining(["hook", "proof", "brand_cta"]));
  });

  it("is deterministic", () => {
    expect(briefLite(google[0])).toEqual(briefLite(google[0]));
  });

  it("falls back to the playbook when the feed says almost nothing, and records the gaps", () => {
    const brief = briefLite(bare({ title: "Levoit Air Purifier", brand: "Levoit" }));
    expect(brief.category).toBe("home_air_cleaning");
    expect(brief.sellingPoints.length).toBeGreaterThanOrEqual(2);
    expect(brief.gaps.join(" ")).toMatch(/no description/);
    expect(brief.gaps.join(" ")).toMatch(/no image/);
    expect(brief.product.price).toBeUndefined();
  });
});
