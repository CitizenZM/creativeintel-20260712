import { describe, expect, it } from "vitest";
import { categoryFromBrief, runSelection, selectBodySchema } from "./_select";

describe("creative-select body", () => {
  it("requires a known platform and goal", () => {
    expect(selectBodySchema.safeParse({ goal: "cold" }).success).toBe(false);
    expect(selectBodySchema.safeParse({ platform: "myspace", goal: "cold" }).success).toBe(false);
    expect(selectBodySchema.safeParse({ platform: "tiktok", goal: "viral" }).success).toBe(false);
    expect(selectBodySchema.safeParse({ platforms: ["tiktok", "pinterest"], goal: "promo", promo: { pct: 20 } }).success).toBe(true);
  });

  it("maps the brief's sp-1 category to the library category", () => {
    expect(categoryFromBrief({ category: "tablet_laptop" })).toBe("electronics");
    expect(categoryFromBrief({ category: "nonsense" })).toBeUndefined();
    expect(categoryFromBrief(null)).toBeUndefined();
  });

  it("runs the selector per platform, 3 hooks + an end card each", () => {
    const body = selectBodySchema.parse({ platforms: ["tiktok", "instagram_reels"], goal: "cold" });
    const out = runSelection("electronics", body, new Date("2026-10-06T00:00:00Z"));
    expect(out.map((o) => o.platform)).toEqual(["tiktok", "instagram_reels"]);
    for (const o of out) {
      expect(o.choice.hooks).toHaveLength(3);
      expect(o.choice.endCard.id).toMatch(/^E\d\d$/);
    }
  });

  it("treats a typed price + compare-at as freshly checked so the strike-through card is allowed", () => {
    const body = selectBodySchema.parse({ platform: "meta_feed", goal: "promo", promo: { price: 299, comparePrice: 349 } });
    const [{ choice }] = runSelection("electronics", body, new Date());
    expect([choice.endCard.id, ...choice.alternates.map((a) => a.id)]).toContain("E04");
  });
});
