import { describe, expect, it, vi } from "vitest";
import nxt from "./__fixtures__/nxt-brief.json";
import teardown from "./__fixtures__/teardown-glare-ugc.json";
import structure from "./__fixtures__/structure-wait-for-it.json";
import { finalizeBrief } from "./product-brief";
import {
  classifyHook,
  classifyHookRules,
  cloneAd,
  cloneLabel,
  mapEndCard,
  mergeClonedPlan,
  normalizeReference,
  referenceFromStructure,
  referenceFromTeardown,
  scaffoldClone,
  shotGrammar,
} from "./ad-cloner";
import type { CampaignPlan } from "./campaign-plan.types";

const brief = finalizeBrief(nxt, "tablet_laptop");
const RUN = "2026-10-06T12:00:00Z";
const promo = { pct: 20, price: 279.99, comparePrice: 349.97, code: "NXT20" };
const failLlm = vi.fn(async () => {
  throw new Error("offline");
});

describe("normalizeReference", () => {
  it("reads a stored teardown record (contentAsset, competitor) into a contiguous beat timeline", () => {
    const ref = referenceFromTeardown(teardown);
    expect(ref.id).toBe("td_glare_01");
    expect(ref.owner).toBe("LumioTab");
    expect(ref.platform).toBe("tiktok");
    expect(ref.durationSec).toBe(15);
    expect(ref.beats.map((b) => [b.startSec, b.endSec])).toEqual([[0, 1.5], [1.5, 4], [4, 7.5], [7.5, 10], [10, 12.5], [12.5, 15]]);
    expect(ref.beats[0].vo).toMatch(/POV/);
  });

  it("repairs gaps, overlaps (cut at the next start) and unsorted beats from raw JSON, and rejects a timeline-less reference", () => {
    const ref = normalizeReference({
      hookText: "x",
      beats: [
        { startSec: 4, endSec: 9, role: "cta" },
        { startSec: 0.4, endSec: 2, role: "hook" },
        { startSec: 1.8, endSec: 4.2, role: "demo" },
      ],
    });
    expect(ref.beats.map((b) => [b.startSec, b.endSec])).toEqual([[0, 1.8], [1.8, 4], [4, 9]]);
    expect(ref.durationSec).toBe(9);
    expect(() => normalizeReference({ beats: [{ startSec: 0, endSec: 3 }] })).toThrow(/beat timeline/);
  });

  it("reads a saved structure (no VO) too", () => {
    const ref = referenceFromStructure(structure);
    expect(ref.label).toBe("Glowly — Glowly night reader — wait for it");
    expect(ref.beats).toHaveLength(5);
    expect(ref.durationSec).toBe(20);
  });
});

describe("shotGrammar", () => {
  it("names the shot from the reference's visual description", () => {
    expect(shotGrammar("Split screen under a ring light: glossy left, matte right")).toBe("split_screen");
    expect(shotGrammar("Macro extreme close-up of text on the matte screen")).toBe("macro");
    expect(shotGrammar("Creator selfie on a sunny balcony")).toBe("talking_head");
    expect(shotGrammar("Time-lapse of a whole night of reading")).toBe("time_lapse");
    expect(shotGrammar("Hands-only demo: thumb taps the reader awake")).toBe("hands_demo");
    expect(shotGrammar("End card: packshot with a coupon")).toBe("end_card");
    expect(shotGrammar("something else entirely")).toBe("product_shot");
    expect(shotGrammar("anything", "pov_use")).toBe("pov_use");
  });
});

describe("classifyHook", () => {
  it("maps a POV opener to H08 by rules", () => {
    const r = classifyHookRules(referenceFromTeardown(teardown));
    expect(r.hookId).toBe("H08");
    expect(r.score).toBeGreaterThanOrEqual(3);
    expect(r.features.join(" ")).toMatch(/pov/i);
  });

  it("maps clear features: unboxing, deal slam, comparison, search bar, question", () => {
    const base = { beats: [{ startSec: 0, endSec: 2, role: "hook" }, { startSec: 2, endSec: 6, role: "cta" }] };
    const id = (o: Record<string, unknown>) => classifyHookRules(normalizeReference({ ...base, ...o })).hookId;
    expect(id({ hookType: "demo_first", hookVisual: "Hands open the box and lift the lid" })).toBe("H05");
    expect(id({ hookType: "offer_first", hookText: "40% OFF today only" })).toBe("H16");
    expect(id({ hookType: "before_after", hookVisual: "Split screen: ours vs the generic one, same test" })).toBe("H29");
    expect(id({ hookType: "trend_native", hookVisual: "A search bar types 'best tablet for reading'" })).toBe("H25");
    expect(id({ hookType: "question", hookText: "Is your tablet hurting your eyes?" })).toBe("H14");
  });

  it("falls back to the LLM when the rules are unsure, and to the hook-type map when the LLM fails", async () => {
    const ref = referenceFromStructure(structure);
    expect(classifyHookRules(ref).score).toBeLessThan(3);
    const llm = vi.fn(async () => ({ hookId: "H03", why: "glow reveal" }));
    const viaLlm = await classifyHook(ref, { llm });
    expect(llm).toHaveBeenCalledTimes(1);
    expect(viaLlm).toMatchObject({ hookId: "H03", method: "llm" });
    const bad = await classifyHook(ref, { llm: vi.fn(async () => ({ hookId: "H99" })) });
    expect(bad).toMatchObject({ hookId: "H02", method: "fallback" });
    const down = await classifyHook(ref, { llm: failLlm });
    expect(down).toMatchObject({ hookId: "H02", method: "fallback" });
  });

  it("does not call the LLM when the rules are sure", async () => {
    const llm = vi.fn();
    const r = await classifyHook(referenceFromTeardown(teardown), { llm });
    expect(r.method).toBe("rules");
    expect(llm).not.toHaveBeenCalled();
  });
});

