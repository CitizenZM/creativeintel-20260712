import { describe, expect, it } from "vitest";
import { END_CARDS, HOOKS, inGiftingWindow, platformBrief, platformProfile, SAFE_BOX, selectCreative } from "./library";
import { PLATFORM_PROFILES } from "./platforms.data";

const now = new Date().toISOString();

describe("creative library data", () => {
  it("has 12 platform profiles, 35 hooks in 4 families and 12 end cards", () => {
    expect(PLATFORM_PROFILES).toHaveLength(12);
    expect(HOOKS).toHaveLength(35);
    expect(new Set(HOOKS.map((h) => h.family))).toEqual(new Set(["reveal", "claim", "native", "demo"]));
    expect(END_CARDS).toHaveLength(12);
    expect(HOOKS.every((h) => h.keyframe && h.motion && h.durationSec[1] >= h.durationSec[0])).toBe(true);
  });

  it("keeps readable layers inside the strict safe box (TikTok/Reels/Shorts bottom 35%)", () => {
    expect(SAFE_BOX.bottom).toBeLessThanOrEqual(1920 - 672);
    expect(platformProfile("instagram_reels").safeZone.bottom).toBe(672);
  });

  it("summarises a platform for prompts", () => {
    const b = platformBrief("tiktok");
    expect(b).toContain("hook + key message by 3s");
    expect(b.split(/\s+/).length).toBeLessThan(160);
  });
});

describe("selectCreative", () => {
  it("TV Black Friday on TikTok in the gifting window: gift + deal hooks, three different families, gift-tag close", () => {
    const c = selectCreative({
      category: "electronics",
      platform: "tiktok",
      goal: "promo",
      runDate: "2026-11-27T12:00:00Z",
      promo: { price: 999.99, comparePrice: 1499.99, priceCheckedAt: now },
    });
    const ids = c.hooks.map((h) => h.hook.id);
    expect(ids).toHaveLength(3);
    expect(new Set(c.hooks.map((h) => (h.hook.family === "demo" ? "native" : h.hook.family))).size).toBe(3);
    expect(ids.some((id) => id === "H06" || id === "H24" || id === "H16")).toBe(true);
    expect(c.endCard.id).toBe("E08");
    expect(c.alternates.map((e) => e.id)).toContain("E04");
    expect(c.labels.join(" ")).toContain("AI-generated");
  });

  it("refuses price cards and the deal slam without a fresh, verified compare-at price", () => {
    const stale = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const c = selectCreative({ category: "electronics", platform: "meta_feed", goal: "retarget", runDate: "2026-03-10", promo: { price: 999, comparePrice: 1499, priceCheckedAt: stale } });
    expect(c.hooks.map((h) => h.hook.id)).not.toContain("H16");
    expect([c.endCard.id, ...c.alternates.map((e) => e.id)]).not.toContain("E04");
    expect(c.notes.join(" ")).toMatch(/E04 .* skipped/);
  });

  it("drops face-heavy creator hooks without real footage, and result claims for health", () => {
    const beauty = selectCreative({ category: "beauty", platform: "tiktok", goal: "cold", runDate: "2026-03-10" });
    expect(beauty.hooks.map((h) => h.hook.id)).not.toContain("H17");
    expect(beauty.notes.join(" ")).toContain("H17");
    const health = selectCreative({ category: "health", platform: "instagram_reels", goal: "cold", runDate: "2026-03-10", assets: { creatorFootage: true } });
    expect(health.hooks.map((h) => h.hook.id)).not.toEqual(expect.arrayContaining(["H10"]));
    expect(health.hooks.map((h) => h.hook.id)).not.toContain("H15");
  });

  it("uses a coupon ticket only with a live code, a QR card only for CTV, app card only for installs", () => {
    expect(selectCreative({ category: "kitchen", platform: "meta_feed", goal: "promo", runDate: "2026-03-10", promo: { code: "SAVE15" } }).endCard.id).toBe("E03");
    expect(selectCreative({ category: "electronics", platform: "youtube_instream_skippable", goal: "awareness", runDate: "2026-03-10", ctv: true }).endCard.id).toBe("E11");
    expect(selectCreative({ category: "electronics", platform: "youtube_instream_skippable", goal: "awareness", runDate: "2026-03-10" }).endCard.id).toBe("E01");
    expect(selectCreative({ category: "apps", platform: "tiktok", goal: "app_install", runDate: "2026-03-10" }).endCard.id).toBe("E10");
  });
});

describe("inGiftingWindow", () => {
  it("covers holiday, Valentine's and the 3 weeks before Mother's Day", () => {
    expect(inGiftingWindow("2026-11-27")).toBe(true);
    expect(inGiftingWindow("2026-12-28")).toBe(false);
    expect(inGiftingWindow("2026-02-10")).toBe(true);
    expect(inGiftingWindow("2026-05-01")).toBe(true); // Mother's Day 2026-05-10
    expect(inGiftingWindow("2026-06-01")).toBe(false);
  });
});

describe("goal fit", () => {
  it("never opens an awareness ad with a price slam, even during a sale", () => {
    const c = selectCreative({ category: "electronics", platform: "youtube_instream_skippable", goal: "awareness", runDate: "2026-11-27T12:00:00Z", promo: { pct: 25 } });
    expect(c.hooks.map((h) => h.hook.id)).not.toContain("H16");
  });
});
