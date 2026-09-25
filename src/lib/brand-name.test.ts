import { describe, expect, it } from "vitest";
import { normalizeCompetitor } from "./brand-name";

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

  it("leaves ordinary brand names alone apart from whitespace", () => {
    expect(normalizeCompetitor("  Nature’s   Bounty ")).toEqual({ name: "Nature’s Bounty", url: null });
    expect(normalizeCompetitor("Dr. Squatch")).toEqual({ name: "Dr. Squatch", url: null });
    expect(normalizeCompetitor("Ritual", "ritual.com")).toEqual({ name: "Ritual", url: "https://ritual.com/" });
  });
});
