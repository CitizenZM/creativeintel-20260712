import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ADSTUDIO_FORMATS, ADSTUDIO_WORKFLOWS, OPENING_STYLE, isFormat, isWorkflow } from "./adstudio-catalog";
import { pickOpeningEnding, refUrlOf } from "./adstudio-queue";
import { endCardData } from "./adstudio-endcard";
import { HOOKS } from "@/services/creative/library";

const ADSTUDIO_STYLES = ["text_slab", "punch", "flash", "whip", "cap_bold", "cap_boxed", "cap_clean", "q_card", "interview", "product_lock", "single_scene", "testimonial", "product_hero", "broll_open", "ai_talk"];
const plan = { platforms: [{ hookVariants: [{ hookId: "H09" }, { hookId: "H14" }], endCard: { id: "E04" } }] };

describe("workflows, imitation styles, reference sources", () => {
  it("three workflows and the Ad Studio formats", () => {
    expect(ADSTUDIO_WORKFLOWS.map((w) => w.id)).toEqual(["storyboard", "reference", "replace"]);
    expect(isWorkflow("replace")).toBe(true); expect(isWorkflow("x")).toBe(false);
    expect(ADSTUDIO_FORMATS.map((f) => f.id)).toEqual(["auto", "product_lock", "interview", "testimonial", "single_scene", "montage"]);
    expect(isFormat("interview")).toBe(true);
  });
  it("a reference source is ref:<url>", () => {
    expect(refUrlOf("ref:https://www.tiktok.com/@a/video/1")).toBe("https://www.tiktok.com/@a/video/1");
    expect(refUrlOf("script:abc")).toBeNull();
  });
});

describe("opening (H01–H35) and ending (E01–E12)", () => {
  it("every mapped opening is a real hook and a real Ad Studio style", () => {
    const ids = new Set(HOOKS.map((h) => h.id));
    for (const [h, st] of Object.entries(OPENING_STYLE)) { expect(ids.has(h)).toBe(true); expect(ADSTUDIO_STYLES).toContain(st); }
    expect(HOOKS.length).toBe(35);
  });
  it("auto takes the campaign plan's hook and end card; explicit picks win; '' means none", () => {
    const a = pickOpeningEnding({ openingId: "auto", endCardId: "auto" }, plan);
    expect(a.opening).toMatchObject({ id: "H09", style: null }); expect(a.opening?.keyframe).toBeTruthy();
    expect(a.endCard).toEqual({ id: "E04", name: "Price + strike-through", theme: "brand" });
    const b = pickOpeningEnding({ openingId: "H01", endCardId: "E02", endCardTheme: "festive" }, plan);
    expect(b.opening).toMatchObject({ id: "H01", style: "product_hero" }); expect(b.endCard?.theme).toBe("festive");
    expect(pickOpeningEnding({ openingId: "", endCardId: "" }, plan)).toEqual({ opening: null, endCard: null });
    expect(pickOpeningEnding({ openingId: "auto", endCardId: "auto" }, null)).toEqual({ opening: null, endCard: null });
  });
  it("end-card data comes from the run's offer and brand kit", () => {
    const d = endCardData({ offer: { text: "Holiday sale", was: 40, now: 30, code: "GLOW" }, brandKit: { ctaOptions: [{ text: "Shop now" }], landingUrl: "https://x.com/p" } }, "dark");
    expect(d).toMatchObject({ headline: "Holiday sale", pct: 25, price: 30, comparePrice: 40, code: "GLOW", button: "Shop now", url: "https://x.com/p", theme: "dark" });
  });
  it("no offer: the headline falls back to the brand promise, then the top selling point, then the product name", () => {
    expect(endCardData({ context: { brand: { promise: "A whole routine in one mist, anywhere you go" } } }, "brand").headline).toBe("A whole routine in one mist");
    // a long promise with no short clause is skipped, never cut mid-sentence
    expect(endCardData({ context: { brand: { promise: "Deliver a complete skincare routine in seconds for busy travellers everywhere" }, insights: { sellingPoints: [{ point: "Routine in seconds" }] } } }, "brand").headline).toBe("Routine in seconds");
    expect(endCardData({ context: { insights: { sellingPoints: [{ point: "Hydrates in 3 seconds" }] } } }, "brand").headline).toBe("Hydrates in 3 seconds");
    expect(endCardData({ project: { productName: "Glow Mist" } }, "brand").headline).toBe("Glow Mist");
  });
  it("wiring: batch stores workflow/opening/endCard/format, worker route serves end cards, panel posts the picks, free runs can finish from planning", () => {
    const q = readFileSync("src/services/video-gen/adstudio-queue.ts", "utf8");
    expect(q).toMatch(/input: json\((applyBudgetMode\()?\{ \.\.\.base, \.\.\.extra,/);
    expect(q).toMatch(/const freeRun = r\.engine === FREE_ENGINE \|\| visualModeOf\(r\.input\) === "slides";/); expect(q).toMatch(/r\.status === "planning" && freeRun/); // only free runs (remix or slides), not any run with no estimate yet
    expect(readFileSync("src/app/api/worker/adstudio/route.ts", "utf8")).toMatch(/case "endcard":\s+return NextResponse\.json\(await renderRunEndCard/);
    expect(readFileSync("src/components/studio/adstudio-panel.tsx", "utf8")).toMatch(/storyboardId: activeId, workflow, hookTypes: pickHooks, engines: pickEngines, notes, openingId, endCardId, endCardTheme: endTheme, format/);
  });
});
