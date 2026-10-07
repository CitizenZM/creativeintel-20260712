import { describe, expect, it, vi } from "vitest";
import { applyEmojiPolicy, channelFor, charCount, COPY_LIMITS, enforceCopy, generateAdCopy, smartTruncate, type CopyChannel } from "./ad-copy";

describe("COPY_LIMITS", () => {
  it("records the platform limits", () => {
    const lim = (c: CopyChannel, k: string) => COPY_LIMITS[c].fields.find((f) => f.key === k)!.limit;
    expect(lim("meta", "primaryText")).toBe(125);
    expect(lim("meta", "headline")).toBe(40);
    expect(lim("meta", "description")).toBe(30);
    expect(lim("tiktok", "adText")).toBe(100);
    expect(lim("youtube", "headline")).toBe(15);
    expect(lim("youtube", "longHeadline")).toBe(90);
    expect(lim("youtube", "description")).toBe(70);
    expect(lim("demand_gen", "headline")).toBe(40);
    expect(lim("demand_gen", "description")).toBe(90);
    expect(lim("pinterest", "title")).toBe(100);
    expect(lim("snapchat", "headline")).toBe(34);
  });

  it("maps platform ids to copy channels", () => {
    expect(channelFor("instagram_reels")).toBe("meta");
    expect(channelFor("meta_feed")).toBe("meta");
    expect(channelFor("youtube_bumper_6s")).toBe("youtube");
    expect(channelFor("google_demand_gen")).toBe("demand_gen");
    expect(channelFor("tiktok")).toBe("tiktok");
    expect(channelFor("snapchat")).toBe("snapchat");
  });
});

describe("smartTruncate", () => {
  it("leaves short text alone and normalises whitespace", () => {
    expect(smartTruncate("  Shop   now ", 40)).toBe("Shop now");
  });

  it("cuts at a sentence end when one lands late enough", () => {
    const t = "Glare-free paper screen. Reads like a book in full sun, all day long.";
    expect(smartTruncate(t, 40)).toBe("Glare-free paper screen.");
  });

  it("cuts at a word boundary and drops dangling joiners and punctuation", () => {
    const out = smartTruncate("The brightest mini-LED TV for the money and the best for sports", 40);
    expect(charCount(out)).toBeLessThanOrEqual(40);
    expect(out).toBe("The brightest mini-LED TV for the money");
    expect(smartTruncate("Bright, sharp, fast, and quiet: the one TV", 22)).toBe("Bright, sharp, fast");
  });

  it("hard-cuts one long word and never splits an emoji", () => {
    expect(smartTruncate("Supercalifragilisticexpialidocious", 10)).toBe("Supercalif");
    const e = smartTruncate("Deal 🔥🔥🔥🔥🔥", 7);
    expect(charCount(e)).toBeLessThanOrEqual(7);
    expect(e).not.toMatch(/\uD83D$/);
  });
});

describe("applyEmojiPolicy", () => {
  it("strips emoji where the platform doesn't take them, and caps them elsewhere", () => {
    expect(applyEmojiPolicy("Shop now 🔥 today 👇", COPY_LIMITS.tiktok.emoji)).toBe("Shop now today");
    expect(applyEmojiPolicy("🔥 Hot 🔥 deal 🔥 now 🔥", COPY_LIMITS.meta.emoji)).toBe("🔥 Hot 🔥 deal now");
  });
});

describe("enforceCopy", () => {
  it("truncates every field to its limit and reports which ones changed", () => {
    const r = enforceCopy("youtube", { headline: "Brightest TV ever made", longHeadline: "x", description: "ok", extra: "dropped" });
    expect(charCount(r.fields.headline)).toBeLessThanOrEqual(15);
    expect(r.truncated).toEqual(["headline"]);
    expect(r.fields).not.toHaveProperty("extra");
  });
});

describe("generateAdCopy", () => {
  const product = { brand: "TCL", name: "NXTPAPER 14", url: "https://example.com/p" };
  const brief = {
    bigIdea: { proposition: "Paper-like screen with zero glare", alternates: [] },
    sellingPoints: [
      { claim: "Matte NXTPAPER display kills glare", benefit: "Read in full sun" },
      { claim: "TÜV flicker-free", benefit: "Easy on your eyes all day" },
    ],
  };

  it("makes one LLM call for all platforms and enforces limits + emoji policy", async () => {
    const llm = vi.fn().mockResolvedValue({
      channels: [
        {
          channel: "meta",
          variants: [1, 2, 3, 4].map((i) => ({ angle: `a${i}`, fields: { primaryText: `Variant ${i} 🔥🔥🔥 ` + "glare-free reading ".repeat(12), headline: "The paper-like tablet that reads like a real book outside", description: "Zero glare. Zero flicker. Free returns." } })),
        },
        { channel: "tiktok", variants: [{ angle: "native", fields: { adText: "POV: you can finally read outside 😎 " + "no glare ".repeat(15) } }] },
      ],
    });
    const sets = await generateAdCopy({ product, brief: brief as never, platforms: ["instagram_reels", "meta_feed", "tiktok"], count: 4, llm });
    expect(llm).toHaveBeenCalledTimes(1);
    const meta = sets.find((s) => s.channel === "meta")!;
    expect(meta.platforms).toEqual(["instagram_reels", "meta_feed"]);
    expect(meta.source).toBe("llm");
    expect(meta.variants).toHaveLength(4);
    for (const v of meta.variants) {
      expect(charCount(v.fields.primaryText)).toBeLessThanOrEqual(125);
      expect(charCount(v.fields.headline)).toBeLessThanOrEqual(40);
      expect(charCount(v.fields.description)).toBeLessThanOrEqual(30);
      expect((v.fields.primaryText.match(/\p{Extended_Pictographic}/gu) ?? []).length).toBeLessThanOrEqual(2);
    }
    const tt = sets.find((s) => s.channel === "tiktok")!;
    // The model gave one; the scaffold pads to the requested count.
    expect(tt.variants).toHaveLength(4);
    expect(tt.variants[0].fields.adText).not.toMatch(/\p{Extended_Pictographic}/u);
    for (const v of tt.variants) expect(charCount(v.fields.adText)).toBeLessThanOrEqual(100);
  });

  it("falls back to the scaffold when the model fails", async () => {
    const llm = vi.fn().mockRejectedValue(new Error("no key"));
    const sets = await generateAdCopy({ product, brief: brief as never, platforms: ["youtube_shorts", "snapchat"], llm });
    expect(sets.map((s) => s.channel)).toEqual(["youtube", "snapchat"]);
    for (const s of sets) {
      expect(s.source).toBe("scaffold");
      expect(s.variants.length).toBeGreaterThanOrEqual(3);
      expect(s.variants.length).toBeLessThanOrEqual(5);
      for (const v of s.variants)
        for (const f of COPY_LIMITS[s.channel].fields) {
          expect(v.fields[f.key]?.length ?? 0).toBeGreaterThan(0);
          expect(charCount(v.fields[f.key])).toBeLessThanOrEqual(f.limit);
        }
    }
    expect(sets[1].variants[0].fields.brandName).toBe("TCL");
  });
});
