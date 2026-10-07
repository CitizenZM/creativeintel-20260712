import { describe, expect, it } from "vitest";
import { CATEGORY_MOOD, isMoodId, MOOD_IDS, MOOD_TEMPO, moodFromText, moodsInText, pickMusicMood, PLATFORM_MOOD } from "./music-moods";
import { PLATFORM_PROFILES } from "@/services/creative/platforms.data";
import { SP_CATEGORIES } from "@/services/creative/product-brief";

describe("music moods", () => {
  it("has the two original beds plus at least six new ones, each with a tempo range around its nominal tempo", () => {
    expect(MOOD_IDS).toEqual(expect.arrayContaining(["pop", "holiday", "upbeat-pop", "chill-lofi", "cinematic-build", "energetic-edm", "warm-acoustic", "luxury-minimal"]));
    for (const id of MOOD_IDS) {
      const t = MOOD_TEMPO[id];
      expect(t.min).toBeLessThanOrEqual(t.bpm);
      expect(t.max).toBeGreaterThanOrEqual(t.bpm);
    }
    expect(isMoodId("chill-lofi")).toBe(true);
    expect(isMoodId("jazz")).toBe(false);
  });

  it("maps musicMood strings to moods", () => {
    expect(moodFromText("chill lo-fi, soft beat")).toBe("chill-lofi");
    expect(moodFromText("cinematic/modern bed under VO, ducked")).toBe("cinematic-build");
    expect(moodFromText("trend-style, punchy")).toBe("upbeat-pop");
    expect(moodFromText("high-energy house")).toBe("energetic-edm");
    expect(moodFromText("warm acoustic guitar")).toBe("warm-acoustic");
    expect(moodFromText("sonic logo / sting")).toBe("luxury-minimal");
    expect(moodFromText("upbeat holiday pop")).toBe("upbeat-pop");
    expect(moodsInText("upbeat holiday pop")).toEqual(["upbeat-pop", "holiday"]);
    expect(moodFromText("energetic-edm")).toBe("energetic-edm");
    expect(moodFromText("")).toBeNull();
    expect(moodFromText("whatever")).toBeNull();
  });

  it("picks by plan mood id, then seasonal copy, then the named moods (category first), category, platform", () => {
    expect(pickMusicMood({ planMood: "luxury-minimal", copy: "Black Friday gift" })).toBe("luxury-minimal");
    expect(pickMusicMood({ planMood: "trending-style track, >120 BPM", copy: "Want a New Year gift?" })).toBe("holiday");
    expect(pickMusicMood({ planMood: "on-trend aesthetic pop/lo-fi/house", category: "home_air_cleaning" })).toBe("chill-lofi");
    expect(pickMusicMood({ planMood: "on-trend aesthetic pop/lo-fi/house", category: "camera_creator" })).toBe("upbeat-pop");
    expect(pickMusicMood({ planMood: "", category: "fashion_jewelry", platform: "tiktok" })).toBe("luxury-minimal");
    expect(pickMusicMood({ platform: "snapchat" })).toBe("energetic-edm");
    expect(pickMusicMood({})).toBe("upbeat-pop");
  });

  it("covers every platform profile and every product category", () => {
    for (const p of PLATFORM_PROFILES) expect(PLATFORM_MOOD[p.id], p.id).toBeDefined();
    for (const c of SP_CATEGORIES) expect(CATEGORY_MOOD[c], c).toBeDefined();
    // every platform's own musicStyle text resolves to a mood
    for (const p of PLATFORM_PROFILES) expect(isMoodId(pickMusicMood({ planMood: p.musicStyle, platform: p.id }))).toBe(true);
  });
});
