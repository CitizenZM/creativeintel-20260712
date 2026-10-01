import { describe, expect, it } from "vitest";
import { cutdownFrames } from "./cutdown";
import type { AssembleFrame } from "../glm-assemble";

const f = (n: number, segment: string, voiceover: string, text?: string): AssembleFrame => ({ frameNumber: n, startSec: (n - 1) * 2, endSec: n * 2, segment, voiceover, text });

// 20 s: hook 2 s, body 7 frames in 4 VO beats, CTA 4 s
const ad = [
  f(1, "HOOK", "Too dark in daylight?"),
  f(2, "BODY", "Meet the TCL QM7L."),
  f(3, "BODY", "Meet the TCL QM7L."),
  f(4, "BODY", "It looks great in any room."),
  f(5, "BODY", "It looks great in any room."),
  f(6, "BODY", "3,000 nits beat the sun.", "3,000 nits"),
  f(7, "BODY", "Rated 4.7 stars."),
  f(8, "BODY", "Rated 4.7 stars."),
  f(9, "CTA", "Shop the sale."),
  f(10, "CTA", "Shop the sale."),
];

describe("cutdownFrames", () => {
  it("keeps hook, payoff and the proof beats; drops the vague beat; re-times end to end", () => {
    const cut = cutdownFrames(ad, 15);
    expect(cut.map((x) => x.frameNumber)).toEqual([1, 2, 3, 6, 9, 10]);
    expect(cut[cut.length - 1].endSec).toBe(12);
    for (let i = 1; i < cut.length; i++) expect(cut[i].startSec).toBe(cut[i - 1].endSec);
  });
  it("10 s keeps hook + payoff + CTA", () => {
    expect(cutdownFrames(ad, 10).map((x) => x.frameNumber)).toEqual([1, 2, 3, 9, 10]);
  });
  it("returns the ad untouched when it already fits", () => {
    expect(cutdownFrames(ad, 20)).toHaveLength(10);
  });
  it("trims an over-long hook and end card from older storyboards", () => {
    const old = [
      f(1, "HOOK", "a"), f(2, "HOOK", "a"), f(3, "HOOK", "a"),
      f(4, "BODY", "b 3,000 nits"), f(5, "BODY", "c"), f(6, "BODY", "d 4.7 stars"),
      f(7, "CTA", "e"), f(8, "CTA", "e"), f(9, "CTA", "e"), f(10, "CTA", "e"),
    ];
    const cut = cutdownFrames(old, 15);
    expect(cut.filter((x) => x.segment === "HOOK").map((x) => x.frameNumber)).toEqual([1, 2]);
    expect(cut.filter((x) => x.segment === "CTA").map((x) => x.frameNumber)).toEqual([9, 10]);
    expect(cut[cut.length - 1].endSec).toBeLessThanOrEqual(15);
  });
});
