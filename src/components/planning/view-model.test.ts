import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { END_CARDS, HOOKS, selectCreative } from "@/services/creative/library";
import { PLATFORM_PROFILES } from "@/services/creative/platforms.data";
import { finalizeBrief } from "@/services/creative/product-brief";
import { CAMPAIGN_PLAN_FIXTURE } from "./fixtures/campaign-plan.fixture";
import {
  CANVAS,
  PLATFORM_LABELS,
  beatTimeline,
  briefView,
  buildPlanRequest,
  EMPTY_PROMO,
  filterHooks,
  groupKeywordsByPlacement,
  mergePicks,
  parseEndCardLayout,
  planErrorMessage,
  profileSummary,
  promoPayload,
  splitLayout,
  togglePin,
} from "./view-model";

const rawBrief = JSON.parse(readFileSync(path.join(__dirname, "fixtures/nxt-brief.json"), "utf8"));

describe("briefView", () => {
  it("renders the NXTPAPER fixture as ranked points with score bars", () => {
    const v = briefView(rawBrief)!;
    expect(v.productName).toBe("TCL NXTPAPER 14");
    expect(v.bigIdea).toMatch(/matte tablet/);
    expect(v.alternates).toHaveLength(3);
    expect(v.points.map((p) => p.id)).toEqual(["sp-03", "sp-01", "sp-02", "sp-04", "sp-06", "sp-05"]);
    expect(v.points[0]).toMatchObject({ rank: 1, proofShot: "split_screen", scorePct: 91 });
    expect(v.objections.length).toBeGreaterThan(0);
    expect(v.objections[0].bustingVisual).not.toBe("");
    expect(v.gaps.length).toBe(5);
  });

  it("agrees with finalizeBrief's ranking (what the POST route stores)", () => {
    const stored = finalizeBrief(rawBrief, "tablet_laptop");
    const v = briefView(stored as never)!;
    expect(v.points.map((p) => p.id)).toEqual(stored.sellingPoints.map((p) => p.id));
    expect(v.points[0].scorePct).toBe(Math.round(stored.sellingPoints[0].priorityScore * 100));
  });

  it("tolerates empty or partial briefs", () => {
    expect(briefView(null)).toBeNull();
    const v = briefView({ sellingPoints: [{ claim: "Fast", scores: { buyerImportance: 1 } }, { claim: "" }] })!;
    expect(v.points).toHaveLength(1);
    expect(v.points[0].id).toBe("sp1");
    expect(v.points[0].scorePct).toBe(65); // .3·1 + .7·.5
    expect(v.productName).toBe("Product");
  });
});

describe("groupKeywordsByPlacement", () => {
  it("groups by placement in a stable order and folds vo into voice-over", () => {
    const g = groupKeywordsByPlacement(rawBrief.keywords);
    const order = g.map((x) => x.placement);
    expect(order[0]).toBe("hook_text");
    expect(order).toContain("voiceover");
    expect(order).not.toContain("vo");
    expect(g.find((x) => x.placement === "voiceover")!.terms).toContain("eye care tablet");
    expect(g.find((x) => x.placement === "hashtag")!.terms).toContain("#booktok");
  });
  it("puts placement-less terms under other", () => {
    expect(groupKeywordsByPlacement([{ term: "x" }])).toEqual([{ placement: "other", terms: ["x"] }]);
  });
});

describe("profileSummary", () => {
  it("summarises all 12 platform profiles with the fields the panel shows", () => {
    expect(PLATFORM_PROFILES).toHaveLength(12);
    for (const p of PLATFORM_PROFILES) {
      const s = profileSummary(p);
      expect(s.label).toBe(PLATFORM_LABELS[p.id]);
      const labels = s.rows.map((r) => r.label);
      for (const need of ["Audience", "Duration", "Aspect", "Hook by", "Pacing", "Voice-over", "Captions", "Music", "Safe zone"]) expect(labels).toContain(need);
      expect(s.rows.every((r) => r.value && !r.value.includes("undefined"))).toBe(true);
      expect(s.donts.length).toBeGreaterThan(0);
    }
  });
});

describe("hook library helpers", () => {
  it("filters the 35 hooks by family and text", () => {
    expect(HOOKS).toHaveLength(35);
    const all = filterHooks(HOOKS, "all");
    expect(all).toHaveLength(35);
    const byFamily = (["reveal", "claim", "native", "demo"] as const).map((f) => filterHooks(HOOKS, f).length);
    expect(byFamily.reduce((a, b) => a + b, 0)).toBe(35);
    expect(filterHooks(HOOKS, "reveal").every((h) => h.family === "reveal")).toBe(true);
    expect(filterHooks(HOOKS, "all", "turntable").map((h) => h.id)).toContain("H01");
  });

  it("merges pins ahead of auto picks, capped at 3", () => {
    const choice = selectCreative({ category: "electronics", platform: "tiktok", goal: "cold" });
    const autoIds = choice.hooks.map((h) => h.hook.id);
    expect(mergePicks(choice.hooks).map((p) => p.hookId)).toEqual(autoIds);
    const merged = mergePicks(choice.hooks, ["H35", autoIds[2]]);
    expect(merged.map((p) => p.hookId)).toEqual(["H35", autoIds[2], autoIds[0]]);
    expect(merged[0]).toMatchObject({ source: "pinned", why: ["pinned by you"] });
    expect(merged[1].why[0]).toBe("pinned");
    expect(mergePicks(choice.hooks, ["NOPE"], 3, new Set(HOOKS.map((h) => h.id))).map((p) => p.source)).toEqual(["auto", "auto", "auto"]);
  });

  it("toggles pins and drops the oldest past the cap", () => {
    expect(togglePin([], "H01")).toEqual(["H01"]);
    expect(togglePin(["H01"], "H01")).toEqual([]);
    expect(togglePin(["H01", "H02", "H03"], "H04")).toEqual(["H02", "H03", "H04"]);
  });
});

