import { describe, expect, it } from "vitest";
import { platformWeights, safeRect, scorePreflight } from "./score";
import type { PreflightMeasures, PreflightPlan } from "./types";

const good: PreflightMeasures = {
  durationSec: 18,
  width: 1080,
  height: 1920,
  firstFrame: { brightness: 0.45, contrast: 0.24, saturation: 0.38 },
  motion1s: 0.06,
  textOnsetSec: 0.1,
  cutsSec: [0.9, 1.8, 2.7, 3.6, 4.5, 5.4, 7, 9, 11, 13, 15],
  hasAudio: true,
  loudnessLufs: -14.2,
  truePeakDb: -1.6,
  leadingSilenceSec: 0,
  end: { motion: 0.01, edgeDensity: 0.12 },
};

const plan: PreflightPlan = {
  goal: "promo",
  texts: [
    { text: "BLACK FRIDAY — 40% OFF", startSec: 0, endSec: 1.5, role: "hook" },
    { text: "6,000 NITS", startSec: 4, endSec: 5.5, role: "claim" },
    { text: "SHOP NOW", startSec: 16, endSec: 18, role: "cta" },
  ],
  voiceover: [{ text: "Black Friday: the TV that hangs like art.", startSec: 0.2, endSec: 3 }],
  productShots: [
    { startSec: 0, endSec: 1 },
    { startSec: 4, endSec: 5.5 },
    { startSec: 15.5, endSec: 18 },
  ],
  ctaSec: 15.5,
  captionCoverage: 0.96,
  layers: [{ role: "hook", x: 140, y: 400, w: 800, h: 160, startSec: 0, endSec: 1.5 }],
  brandName: "TCL",
};

describe("safeRect", () => {
  it("scales the platform's safe zone to the canvas", () => {
    expect(safeRect("tiktok", { w: 1080, h: 1920 })).toEqual({ x: 64, y: 160, w: 1080 - 64 - 140, h: 1920 - 160 - 480 });
    expect(safeRect("tiktok", { w: 540, h: 960 })).toEqual({ x: 32, y: 80, w: 438, h: 640 });
  });
});

describe("platformWeights", () => {
  it("weights TikTok on the first second and YouTube on brand by 5 s", () => {
    const tt = platformWeights("tiktok");
    const yt = platformWeights("youtube_instream_skippable");
    expect(tt.motion_1s).toBeGreaterThan(yt.motion_1s);
    expect(tt.text_first_s).toBeGreaterThan(yt.text_first_s);
    expect(yt.brand_by_5s).toBeGreaterThan(tt.brand_by_5s);
  });
});

describe("scorePreflight", () => {
  it("scores a strong, planned TikTok promo as ready", () => {
    const r = scorePreflight(good, plan, { platform: "tiktok" });
    expect(r.score).toBeGreaterThanOrEqual(85);
    expect(r.verdict).toBe("ready");
    expect(r.checks.filter((c) => c.pass === false).map((c) => c.key)).toEqual([]);
    expect(r.sources).toContain("plan");
  });

  it("puts the costliest problems first, each with a concrete fix", () => {
    const bad = { ...good, firstFrame: { brightness: 0.06, contrast: 0.04, saturation: 0.05 }, leadingSilenceSec: 1.2, motion1s: 0.004 };
    const r = scorePreflight(bad, { ...plan, texts: plan.texts.slice(1) }, { platform: "tiktok" });
    expect(r.score).toBeLessThan(75);
    const failed = r.checks.filter((c) => c.pass === false).map((c) => c.key);
    expect(failed).toEqual(expect.arrayContaining(["first_frame_brightness", "silent_start", "motion_1s", "text_first_s", "sale_pitch_3s"]));
    expect(r.topFixes.length).toBeGreaterThanOrEqual(3);
    expect(r.topFixes[0]).toMatch(/\d/); // fixes carry numbers
    for (const c of r.checks.filter((x) => x.pass === false)) expect(c.fix).toBeTruthy();
  });

  it("charges weak opening motion more on TikTok than on YouTube, and a late brand more on YouTube", () => {
    const still = { ...good, motion1s: 0.003 };
    const lost = (p: Parameters<typeof scorePreflight>[2]["platform"], m: PreflightMeasures, pl: PreflightPlan) => scorePreflight(good, plan, { platform: p }).score - scorePreflight(m, pl, { platform: p }).score;
    expect(lost("tiktok", still, plan)).toBeGreaterThan(lost("youtube_instream_skippable", still, plan));
    const late = { ...plan, productShots: [{ startSec: 8, endSec: 10 }, { startSec: 15.5, endSec: 18 }], texts: plan.texts.map((t) => ({ ...t, text: t.text.replace("TCL", "") })) };
    expect(lost("youtube_instream_skippable", good, late)).toBeGreaterThan(lost("tiktok", good, late));
  });

  it("skips what it can't know instead of guessing", () => {
    const r = scorePreflight(good, null, { platform: "tiktok" });
    const byKey = Object.fromEntries(r.checks.map((c) => [c.key, c]));
    expect(byKey.product_frame1.score).toBeNull();
    expect(byKey.safe_zone.score).toBeNull();
    expect(byKey.sale_pitch_3s.score).toBeNull();
    expect(byKey.text_first_s.score).not.toBeNull(); // falls back to the edge heuristic
    expect(r.sources).toEqual(["heuristic"]);
  });

  it("flags readable layers outside the platform safe zone", () => {
    const r = scorePreflight(good, { ...plan, layers: [...plan.layers!, { role: "cta", x: 300, y: 1600, w: 480, h: 120, startSec: 16, endSec: 18 }] }, { platform: "tiktok" });
    const sz = r.checks.find((c) => c.key === "safe_zone")!;
    expect(sz.pass).toBe(false);
    expect(sz.fix).toMatch(/cta/);
  });

  it("checks the sale pitch only for promo goals and the end card in the last second", () => {
    const cold = scorePreflight(good, { ...plan, goal: "cold" }, { platform: "meta_feed" });
    expect(cold.checks.find((c) => c.key === "sale_pitch_3s")!.score).toBeNull();
    const noCta = scorePreflight({ ...good, end: { motion: 0.08, edgeDensity: 0.02 } }, { ...plan, ctaSec: null, texts: plan.texts.slice(0, 2) }, { platform: "meta_feed" });
    expect(noCta.checks.find((c) => c.key === "cta_end")!.pass).toBe(false);
  });

  it("judges duration and loudness against the platform", () => {
    const long = scorePreflight({ ...good, durationSec: 58, loudnessLufs: -24 }, plan, { platform: "tiktok" });
    expect(long.checks.find((c) => c.key === "duration")!.pass).toBe(false);
    expect(long.checks.find((c) => c.key === "loudness_lufs")!.fix).toMatch(/-14|−14/);
  });
});