describe("mapEndCard", () => {
  it("maps the reference close to E01–E12, then checks our facts", () => {
    const ref = referenceFromTeardown(teardown);
    expect(mapEndCard(ref, { promo, goal: "promo", runDate: RUN })).toMatchObject({ id: "E03", matched: "E03" });
    // No code of ours: a coupon close can't render — the % badge carries the same offer.
    const noCode = mapEndCard(ref, { promo: { pct: 20 }, goal: "promo", runDate: RUN });
    expect(noCode.matched).toBe("E03");
    expect(noCode.id).toBe("E02");
    expect(noCode.note).toMatch(/E03/);
    // No offer at all → the brand close.
    expect(mapEndCard(ref, { goal: "cold", runDate: RUN }).id).toBe("E01");
    expect(mapEndCard(referenceFromStructure(structure), { goal: "awareness", runDate: RUN }).id).toBe("E01");
    const tap = normalizeReference({ ctaText: "Tap Shop Now below", beats: [{ startSec: 0, endSec: 2, role: "hook" }, { startSec: 2, endSec: 5, role: "cta" }] });
    expect(mapEndCard(tap, { goal: "cold", runDate: RUN }).id).toBe("E09");
  });
});

describe("scaffoldClone", () => {
  it("keeps the reference's beat timings and shot grammar, remaps every beat to our selling points", () => {
    const ref = referenceFromTeardown(teardown);
    const plan = scaffoldClone(ref, brief, { platform: "tiktok", goal: "promo", promo, runDate: RUN, hookId: "H08" });
    expect(plan.platform).toBe("tiktok");
    expect(plan.label).toBe(cloneLabel(ref));
    expect(plan.label).toMatch(/^Cloned from LumioTab/);
    expect(plan.durationSec).toBe(15);
    // Hook variants: the cloned hook leads, two alternates for A/B, all as long as the reference hook.
    expect(plan.hookVariants[0].hookId).toBe("H08");
    expect(plan.hookVariants).toHaveLength(3);
    expect(plan.hookVariants.every((h) => h.durationSec === 1.5)).toBe(true);
    expect(plan.hookVariants[0].openingText).toMatch(/^POV/);
    // Body beats = the reference's beats after the hook, same timings.
    expect(plan.beats.map((b) => [b.t0, b.t1])).toEqual([[1.5, 4], [4, 7.5], [7.5, 10], [10, 12.5], [12.5, 15]]);
    expect(plan.beats.map((b) => b.purpose)).toEqual(["objection", "proof", "proof", "proof", "cta"]);
    expect(plan.beats.map((b) => b.shotType)).toEqual(["close_up", "split_screen", "macro", "hands_demo", "end_card"]);
    // Proof shots come from our brief, matched on shot grammar: split screen ↔ sp-03, macro ↔ sp-02.
    const proofs = plan.beats.filter((b) => b.purpose === "proof");
    expect(proofs.map((b) => b.sellingPointId)).toEqual(["sp-03", "sp-02", "sp-01"]);
    // Our product, never theirs.
    expect(plan.beats.every((b) => !/lumiotab/i.test(`${b.visual} ${b.vo} ${b.onScreenText}`))).toBe(true);
    expect(plan.beats.filter((b) => b.purpose !== "cta").every((b) => b.visual.includes("NXTPAPER 14"))).toBe(true);
    // End card: the reference's coupon close, filled with our code.
    expect(plan.endCard.id).toBe("E03");
    expect(plan.endCard.button).toMatch(/NXT20/);
    // Scripts: one per hook variant, contiguous, ending on the CTA.
    expect(plan.scripts).toHaveLength(3);
    for (const s of plan.scripts) {
      expect(s.beats[0]).toMatchObject({ t0: 0, t1: 1.5, purpose: "hook" });
      for (let i = 1; i < s.beats.length; i++) expect(s.beats[i].t0).toBeCloseTo(s.beats[i - 1].t1, 6);
      expect(s.beats[s.beats.length - 1]).toMatchObject({ purpose: "cta", t1: 15 });
    }
    expect(plan.copySource).toBe("scaffold");
  });

  it("is deterministic", () => {
    const ref = referenceFromTeardown(teardown);
    const a = scaffoldClone(ref, brief, { platform: "tiktok", goal: "promo", promo, runDate: RUN, hookId: "H08" });
    const b = scaffoldClone(ref, brief, { platform: "tiktok", goal: "promo", promo, runDate: RUN, hookId: "H08" });
    expect(a).toEqual(b);
  });

  it("splits a final CTA second off when the reference has no CTA beat, and scales a too-long reference", () => {
    const ref = normalizeReference({ title: "Long", beats: [{ startSec: 0, endSec: 3, role: "hook" }, { startSec: 3, endSec: 9, role: "demo" }, { startSec: 9, endSec: 12, role: "proof" }] });
    const plan = scaffoldClone(ref, brief, { platform: "youtube_bumper_6s", goal: "cold", runDate: RUN, hookId: "H04" });
    expect(plan.durationSec).toBe(6);
    const s = plan.scripts[0].beats;
    expect(s[0]).toMatchObject({ t0: 0, t1: 1.5 });
    expect(s[s.length - 1]).toMatchObject({ purpose: "cta", t0: 5, t1: 6 });
    expect(plan.notes!.join(" ")).toMatch(/scaled/);
    expect(plan.notes!.join(" ")).toMatch(/CTA/);
  });
});

