import { describe, expect, it } from "vitest";
import { ADSTUDIO_ENGINES, ADSTUDIO_HOOK_TYPES, ADSTUDIO_MAX_VARIANTS, AdStudioPickError, planVariants } from "./adstudio-catalog";

describe("planVariants", () => {
  it("makes one variant per hook type × engine; the first engine of each hook type leads", () => {
    const v = planVariants(["keep", "pain"], ["auto", "kling3", "seedance2"]);
    expect(v.map((x) => `${x.hookType}/${x.engine}/${x.leader}`)).toEqual([
      "keep/auto/true", "keep/kling3/false", "keep/seedance2/false",
      "pain/auto/true", "pain/kling3/false", "pain/seedance2/false",
    ]);
    // engines of one hook type share the sound; hook types differ
    expect(new Set(v.filter((x) => x.hookType === "keep").map((x) => x.soundProfile)).size).toBe(1);
    expect(v[0].soundProfile).not.toBe(v[3].soundProfile);
  });
  it("drops unknown ids and duplicates, refuses empty picks and more than the limit", () => {
    expect(planVariants(["bold", "bold", "nope"], ["auto", "x"]).length).toBe(1);
    expect(() => planVariants([], ["auto"])).toThrow(AdStudioPickError);
    expect(() => planVariants(["bold"], [])).toThrow(AdStudioPickError);
    expect(() => planVariants(["bold", "pain", "story"], ["auto", "kling3", "wan3"])).toThrow(/limit is 6/);
    expect(ADSTUDIO_MAX_VARIANTS).toBe(6);
  });
  it("ids match the Mac pipeline (ad-studio pipeline/hooks.mjs HOOK_TYPES, pipeline/generate.mjs ENGINES)", () => {
    expect(ADSTUDIO_HOOK_TYPES.map((h) => h.id).sort()).toEqual(["bold", "curiosity", "interrupt", "keep", "offer", "pain", "question", "result", "social", "story"]);
    expect(ADSTUDIO_ENGINES.map((e) => e.id).sort()).toEqual(["auto", "h3", "kling3", "omni", "seedance15", "seedance2", "seedance2fast", "veo31fast", "veo31lite", "wan3"]);
  });
});
