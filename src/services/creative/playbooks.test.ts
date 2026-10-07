import { describe, expect, it } from "vitest";
import { CATEGORY_PLAYBOOKS, CTA_COPY, HOOK_FORMULAS, PLATFORM_PLAYBOOKS, categoryPlaybook, playbookSlice } from "./playbooks";
import { PLATFORM_PROFILES } from "./platforms.data";
import { SP_CATEGORIES } from "./product-brief";
import type { CampaignGoal, PlatformId } from "./types";

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const GOALS: CampaignGoal[] = ["cold", "retarget", "promo", "awareness", "app_install", "lead"];

describe("playbooks data", () => {
  it("covers every sp-1 category and every platform profile", () => {
    expect(Object.keys(CATEGORY_PLAYBOOKS).sort()).toEqual([...SP_CATEGORIES].sort());
    expect(Object.keys(PLATFORM_PLAYBOOKS).sort()).toEqual(PLATFORM_PROFILES.map((p) => p.id).sort());
    expect(Object.keys(CTA_COPY).sort()).toEqual([...GOALS].sort());
    for (const c of Object.values(CATEGORY_PLAYBOOKS)) {
      expect(c.proofShots.length).toBeGreaterThanOrEqual(2);
      expect(c.objections.length).toBeGreaterThanOrEqual(2);
    }
    expect(HOOK_FORMULAS.find((h) => h.name.startsWith("Sale pitch"))?.example).toMatch(/New Year gift\? → 20% OFF this Black Friday/);
  });

  it("maps creative-library categories to the right playbook", () => {
    expect(categoryPlaybook("electronics").label).toBe("TVs");
    expect(categoryPlaybook("kitchen").label).toMatch(/kitchen/i);
    expect(categoryPlaybook("unknown-x").label).toBe("General products");
  });
});

describe("playbookSlice", () => {
  it("stays within the word cap for every category × platform × goal", () => {
    for (const category of SP_CATEGORIES)
      for (const p of PLATFORM_PROFILES)
        for (const goal of GOALS) {
          expect(words(playbookSlice({ category, platform: p.id as PlatformId, goal }))).toBeLessThanOrEqual(400);
          expect(words(playbookSlice({ category, platform: p.id as PlatformId, goal, forDirector: true, maxWords: 250 }))).toBeLessThanOrEqual(250);
        }
    expect(words(playbookSlice({ category: "tv", platform: "tiktok", goal: "promo", maxWords: 60 }))).toBeLessThanOrEqual(60);
  });

  it("is category-specific", () => {
    const tv = playbookSlice({ category: "tv", platform: "tiktok", goal: "cold" });
    const air = playbookSlice({ category: "home_air_cleaning", platform: "tiktok", goal: "cold" });
    expect(tv).toMatch(/sun-glare split/);
    expect(tv).not.toMatch(/PM2\.5/);
    expect(air).toMatch(/PM2\.5/);
    expect(air).not.toMatch(/sun-glare/);
  });

  it("is platform-specific", () => {
    const tiktok = playbookSlice({ category: "tv", platform: "tiktok", goal: "cold" });
    const feed = playbookSlice({ category: "tv", platform: "meta_feed", goal: "cold" });
    expect(tiktok).toMatch(/PLATFORM GRAMMAR — tiktok/);
    expect(tiktok).not.toMatch(/meta_feed/);
    expect(feed).toMatch(/PLATFORM GRAMMAR — meta_feed[\s\S]*sound-off/);
  });

  it("leads with the goal's hook formulas and CTA copy", () => {
    const promo = playbookSlice({ category: "tv", platform: "tiktok", goal: "promo" });
    expect(promo).toMatch(/HOOK FORMULAS: Sale pitch \(first 3 s\)/);
    expect(promo).toMatch(/CTA COPY \(promo\)/);
    const director = playbookSlice({ category: "tv", platform: "tiktok", goal: "promo", forDirector: true });
    expect(director).not.toMatch(/HOOK FORMULAS|CTA COPY/);
    expect(director).toMatch(/zoom lands on the product/);
  });
});