describe("cloneAd", () => {
  it("one LLM rewrite pass for VO + on-screen text, timings untouched", async () => {
    const llm = vi.fn(async ({ user }: { system: string; user: string }) => {
      const u = JSON.parse(user);
      expect(u.reference.beats.length).toBe(6);
      return { beats: u.beats.map((b: { i: number }) => ({ i: b.i, vo: `Line ${b.i} for NXTPAPER 14.`, onScreenText: `TEXT ${b.i}` })), hooks: [{ hookId: "H08", openingText: "POV: sun-proof reading", openingVO: "POV: reading in full sun." }] };
    });
    const res = await cloneAd({ reference: teardown, brief, promo, runDate: RUN, llm });
    expect(llm).toHaveBeenCalledTimes(1); // hook was sure by rules → only the copy call
    expect(res.hook).toMatchObject({ hookId: "H08", method: "rules" });
    expect(res.plan.copySource).toBe("llm");
    expect(res.plan.beats[0].vo).toBe("Line 0 for NXTPAPER 14.");
    expect(res.plan.hookVariants[0].openingText).toBe("POV: sun-proof reading");
    expect(res.plan.beats.map((b) => [b.t0, b.t1])).toEqual([[1.5, 4], [4, 7.5], [7.5, 10], [10, 12.5], [12.5, 15]]);
    expect(res.goal).toBe("promo");
  });

  it("keeps the scaffold copy when the model fails", async () => {
    const res = await cloneAd({ reference: structure, brief, platform: "instagram_reels", runDate: RUN, llm: failLlm });
    expect(res.hook.method).toBe("fallback");
    expect(res.plan.copySource).toBe("scaffold");
    expect(res.plan.notes!.join(" ")).toMatch(/copy pass failed/);
    expect(res.plan.durationSec).toBe(20);
    expect(res.plan.beats.map((b) => b.shotType)).toEqual(["hands_demo", "time_lapse", "lifestyle", "end_card"]);
    expect(res.endCard.id).toBe("E01");
    expect(res.goal).toBe("awareness");
  });
});

describe("mergeClonedPlan", () => {
  it("adds the clone first, replaces an earlier clone of the same reference, keeps the rest", async () => {
    const { plan: clone } = await cloneAd({ reference: teardown, brief, promo, runDate: RUN, llm: failLlm });
    const existing: CampaignPlan = {
      version: 1,
      createdAt: "2026-10-01T00:00:00Z",
      productTitle: "TCL NXTPAPER 14",
      goal: "promo",
      bigIdea: "x",
      keywords: [],
      notes: [],
      platforms: [{ ...clone, label: "TikTok", hookVariants: [] }, { ...clone, label: cloneLabel(referenceFromTeardown(teardown)), durationSec: 99 }],
    };
    const merged = mergeClonedPlan(existing, clone, { brief, goal: "promo", now: new Date(RUN) });
    expect(merged.platforms).toHaveLength(2);
    expect(merged.platforms[0]).toBe(clone);
    expect(merged.platforms[1].label).toBe("TikTok");
    const fresh = mergeClonedPlan(null, clone, { brief, goal: "promo", now: new Date(RUN), promo });
    expect(fresh).toMatchObject({ version: 1, productTitle: "TCL NXTPAPER 14", goal: "promo", promo });
    expect(fresh.platforms).toEqual([clone]);
    expect(fresh.notes.join(" ")).toMatch(/Cloned from/);
  });
});
