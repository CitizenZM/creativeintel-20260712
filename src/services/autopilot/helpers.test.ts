import { describe, expect, it } from "vitest";
import { brandFromUrl, newRowId, parsePrice } from "./helpers";

describe("autopilot helpers", () => {
  it("newRowId is cuid-shaped (the project-slug middleware matches it) and unique", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newRowId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^c[a-z0-9]{20,32}$/);
  });

  it("parsePrice reads US and EU formats", () => {
    expect(parsePrice("$1,299.99")).toBe(1299.99);
    expect(parsePrice("1.299,99 €")).toBe(1299.99);
    expect(parsePrice("USD 49")).toBe(49);
    expect(parsePrice(19.5)).toBe(19.5);
    expect(parsePrice("free")).toBeNull();
    expect(parsePrice(undefined)).toBeNull();
    expect(parsePrice(0)).toBeNull();
  });

  it("brandFromUrl prefers the scraped brand, else the site name", () => {
    expect(brandFromUrl("https://www.anker.com/products/a1", null)).toBe("Anker");
    expect(brandFromUrl("https://shop.levoit.co.uk/p", "")).toBe("Levoit");
    expect(brandFromUrl("https://x.com", "TCL")).toBe("TCL");
    expect(brandFromUrl("not a url")).toBe("Brand");
  });
});
