import { describe, expect, it } from "vitest";
import { DEFAULT_CASTING, PERSONAS, personaById, personaCast, pickPersona, resolveCasting } from "./personas";

describe("presenter personas", () => {
  it("has ~16 complete personas with unique ids, Edge + Veo voices and platform fits", () => {
    expect(PERSONAS.length).toBeGreaterThanOrEqual(15);
    expect(new Set(PERSONAS.map((p) => p.id)).size).toBe(PERSONAS.length);
    for (const p of PERSONAS) {
      expect(p.look.ageRange[0]).toBeLessThan(p.look.ageRange[1]);
      expect(p.look.styling && p.look.wardrobe && p.setting && p.energy).toBeTruthy();
      expect(p.voice.edge).toMatch(/^en-US-\w+Neural$/);
      expect(p.voice.veo.length).toBeGreaterThan(10);
      expect(p.platforms.length).toBeGreaterThan(0);
    }
  });

  it("writes a casting-sheet description from the look", () => {
    const cast = personaCast(personaById("reels-kitchen-mom")!);
    expect(cast).toMatch(/white woman/i);
    expect(cast).toMatch(/kitchen|cardigan|apron|sweater/i);
  });

  it("defaults casting to white or Latino people (owner preference), configurable", () => {
    expect(DEFAULT_CASTING.ethnicities).toEqual(["white", "latino"]);
    expect(resolveCasting({}).ethnicities).toEqual(["white", "latino"]);
    // A per-call override wins, then the project's stored preference, then the brand table, then env.
    expect(resolveCasting({ override: { ethnicities: ["black"] }, project: { ethnicities: ["east_asian"] } }).ethnicities).toEqual(["black"]);
    expect(resolveCasting({ project: { ethnicities: ["east_asian"] }, brandName: "TCL" }).ethnicities).toEqual(["east_asian"]);
    expect(resolveCasting({ brandName: "TCL" }).ethnicities).toEqual(["white", "latino"]);
    expect(resolveCasting({ env: "black, south_asian" }).ethnicities).toEqual(["black", "south_asian"]);
    expect(resolveCasting({ env: "any" }).ethnicities).toBeUndefined();
    // Garbage is ignored, not trusted.
    expect(resolveCasting({ project: { ethnicities: ["martian"] } }).ethnicities).toEqual(["white", "latino"]);
  });

  it("picks by platform, category and audience inside the casting default", () => {
    const tt = pickPersona("tiktok", "beauty", "Gen Z women 18-24 into skincare");
    expect(tt.platforms).toContain("tiktok");
    expect(["white", "latino"]).toContain(tt.look.ethnicity);
    expect(tt.look.gender).toBe("woman");
    expect(tt.look.ageRange[0]).toBeLessThan(26);

    const yt = pickPersona("youtube_instream_skippable", "electronics", "tech buyers comparing TVs");
    expect(yt.id).toMatch(/reviewer/);

    const dad = pickPersona("meta_feed", "auto", "dads 40+ who work on their own cars");
    expect(dad.look.gender).toBe("man");
    expect(dad.look.ageRange[1]).toBeGreaterThanOrEqual(45);

    const mom = pickPersona("instagram_reels", "kitchen", "busy moms cooking for the family");
    expect(mom.look.gender).toBe("woman");
    expect(mom.setting).toMatch(/kitchen/i);
  });

  it("is deterministic and honours a wider casting / exclusions", () => {
    expect(pickPersona("tiktok", "electronics", "")).toEqual(pickPersona("tiktok", "electronics", ""));
    const any = PERSONAS.filter((p) => p.look.ethnicity !== "white" && p.look.ethnicity !== "latino");
    expect(any.length).toBeGreaterThan(0);
    const wide = pickPersona("tiktok", "beauty", "", { casting: { ethnicities: [any[0].look.ethnicity] } });
    expect(wide.look.ethnicity).toBe(any[0].look.ethnicity);
    const first = pickPersona("tiktok", "beauty", "");
    expect(pickPersona("tiktok", "beauty", "", { exclude: [first.id] }).id).not.toBe(first.id);
  });
});
