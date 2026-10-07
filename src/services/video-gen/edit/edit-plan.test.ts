import { describe, expect, it } from "vitest";
import { MAX_SHOT_SEC, hookHeadline, isClaimWorthShowing, isCtaLine, planEdit, type PlanInputSegment } from "./edit-plan";

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

  it("never holds a still for a whole frame and merges the CTA into one end card, cut in two framings", () => {
    const five = plan.shots.filter((s) => s.frameNumber === 5);
    expect(five.map((s) => s.motion)).toEqual(["push", "pull"]);
    const cta = plan.shots.filter((s) => s.segment === "CTA");
    expect(cta).toHaveLength(2);
    expect([cta[0].startSec, cta[1].endSec]).toEqual([16, 20]);
    expect(cta[1].zoom).toBeGreaterThan(cta[0].zoom);
  });

  it("never holds one framing longer than 2 s", () => {
    for (const s of plan.shots) expect(s.endSec - s.startSec).toBeLessThanOrEqual(MAX_SHOT_SEC + 1e-6);
  });

  it("uses transitions, not plain cuts, in the opening 3 s and on the last two cuts, all silent", () => {
    const strong = [...plan.boundaries.filter((b) => b.atSec <= 3), ...plan.boundaries.slice(-2)];
    expect(strong.length).toBeGreaterThan(2);
    expect(strong.every((b) => b.transition !== "cut")).toBe(true);
    // Transitions are silent: the only sound effect is the CTA pop.
    expect(plan.sfx.map((e) => e.kind)).toEqual(["click"]);
  });

  it("puts the drop flash on hook→body, a whip into the CTA, and rotates body transitions", () => {
    expect(plan.dropSec).toBe(4);
    expect(plan.boundaries.find((b) => b.atSec === 4)?.transition).toBe("flash");
    expect(plan.boundaries.find((b) => b.atSec === 16)?.transition).toBe("whip");
    expect(plan.breakdownSec).toBe(14);
    const body = plan.boundaries.filter((b) => b.atSec > 4 && b.atSec < 16 && b.transition !== "cut");
    expect(new Set(body.map((b) => b.transition)).size).toBeGreaterThan(1);
    expect(plan.sfx.some((e) => e.kind === "impact")).toBe(false);
    expect(plan.sfx.find((e) => e.kind === "click")?.atSec).toBe(19);
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
    expect(isClaimWorthShowing("Meet the new Ramp card", "Meet the new Ramp card for teams")).toBe(false);
    // A 1–4 word keyword is shown even when the voiceover says it.
    expect(isClaimWorthShowing("Meet Ramp", "Meet Ramp, the corporate card")).toBe(true);
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
  it("starts at 0 even when the first detected beat is a frame later; a cut goes on a beat within ±120 ms, else stays on its frame", () => {
    const beats = Array.from({ length: 40 }, (_, i) => Math.round((1 / 30 + i * 0.6) * 1000) / 1000); // 100 BPM, offset one frame
    const p = planEdit(ad, { beats });
    expect(p.shots[0].startSec).toBe(0);
    expect(p.shots.reduce((n, s) => n + s.frames, 0)).toBe(Math.round(p.durationSec * 30));
    for (const b of p.boundaries) {
      const onGrid = p.grid.beats.some((x) => Math.abs(x - b.atSec) < 0.017);
      expect(onGrid || p.offBeatCuts.includes(b.atSec)).toBe(true);
    }
    // Every frame boundary is within 120 ms of where the storyboard put it.
    for (let t = 2; t < 20; t += 2) expect(p.boundaries.some((b) => Math.abs(b.atSec - t) <= 0.12 + 1e-6)).toBe(true);
    expect(p.offBeatCuts.length).toBeGreaterThan(0);
    expect(p.offBeatCuts.length).toBeLessThan(p.boundaries.length);
  });
});