describe("parseEndCardLayout", () => {
  it("keeps quoted copy that contains a separator together", () => {
    const e06 = END_CARDS.find((e) => e.id === "E06")!;
    expect(splitLayout(e06.layout).some((s) => s.includes("4.6 · 12,480 reviews"))).toBe(true);
  });

  it("produces drawable boxes inside the canvas for all 12 end cards", () => {
    expect(END_CARDS).toHaveLength(12);
    for (const e of END_CARDS) {
      const boxes = parseEndCardLayout(e.layout);
      expect(boxes.length, e.id).toBeGreaterThanOrEqual(1);
      for (const b of boxes) {
        expect(b.y, `${e.id} ${b.label}`).toBeGreaterThanOrEqual(0);
        expect(b.y + b.h).toBeLessThanOrEqual(CANVAS.h);
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.x + b.w).toBeLessThanOrEqual(CANVAS.w);
      }
    }
  });

  it("reads explicit coordinates and centres size-only boxes", () => {
    const e01 = parseEndCardLayout(END_CARDS.find((e) => e.id === "E01")!.layout);
    expect(e01.map((b) => b.kind)).toEqual(["logo", "product", "text", "cta"]);
    expect(e01[3]).toMatchObject({ label: "pill", x: 290, w: 500, y: 1110, h: 110 });
    expect(e01[0]).toMatchObject({ x: 300, w: 480, y: 300, h: 100 });
    const e02 = parseEndCardLayout(END_CARDS.find((e) => e.id === "E02")!.layout);
    expect(e02[0]).toMatchObject({ label: "starburst", kind: "accent", x: 330, y: 390, w: 420, h: 420 });
  });
});

describe("beatTimeline", () => {
  it("lays out the fixture's TikTok script on a 0–100% track", () => {
    const tt = CAMPAIGN_PLAN_FIXTURE.platforms[0];
    const segs = beatTimeline(tt.scripts[0].beats, tt.durationSec);
    expect(segs[0]).toMatchObject({ purpose: "hook", leftPct: 0 });
    const last = segs[segs.length - 1];
    expect(last.leftPct + last.widthPct).toBeCloseTo(100, 1);
    expect(segs.every((s) => s.widthPct > 0)).toBe(true);
  });
  it("drops degenerate beats and clamps to the duration", () => {
    const segs = beatTimeline([{ t0: 2, t1: 2, purpose: "hook", visual: "" }, { t0: 5, t1: 12, purpose: "cta", visual: "" }], 10);
    expect(segs).toHaveLength(1);
    expect(segs[0].leftPct).toBeCloseTo(41.67, 1);
    expect(segs[0].leftPct + segs[0].widthPct).toBeCloseTo(100, 1);
  });
});

describe("requests", () => {
  it("builds the promo payload from form strings", () => {
    expect(promoPayload(EMPTY_PROMO)).toBeUndefined();
    expect(promoPayload({ pct: "25%", code: " NXT25 ", price: "$299.99", comparePrice: "349.97", deadline: "2026-10-31" })).toEqual({
      pct: 25,
      code: "NXT25",
      price: 299.99,
      comparePrice: 349.97,
      deadline: new Date("2026-10-31").toISOString(),
    });
    expect(promoPayload({ ...EMPTY_PROMO, deadline: "not a date", pct: "0" })).toBeUndefined();
  });

  it("builds the campaign-plan request with only real overrides", () => {
    const req = buildPlanRequest({ platforms: ["tiktok", "pinterest"], goal: "promo", promo: { ...EMPTY_PROMO, pct: "20" }, pins: { tiktok: ["H08"], snapchat: ["H04"] }, endCards: { pinterest: "E08" } });
    expect(req).toEqual({ platforms: ["tiktok", "pinterest"], goal: "promo", promo: { pct: 20 }, overrides: { tiktok: { hookIds: ["H08"] }, pinterest: { endCardId: "E08" } } });
    expect(buildPlanRequest({ platforms: ["tiktok"], goal: "cold", promo: EMPTY_PROMO, pins: {}, endCards: {} })).toEqual({ platforms: ["tiktok"], goal: "cold" });
  });

  it("explains planner failures", () => {
    expect(planErrorMessage(404)).toMatch(/not deployed yet/);
    expect(planErrorMessage(501, { error: "x" })).toMatch(/not deployed yet/);
    expect(planErrorMessage(404, { error: "Not found" })).toBe("Not found");
    expect(planErrorMessage(500, { error: "boom" })).toBe("boom");
  });
});
