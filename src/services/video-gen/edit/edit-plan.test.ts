import { describe, expect, it } from "vitest";
import { hookHeadline, isClaimWorthShowing, isCtaLine, planEdit, type PlanInputSegment } from "./edit-plan";

const clip = (n: number, url: string, segment: string, text?: string): PlanInputSegment => ({
  kind: "clip",
  url,
  from: 0,
  length: 2,
  frameNumber: n,
  segment,
  text,
});
const still = (n: number, url: string, segment: string, text?: string): PlanInputSegment => ({ ...clip(n, url, segment, text), kind: "still" });

// A 20 s ad: 2 hook frames, 6 body frames, 2 CTA frames.
const ad: PlanInputSegment[] = [
  clip(1, "k1", "HOOK", "Is your TV too dark?"),
  clip(2, "k1", "HOOK"),
  clip(3, "k3", "BODY", "2,100+ dimming zones"),
  clip(4, "k3", "BODY"),
  still(5, "k5", "BODY"),
  clip(6, "k6", "BODY", "Shop the Seasonal Sale today and save"),
  clip(7, "k7", "BODY"),
  clip(8, "k7", "BODY"),
  still(9, "prod", "CTA", "Save $200 — Shop now"),
  still(10, "prod", "CTA"),
];

describe("planEdit", () => {
  const plan = planEdit(ad, { voiceovers: new Map([[3, "Over two thousand dimming zones"]]) });

  it("tiles the timeline exactly, every boundary on a 120 BPM beat frame", () => {
    expect(plan.durationSec).toBe(20);
    expect(plan.shots[0].startSec).toBe(0);
    expect(plan.shots[plan.shots.length - 1].endSec).toBe(20);
    for (let i = 1; i < plan.shots.length; i++) expect(plan.shots[i].startSec).toBe(plan.shots[i - 1].endSec);
    for (const b of plan.boundaries) expect(Math.abs(b.atSec / 0.5 - Math.round(b.atSec / 0.5))).toBeLessThan(1e-9);
    expect(plan.shots.reduce((n, s) => n + s.frames, 0)).toBe(600);
  });

  it("cuts the hook densest: 1 s shots alternating wide and punch-in", () => {
    const hook = plan.shots.filter((s) => s.segment === "HOOK");
    expect(hook.map((s) => s.endSec - s.startSec)).toEqual([1, 1, 1, 1]);
    expect(hook.map((s) => s.zoom)).toEqual([1, 1.22, 1, 1.22]);
  });

  it("never holds a still for a whole frame and merges the CTA into one end card", () => {
    const five = plan.shots.filter((s) => s.frameNumber === 5);
    expect(five.map((s) => s.motion)).toEqual(["push", "pull"]);
    const cta = plan.shots.filter((s) => s.segment === "CTA");
    expect(cta).toHaveLength(1);
    expect([cta[0].startSec, cta[0].endSec]).toEqual([16, 20]);
  });

  it("puts the drop flash on hook→body, a whip into the CTA, and rotates body transitions", () => {
    expect(plan.dropSec).toBe(4);
    expect(plan.boundaries.find((b) => b.atSec === 4)?.transition).toBe("flash");
    expect(plan.boundaries.find((b) => b.atSec === 16)?.transition).toBe("whip");
    expect(plan.breakdownSec).toBe(14);
    const body = plan.boundaries.filter((b) => b.atSec > 4 && b.atSec < 16 && b.transition !== "cut");
    expect(new Set(body.map((b) => b.transition)).size).toBeGreaterThan(1);
    expect(plan.sfx.find((e) => e.kind === "impact")?.atSec).toBe(4);
    expect(plan.sfx.some((e) => e.kind === "click" && e.atSec > 16)).toBe(true);
  });

  it("shows the hook headline, short new claims only, and the offer on the end card", () => {
    expect(plan.cards.map((c) => [c.role, c.text])).toEqual([
      ["hook", "Is your TV too dark?"],
      ["claim", "2,100+ dimming zones"],
      ["offer", "Save $200 — Shop now"],
    ]);
  });
});

describe("isClaimWorthShowing", () => {
  it("drops long lines and lines the voiceover already says", () => {
    expect(isClaimWorthShowing("Shop the Seasonal Sale today and save big", null)).toBe(false);
    expect(isClaimWorthShowing("Meet Ramp", "Meet Ramp, the corporate card")).toBe(false);
    expect(isClaimWorthShowing("4K at 144Hz", "Silky motion for gaming")).toBe(true);
  });
});

describe("hookHeadline", () => {
  it("keeps a short hook, prefers the quoted question, and drops a sentence too long to read", () => {
    expect(hookHeadline("Is your TV too dark?")).toBe("Is your TV too dark?");
    expect(hookHeadline("You're probably thinking… 'Is this TV too bright for my living room?'")).toBe("Is this TV too bright for my living room?");
    expect(hookHeadline("We spent three years building the brightest and thinnest television anyone has ever made")).toBeNull();
    expect(hookHeadline("Tired of TV screens that wash out in daylight?")).toBe("Tired of TV screens that wash out in daylight?");
  });
});

describe("isCtaLine", () => {
  it("spots an offer line that already asks for the click", () => {
    expect(isCtaLine("Shop Now")).toBe(true);
    expect(isCtaLine("Save $200 this weekend")).toBe(false);
  });
});

describe("hook variants", () => {
  it("rewrites only the opening shot: contrast flags it, product blast swaps in the packshot", () => {
    const base = planEdit(ad);
    const c = planEdit(ad, { hookStyle: "c" });
    const p = planEdit(ad, { hookStyle: "p", hookText: "3,000 nits. Daylight-proof." });
    expect(c.shots[0].contrast).toBe(true);
    expect(p.shots[0]).toMatchObject({ kind: "still", url: "prod", motion: "push" });
    expect(p.cards[0]).toMatchObject({ role: "hook", text: "3,000 nits. Daylight-proof." });
    for (const v of [c, p]) {
      expect(v.shots.slice(1).map((s) => [s.url, s.startSec])).toEqual(base.shots.slice(1).map((s) => [s.url, s.startSec]));
      // The cut out of the opener may change (product → footage gets a whip); the rest is identical.
      expect(v.boundaries.slice(1)).toEqual(base.boundaries.slice(1));
    }
  });
});

describe("planEdit on a real track's beats", () => {
  it("starts at 0 even when the first detected beat is a frame later, and keeps every cut on a beat", () => {
    const beats = Array.from({ length: 40 }, (_, i) => Math.round((1 / 30 + i * 0.6) * 1000) / 1000); // 100 BPM, offset one frame
    const p = planEdit(ad, { beats });
    expect(p.shots[0].startSec).toBe(0);
    expect(p.shots.reduce((n, s) => n + s.frames, 0)).toBe(Math.round(p.durationSec * 30));
    for (const b of p.boundaries) expect(p.grid.beats.some((x) => Math.abs(x - b.atSec) < 0.017)).toBe(true);
  });
});