describe("planEdit beat-synced cuts on a mood's tempo", () => {
  const seg = (n: number, url: string, segment: string, length: number): PlanInputSegment => ({ kind: "clip", url, from: 0, length, frameNumber: n, segment });
  // 1.9 s frames at 120 BPM: each boundary is 100 ms off a beat in alternating directions.
  const frames = [seg(1, "a", "HOOK", 1.9), seg(2, "b", "BODY", 2), seg(3, "c", "BODY", 2), seg(4, "d", "CTA", 2)];

  it("snaps a frame boundary to a beat within ±120 ms", () => {
    const p = planEdit(frames, { bpm: 120 });
    expect(p.boundaries.map((b) => b.atSec)).toContain(2);
    expect(p.dropSec).toBe(2);
  });

  it("never moves a cut later than the voiceover line that starts there", () => {
    const vo = new Map<number, string | null>([[1, "Want a gift?"], [2, "Meet the tablet."], [3, "Meet the tablet."], [4, "Shop now."]]);
    const p = planEdit(frames, { bpm: 120, voiceovers: vo });
    // frame 2 starts at 1.9 s with a new line: the beat at 2.0 is later → the cut stays at 1.9 s.
    expect(p.dropSec).toBeCloseTo(1.9, 3);
    expect(p.offBeatCuts).toContain(p.dropSec);
    // frame 3 repeats frame 2's line: its boundary (3.9 s) may move to the 4.0 s beat.
    expect(p.boundaries.map((b) => b.atSec)).toContain(4);
  });

  it("carries the product box and the frame's source window to the shots", () => {
    const box = { start: [0.55, 0.5, 0.85, 0.85] as [number, number, number, number], end: null, present: true };
    const p = planEdit([{ ...seg(1, "a", "BODY", 2), productBox: box, speed: 2 }, seg(2, "b", "CTA", 2)]);
    const s = p.shots.find((x) => x.url === "a")!;
    expect(s.productBox).toEqual(box);
    expect(s.frameSrc).toEqual({ from: 0, span: 4 });
  });
});

describe("planEdit — locked-script features", () => {
  const seg = (n: number, url: string, segment: string, length: number, extra: Partial<PlanInputSegment> = {}): PlanInputSegment => ({ kind: "clip", url, from: 0, length, frameNumber: n, segment, ...extra });
  const ad: PlanInputSegment[] = [
    seg(1, "door", "HOOK", 1, { text: "BLACK FRIDAY" }),
    seg(2, "install", "HOOK", 1, { text: "FREE INSTALLATION INCLUDED*", speed: 4 }),
    seg(3, "tear", "HOOK", 1, { text: "SURPRISE — TCL HOLIDAY FREE INSTALLATION INCLUDED*" }),
    seg(4, "nits", "BODY", 1.5, { text: "3,000 NITS", zoomHit: { x: 0.5, y: 0.3 } }),
    seg(5, "front", "CTA", 1.5, { kind: "still", text: "BLACK FRIDAY DEAL — SHOP AT TCL.COM", fine: "*Fine print." }),
    seg(6, "side", "CTA", 1.5, { kind: "still", text: "BLACK FRIDAY DEAL — SHOP AT TCL.COM", fine: "*Fine print." }),
  ];
  const plan = planEdit(ad);
  const shot = (n: number) => plan.shots.filter((s) => s.frameNumber === n);

  it("shows each hook frame's own line for its own frame", () => {
    expect(plan.cards.filter((c) => c.role === "hook").map((c) => [c.text, c.startSec])).toEqual([
      ["BLACK FRIDAY", 0],
      ["FREE INSTALLATION INCLUDED*", 1],
      ["SURPRISE — TCL HOLIDAY FREE INSTALLATION INCLUDED*", 2],
    ]);
  });

  it("carries speed and zoom hits to the shots and never splits them", () => {
    expect(shot(2)).toHaveLength(1);
    expect(shot(2)[0].speed).toBe(4);
    expect(shot(4)).toHaveLength(1);
    expect(shot(4)[0].zoomHit).toEqual({ x: 0.5, y: 0.3 });
  });

  it("keeps two different end-card stills as two framings, with the fine print under both", () => {
    const cta = plan.shots.filter((s) => s.segment === "CTA");
    expect(cta.map((s) => s.url)).toEqual(["front", "side"]);
    const fine = plan.cards.find((c) => c.role === "fine")!;
    expect(fine).toMatchObject({ text: "*Fine print.", endSec: plan.durationSec });
    expect(fine.startSec).toBeCloseTo(cta[0].startSec, 2);
  });
});

describe("CTA button", () => {
  it("bounces in for the last second, even when the offer line is itself a CTA", () => {
    const p = planEdit(ad);
    expect(p.ctaButton).toEqual({ text: "Shop now", startSec: 19 });
  });
});
