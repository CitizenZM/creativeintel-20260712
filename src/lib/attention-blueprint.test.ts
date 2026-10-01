import { describe, expect, it } from "vitest";
import { attentionBlueprint, renderAttentionBlock, scoreScriptAttention, timingEvidence } from "./attention-blueprint";

describe("attentionBlueprint", () => {
  it("plans a 20 s ad: 2 s hook, payoff by 5 s, re-hooks ≤ 6 s apart, 4 s CTA", () => {
    const s = attentionBlueprint(20);
    expect(s[0]).toMatchObject({ key: "HOOK", startSec: 0, endSec: 2 });
    expect(s.find((x) => x.key === "PAYOFF")!.endSec).toBeLessThanOrEqual(5);
    expect(s[s.length - 1]).toMatchObject({ key: "CTA", startSec: 16, endSec: 20 });
    for (const x of s) expect(x.endSec - x.startSec).toBeLessThanOrEqual(6);
    for (let i = 1; i < s.length; i++) expect(s[i].startSec).toBe(s[i - 1].endSec);
  });
});

describe("timingEvidence", () => {
  it("measures hook length, beat length, CTA timing and top hook types", () => {
    const ev = timingEvidence([
      { hookType: "question", beats: [{ startSec: 0, endSec: 2, role: "hook" }, { startSec: 2, endSec: 6, role: "demo" }, { startSec: 6, endSec: 8, role: "cta" }] },
      { hookType: "question", beats: [{ startSec: 0, endSec: 1, role: "hook" }, { startSec: 1, endSec: 9, role: "proof" }, { startSec: 9, endSec: 10, role: "cta" }] },
      { hookType: "stat", beats: [] },
    ]);
    expect(ev).toMatchObject({ ads: 3, medianHookSec: 1.5, topHookTypes: [{ type: "question", count: 2 }, { type: "stat", count: 1 }] });
    expect(ev.medianCtaShare).toBeCloseTo(0.83, 1);
    expect(renderAttentionBlock(20, ev)).toMatch(/TOP 3 COMPETITOR ADS: hook resolves at ~1.5s/);
  });
});

describe("scoreScriptAttention", () => {
  const good = {
    totalDurationSec: 20,
    brandName: "TCL",
    hook: { text: "Is your TV too dark for a sunny room?", durationSec: 2 },
    body: [
      { startSec: 2, endSec: 7, voiceover: "TCL QM7L hits 3,000 nits — bright enough for daylight.", proof: "3,000 nits side-by-side" },
      { startSec: 7, endSec: 12, voiceover: "2,100 dimming zones keep blacks deep.", textOverlay: "2,100+ zones" },
      { startSec: 12, endSec: 16, voiceover: "Rated 4.7 stars by owners.", proof: "4.7★ reviews" },
    ],
    cta: { text: "Shop the Seasonal Sale", durationSec: 4 },
  };
  it("scores a blueprint-shaped script at 100", () => {
    expect(scoreScriptAttention(good).score).toBe(100);
  });
  it("flags a 6 s hook, a 12 s beat and an 8 s CTA with fixes", () => {
    const bad = { ...good, hook: { ...good.hook, durationSec: 6 }, body: [{ startSec: 6, endSec: 18, voiceover: "It is a nice TV." }], cta: { text: "Learn more", durationSec: 8 } };
    const r = scoreScriptAttention(bad);
    expect(r.score).toBeLessThan(50);
    expect(r.checks.filter((c) => !c.pass).map((c) => c.key)).toEqual(expect.arrayContaining(["hook_len", "payoff", "rehook", "cta_len", "cta_verb"]));
  });
});
