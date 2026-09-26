import { describe, expect, it } from "vitest";
import { createProjectSchema, isLikelyNonProductUrl } from "./validations";

describe("isLikelyNonProductUrl", () => {
  it("flags storefront roots and listing pages", () => {
    expect(isLikelyNonProductUrl("https://www.brand.com/")).toBe(true);
    expect(isLikelyNonProductUrl("https://brand.com")).toBe(true);
    expect(isLikelyNonProductUrl("https://shop.brand.com/")).toBe(true);
    expect(isLikelyNonProductUrl("https://brand.com/collections/bags")).toBe(true);
    expect(isLikelyNonProductUrl("https://amazon.com/s?k=luggage")).toBe(true);
  });
  it("accepts product pages", () => {
    expect(isLikelyNonProductUrl("https://brand.com/products/weekender-set")).toBe(false);
    expect(isLikelyNonProductUrl("https://amazon.com/dp/B0ABC12345")).toBe(false);
    expect(isLikelyNonProductUrl("https://ramp.com/corporate-cards")).toBe(false);
  });
  it("accepts a dedicated product subdomain's root (a landing page, not a storefront)", () => {
    expect(isLikelyNonProductUrl("https://speedrun.a16z.com/")).toBe(false);
    expect(isLikelyNonProductUrl("https://copilot.github.com")).toBe(false);
  });
  it("accepts a homepage for service categories that have no PDP", () => {
    expect(isLikelyNonProductUrl("https://notion.so/", { category: "SaaS & Software" })).toBe(false);
    expect(isLikelyNonProductUrl("https://brand.com/", { category: "Fashion & Apparel" })).toBe(true);
  });
});

describe("createProjectSchema", () => {
  const base = { brandName: "a16z", competitors: [{ name: "Y Combinator" }] };
  it("lets a service brand use its homepage as the product URL", () => {
    expect(createProjectSchema.safeParse({ ...base, category: "Financial Services", productUrl: "https://a16z.com/" }).success).toBe(true);
  });
  it("still rejects a physical-goods homepage, on the productUrl field", () => {
    const r = createProjectSchema.safeParse({ ...base, category: "Fashion & Apparel", productUrl: "https://brand.com/" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(["productUrl"]);
  });
});
