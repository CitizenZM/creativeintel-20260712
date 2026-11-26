import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { normalizeCompetitor, normalizeProductInput } from "./brand-name";

describe("normalizeCompetitor", () => {
  it("turns a pasted domain into a brand name and keeps it as the URL", () => {
    expect(normalizeCompetitor("WWW.hoka.com")).toEqual({ name: "Hoka", url: "https://www.hoka.com/" });
    expect(normalizeCompetitor("https://www.brooksrunning.com/en_us")).toEqual({
      name: "Brooksrunning",
      url: "https://www.brooksrunning.com/en_us",
    });
  });

  it("uses the registrable label for country TLDs", () => {
    expect(normalizeCompetitor("shop.gymshark.co.uk").name).toBe("Gymshark");
  });

  it("does not overwrite a URL the user gave separately", () => {
    expect(normalizeCompetitor("hoka.com", "https://www.hoka.com/en/us/")).toEqual({
      name: "Hoka",
      url: "https://www.hoka.com/en/us/",
    });
  });

  it("keeps brand names that are styled as a domain", () => {
    expect(normalizeCompetitor("Booking.com")).toEqual({ name: "Booking.com", url: "https://booking.com/" });
    expect(normalizeCompetitor("Amazon.com", "https://www.amazon.com")).toEqual({
      name: "Amazon.com",
      url: "https://www.amazon.com/",
    });
  });

  it("leaves ordinary brand names alone apart from whitespace", () => {
    expect(normalizeCompetitor("  Nature’s   Bounty ")).toEqual({ name: "Nature’s Bounty", url: null });
    expect(normalizeCompetitor("Dr. Squatch")).toEqual({ name: "Dr. Squatch", url: null });
    expect(normalizeCompetitor("Ritual", "ritual.com")).toEqual({ name: "Ritual", url: "https://ritual.com/" });
  });
});

describe("normalizeProductInput", () => {
  it("moves a product URL pasted into the name field into productUrl", () => {
    const url = "https://im8health.com/products/the-beckham-stack-pro";
    expect(normalizeProductInput({ productName: url, productUrl: "" })).toEqual({ productName: "", productUrl: url });
    expect(normalizeProductInput({ productName: `  ${url}  ` })).toEqual({ productName: "", productUrl: url });
  });

  it("leaves a URL in the name alone when productUrl is already set", () => {
    const input = { productName: "https://a.com/p/1", productUrl: "https://b.com/p/2" };
    expect(normalizeProductInput(input)).toEqual(input);
  });

  it("keeps plain names that look like domains as names", () => {
    expect(normalizeProductInput({ productName: "Notion.so Pro", productUrl: "" })).toEqual({
      productName: "Notion.so Pro",
      productUrl: "",
    });
    expect(normalizeProductInput({ productName: "shop.example.com" })).toEqual({ productName: "shop.example.com" });
  });

  it("does not treat non-http schemes as product URLs", () => {
    expect(normalizeProductInput({ productName: "ftp://files.example.com/x", productUrl: "" })).toEqual({
      productName: "ftp://files.example.com/x",
      productUrl: "",
    });
  });

  it("is applied by the create-project route before the body is parsed", () => {
    expect(readFileSync("src/app/api/projects/route.ts", "utf8")).toMatch(
      /createProjectSchema\.parse\(normalizeProductInput\(body\)\)/
    );
  });
});
