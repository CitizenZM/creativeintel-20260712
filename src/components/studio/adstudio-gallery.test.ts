import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { HOOK_MOCK_IDS } from "./hook-mock";
import { HOOKS } from "@/services/creative/library";
import { OPENING_STYLE } from "@/services/video-gen/adstudio-catalog";
import { STRIP_OK } from "./adstudio-gallery";
import { END_CLIPS, HOOK_CLIPS } from "@/services/video-gen/adstudio-clips";
import { END_CARDS } from "@/services/creative/library";

describe("visual hook and end-card gallery", () => {
  it("every house hook H01–H35 has an animated mock", () => {
    expect([...HOOK_MOCK_IDS].sort()).toEqual(HOOKS.map((h) => h.id).sort());
  });
  it("every enforced opening style has its strip in public/; only strips that really show the style are displayed", () => {
    for (const st of new Set(Object.values(OPENING_STYLE))) expect(existsSync(`public/adstudio/styles/${st}.jpg`), st).toBe(true);
    expect(STRIP_OK.has("product_hero")).toBe(false); // that strip shows a person and a fade, not a product hero
    expect([...STRIP_OK].every((st) => Object.values(OPENING_STYLE).includes(st))).toBe(true);
  });
  it("wiring: the panel renders both galleries and the preview route draws with Xark's end-card code", () => {
    const panel = readFileSync("src/components/studio/adstudio-panel.tsx", "utf8");
    expect(panel).toMatch(/<OpeningGallery openings=\{openings\} value=\{openingId\} onChange=\{setOpeningId\}/);
    expect(panel).toMatch(/<EndingGallery projectId=\{projectId\}/);
    expect(readFileSync("src/components/studio/adstudio-gallery.tsx", "utf8")).toMatch(/studio\/adstudio-endcard-preview\?card=\$\{id\}&theme=\$\{theme\}/);
    expect(readFileSync("src/app/api/projects/[projectId]/studio/adstudio-endcard-preview/route.ts", "utf8")).toMatch(/endCardLayers\(card, \{ \.\.\.sample, skus, theme \}, C, look\)/);
  });
  it("real example clips: every listed clip exists, belongs to a real hook / end card, at most 3 each", () => {
    const hookIds = new Set(HOOKS.map((h) => h.id)), endIds = new Set(END_CARDS.map((e) => e.id));
    for (const [map, ids] of [[HOOK_CLIPS, hookIds], [END_CLIPS, endIds]] as const) {
      for (const [id, clips] of Object.entries(map)) {
        expect(ids.has(id as never), id).toBe(true);
        expect(clips.length).toBeGreaterThan(0);
        expect(clips.length).toBeLessThanOrEqual(3);
        for (const c of clips) expect(existsSync(`public${c.src}`), c.src).toBe(true);
      }
    }
    // production ships only our own finished ads; third-party reference clips stay out of public/ (hooks without a clip show the mock)
    const all = [...Object.values(HOOK_CLIPS), ...Object.values(END_CLIPS)].flat();
    expect(all.filter((c) => c.kind === "reference")).toEqual([]);
    expect(Object.keys(HOOK_CLIPS).length).toBeGreaterThanOrEqual(10);
    expect(Object.keys(END_CLIPS).length).toBeGreaterThanOrEqual(2);
    const listed = new Set([...Object.values(HOOK_CLIPS), ...Object.values(END_CLIPS)].flat().map((c) => c.src.split("/").pop()));
    expect(readdirSync("public/adstudio/clips").filter((f) => !listed.has(f))).toEqual([]); // no orphan files shipped
  });
  it("wiring: the runs API sends the clips and the Auto picks, and the panel passes them to both galleries", () => {
    expect(readFileSync("src/app/api/projects/[projectId]/studio/adstudio-runs/route.ts", "utf8")).toMatch(/auto: planDefaults\(plan\?\.campaignPlan\), hookClips: HOOK_CLIPS, endClips: END_CLIPS/);
    const panel = readFileSync("src/components/studio/adstudio-panel.tsx", "utf8");
    expect(panel).toMatch(/setHookClips\(j\.hookClips \?\? \{\}\)/);
    expect(panel).toMatch(/clips=\{hookClips\} autoId=\{auto\.hookId\}/);
    expect(panel).toMatch(/clips=\{endClips\} autoId=\{auto\.endCardId\}/);
  });
});
