import { describe, expect, it, vi } from "vitest";
import nxt from "./__fixtures__/nxt-brief.json";
import { campaignCopyPrompts, normalizeOverrides, normalizePlatform, offerLine, offerFacts, planCampaign, saleEvent, scaffoldPlatformPlan, summarizePlan, writeCampaignScripts } from "./campaign-planner";
import type { PlatformPlan } from "./campaign-plan.types";
import { PLATFORM_PROFILES } from "./platforms.data";
import { finalizeBrief } from "./product-brief";
import { creativeBlock, planBlock } from "./prompt-blocks";
import type { CampaignGoal, PlatformId } from "./types";

const brief = finalizeBrief(nxt, "tablet_laptop");
const BF = "2026-11-27T12:00:00Z";
const promo = { pct: 20, price: 279.99, comparePrice: 349.97, code: "NXT20" };

function checkTiming(plan: PlatformPlan) {
  for (const s of plan.scripts) {
    const beats = s.beats;
    expect(beats[0].t0).toBe(0);
    expect(beats[0].purpose).toBe("hook");
    for (let i = 1; i < beats.length; i++) expect(beats[i].t0).toBeCloseTo(beats[i - 1].t1, 6);
    for (const b of beats) expect(b.t1).toBeGreaterThan(b.t0);
    const sum = beats.reduce((a, b) => a + (b.t1 - b.t0), 0);
    expect(sum).toBeCloseTo(plan.durationSec, 6);
    const last = beats[beats.length - 1];
    expect(last.purpose).toBe("cta");
    expect(last.t0).toBeCloseTo(plan.durationSec - 1, 6);
    expect(last.t1).toBe(plan.durationSec);
  }
}

describe("scaffoldPlatformPlan", () => {
  it("TikTok Black Friday promo: timed beat map, sale pitch in the first 3 s, CTA in the last 1 s", () => {
    const plan = scaffoldPlatformPlan(brief, "tiktok", "promo", promo, BF);
    expect(plan.durationSec).toBe(21);
    expect(plan.aspect).toBe("9:16");
    checkTiming(plan);
    const pitch = plan.beats.find((b) => b.purpose === "pitch")!;
    expect(pitch.t0).toBeLessThan(3);
    expect(pitch.t1).toBeLessThanOrEqual(3);
    expect(pitch.onScreenText).toBe("20% OFF THIS BLACK FRIDAY");
    expect(plan.hookVariants.every((h) => h.durationSec <= 1.5)).toBe(true);
    // Hook question + pitch = "Want a New Year gift? 20% OFF this Black Friday".
    expect(plan.hookVariants.some((h) => /WANT A NEW YEAR GIFT\?/.test(h.openingText))).toBe(true);
    const cta = plan.beats[plan.beats.length - 1];
    expect(cta.visual).toMatch(/logo \+ bouncing/);
    expect(plan.beats.some((b) => b.purpose === "offer")).toBe(true);
    expect(plan.beats.some((b) => b.purpose === "objection")).toBe(true);
    const order = plan.beats.map((b) => b.purpose);
    expect(order.indexOf("objection")).toBeGreaterThan(order.lastIndexOf("proof"));
    expect(order.indexOf("offer")).toBeGreaterThan(order.indexOf("objection"));
  });

  it("3 hook variants from 3 different families, one script each with a shared body", () => {
    const plan = scaffoldPlatformPlan(brief, "instagram_reels", "cold", undefined, "2026-03-10T00:00:00Z");
    expect(plan.hookVariants).toHaveLength(3);
    const fams = plan.hookVariants.map((h) => (h.family === "demo" ? "native" : h.family));
    expect(new Set(fams).size).toBe(3);
    expect(new Set(plan.hookVariants.map((h) => h.hookId)).size).toBe(3);
    expect(plan.scripts.map((s) => s.hookId)).toEqual(plan.hookVariants.map((h) => h.hookId));
    for (const s of plan.scripts) expect(s.beats.slice(1)).toEqual(plan.beats);
    expect(plan.beats.some((b) => b.purpose === "pitch")).toBe(false);
    checkTiming(plan);
  });

  it("proof beats use the brief's proof shots; product on screen at least twice; every zoom lands on the product", () => {
    const plan = scaffoldPlatformPlan(brief, "youtube_shorts", "cold", undefined, "2026-03-10T00:00:00Z");
    const proofs = plan.beats.filter((b) => b.purpose === "proof");
    expect(proofs.length).toBeGreaterThanOrEqual(2);
    for (const b of proofs) {
      const sp = brief.sellingPoints.find((p) => p.id === b.sellingPointId)!;
      expect(b.visual).toContain(sp.proofVisual.shot.replace(/[.!?…\s]+$/, "").slice(0, 30));
    }
    expect(proofs.map((b) => b.sellingPointId)).toEqual(brief.sellingPoints.slice(0, proofs.length).map((p) => p.id));
    const withProduct = plan.beats.filter((b) => b.visual.includes("NXTPAPER 14"));
    expect(withProduct.length).toBeGreaterThanOrEqual(2);
    for (const b of plan.beats.filter((x) => /zoom/i.test(x.visual))) expect(b.visual).toMatch(/Zoom-in lands on the NXTPAPER 14/);
  });

  it("fits every platform and goal: times sum to the platform length, CTA last 1 s, promo pitch inside 3 s", () => {
    const goals: CampaignGoal[] = ["promo", "cold", "awareness", "retarget"];
    for (const p of PLATFORM_PROFILES)
      for (const goal of goals) {
        const plan = scaffoldPlatformPlan(brief, p.id as PlatformId, goal, promo, BF);
        expect(plan.durationSec).toBeGreaterThanOrEqual(Math.max(5, p.durationSec.range[0]));
        expect(plan.durationSec).toBeLessThanOrEqual(p.durationSec.max);
        checkTiming(plan);
        for (const v of plan.hookVariants) expect(v.durationSec).toBeLessThanOrEqual(p.hookSec);
        if (goal === "promo") expect(plan.beats.find((b) => b.purpose === "pitch")!.t1).toBeLessThanOrEqual(3);
        expect(plan.beats.filter((b) => b.visual.includes("NXTPAPER 14")).length).toBeGreaterThanOrEqual(2);
      }
  });

  it("honours a requested length (clamped to the platform range)", () => {
    expect(scaffoldPlatformPlan(brief, "tiktok", "cold", undefined, BF, { durationSec: 30 }).durationSec).toBe(30);
    expect(scaffoldPlatformPlan(brief, "youtube_bumper_6s", "cold", undefined, BF, { durationSec: 30 }).durationSec).toBe(6);
    checkTiming(scaffoldPlatformPlan(brief, "tiktok", "promo", promo, BF, { durationSec: 34 }));
  });

  it("fills the end card from the promo facts", () => {
    const plan = scaffoldPlatformPlan(brief, "meta_feed", "promo", { code: "NXT20", pct: 20 }, "2026-03-10T00:00:00Z");
    const cards = [plan.endCard, ...plan.endCardAlternates];
    const coupon = cards.find((c) => c.id === "E03");
    expect(coupon?.data).toMatchObject({ code: "NXT20", pct: 20 });
    expect(cards.every((c) => !/[{}]/.test(c.button))).toBe(true);
  });

  it("strict vs default: legal labels and blocked points only in strict mode", () => {
    const b = finalizeBrief({ ...nxt, sellingPoints: nxt.sellingPoints.map((p, i) => (i === 0 ? { ...p, compliance: { ...p.compliance, riskLevel: "blocked" } } : p)) }, "tablet_laptop");
    const blockedId = nxt.sellingPoints[0].id;
    const open = scaffoldPlatformPlan(b, "tiktok", "cold", undefined, "2026-03-10T00:00:00Z");
    const strict = scaffoldPlatformPlan(b, "tiktok", "cold", undefined, "2026-03-10T00:00:00Z", { strictCompliance: true });
    expect(open.beats.some((x) => x.sellingPointId === blockedId)).toBe(true);
    expect(strict.beats.some((x) => x.sellingPointId === blockedId)).toBe(false);
    expect((open.notes ?? []).join(" ")).not.toMatch(/label/);
    expect((strict.notes ?? []).join(" ")).toMatch(/label: AI-generated/);
  });
});

describe("Studio overrides", () => {
  const date = "2026-03-10T00:00:00Z";

  it("pinned hooks lead the auto picks (≤ 3, unknown ids ignored); a chosen end card replaces the pick, which moves to the alternates", () => {
    const auto = scaffoldPlatformPlan(brief, "tiktok", "cold", undefined, date);
    const plan = scaffoldPlatformPlan(brief, "tiktok", "cold", undefined, date, { hookIds: ["H08", "h27", "H99"], endCardId: "E08" });
    expect(plan.hookVariants.map((h) => h.hookId).slice(0, 2)).toEqual(["H08", "H27"]);
    expect(plan.hookVariants).toHaveLength(3);
    expect(plan.hookVariants[2].hookId).toBe(auto.hookVariants.find((h) => !["H08", "H27"].includes(h.hookId))!.hookId);
    expect(plan.scripts.map((s) => s.hookId)).toEqual(plan.hookVariants.map((h) => h.hookId));
    expect(plan.endCard.id).toBe("E08");
    expect(plan.endCardAlternates[0].id).toBe(auto.endCard.id);
    expect(plan.endCardAlternates.map((e) => e.id)).not.toContain("E08");
    expect(plan.notes?.join(" ")).toMatch(/pinned by user: H08, H27[\s\S]*end card chosen by user: E08/);
    checkTiming(plan);
    const four = scaffoldPlatformPlan(brief, "tiktok", "cold", undefined, date, { hookIds: ["H01", "H02", "H03", "H04"] });
    expect(four.hookVariants.map((h) => h.hookId)).toEqual(["H01", "H02", "H03"]);
  });

  it("accepts the UI request shape and the flat shape, and planCampaign honours them per platform", async () => {
    expect(normalizeOverrides({ tiktok: { hookIds: ["H08"] }, pinterest: { endCardId: "E08" } })).toEqual({ tiktok: { hookIds: ["H08"] }, pinterest: { endCardId: "E08" } });
    expect(normalizeOverrides({ pinnedHooks: { instagram: ["H02"] }, endCards: { tiktok: "E12", meta_feed: "E99" } })).toEqual({ instagram_reels: { hookIds: ["H02"] }, tiktok: { endCardId: "E12" } });
    expect(normalizeOverrides(null)).toEqual({});
    const plan = await planCampaign({ brief, platforms: ["tiktok", "pinterest"], goal: "cold", runDate: date, overrides: { tiktok: { hookIds: ["H08"] }, pinterest: { endCardId: "E08" } }, llm: async () => ({}) });
    expect(plan.platforms[0].hookVariants[0].hookId).toBe("H08");
    expect(plan.platforms[1].endCard.id).toBe("E08");
  });
});

describe("offer helpers", () => {
  it("names the sale event and writes the pitch line", () => {
    expect(saleEvent(BF)).toBe("Black Friday");
    expect(saleEvent("2026-12-01")).toBe("Cyber Monday");
    expect(saleEvent("2026-03-10")).toBe("");
    expect(offerLine(offerFacts({ comparePrice: 400, price: 300 }, BF))).toBe("25% OFF THIS BLACK FRIDAY");
    expect(offerLine(offerFacts({ price: 300 }, "2026-03-10"))).toBe("ONLY $300 — LIMITED TIME");
    expect(normalizePlatform("instagram")).toBe("instagram_reels");
    expect(normalizePlatform("youtube_shorts")).toBe("youtube_shorts");
  });
});

describe("writeCampaignScripts", () => {
  const scaffold = scaffoldPlatformPlan(brief, "tiktok", "promo", promo, BF);

  it("one model call per platform; merges VO, text and hook openings without touching timings", async () => {
    const llm = vi.fn(async () => ({
      beats: [{ i: 0, vo: "New Year gift? Black Friday, twenty percent off.", onScreenText: "20% OFF NOW" }, { i: 1, vo: "Zero glare. Even at the window.", visual: "a sunlit cafe table, NXTPAPER 14 beside a glossy tablet" }, { i: 99, vo: "ignored" }, "junk"],
      hooks: [{ hookId: scaffold.hookVariants[0].hookId, openingText: "WANT A NEW YEAR GIFT?", openingVO: "Want a New Year gift?" }, { hookId: "H99", openingText: "nope" }],
    }));
    const res = await writeCampaignScripts(scaffold, brief, { goal: "promo", promo, runDate: BF, llm });
    expect(llm).toHaveBeenCalledTimes(1);
    expect(res.source).toBe("llm");
    expect(res.plan.copySource).toBe("llm");
    expect(res.plan.beats[0].onScreenText).toBe("20% OFF NOW");
    expect(res.plan.beats[1].vo).toBe("Zero glare. Even at the window.");
    expect(res.plan.beats[1].visual).toMatch(/sunlit cafe/);
    expect(res.plan.hookVariants[0].openingVO).toBe("Want a New Year gift?");
    expect(res.plan.beats.map((b) => [b.t0, b.t1, b.purpose])).toEqual(scaffold.beats.map((b) => [b.t0, b.t1, b.purpose]));
    expect(res.plan.scripts[0].beats[0].vo).toBe("Want a New Year gift?");
    checkTiming(res.plan);
  });

  it("rejects a rewritten visual that drops the product", async () => {
    const res = await writeCampaignScripts(scaffold, brief, { goal: "promo", promo, runDate: BF, llm: async () => ({ beats: [{ i: 1, visual: "an empty beach at dusk", vo: "ok" }] }) });
    expect(res.plan.beats[1].visual).toBe(scaffold.beats[1].visual);
  });

  it("falls back to the scaffold copy when the model fails or returns nothing", async () => {
    const boom = await writeCampaignScripts(scaffold, brief, { goal: "promo", promo, runDate: BF, llm: async () => { throw new Error("429 rate limited"); } });
    expect(boom.source).toBe("fallback");
    expect(boom.plan.beats).toEqual(scaffold.beats);
    expect(boom.plan.scripts).toEqual(scaffold.scripts);
    expect(boom.plan.notes?.join(" ")).toMatch(/copy pass failed \(429 rate limited\)/);
    const empty = await writeCampaignScripts(scaffold, brief, { goal: "promo", promo, runDate: BF, llm: async () => ({}) });
    expect(empty.source).toBe("fallback");
    checkTiming(empty.plan);
  });

  it("prompts sell hard by default and only add the legal layer in strict mode", () => {
    const open = campaignCopyPrompts(scaffold, brief, { goal: "promo", promo, runDate: BF });
    expect(open.system).toMatch(/Sell hard/);
    expect(open.system).toMatch(/Want a New Year gift\?/);
    expect(open.system).not.toMatch(/safe wording/);
    expect(open.system).toMatch(/json/i);
    const strict = campaignCopyPrompts(scaffold, brief, { goal: "promo", promo, runDate: BF, strictCompliance: true });
    expect(strict.system).toMatch(/safe wording/);
    expect(JSON.parse(open.user).beats).toHaveLength(scaffold.beats.length);
  });
});

describe("planCampaign", () => {
  it("plans every platform (deduped), one model call each, and summarises", async () => {
    const llm = vi.fn(async () => {
      throw new Error("offline");
    });
    const plan = await planCampaign({ brief, platforms: ["tiktok", "instagram", "instagram_reels", "meta_feed"], goal: "Black Friday sale", promo, runDate: BF, llm, now: new Date("2026-10-06T00:00:00Z") });
    expect(llm).toHaveBeenCalledTimes(3);
    expect(plan.platforms.map((p) => p.platform)).toEqual(["tiktok", "instagram_reels", "meta_feed"]);
    expect(plan.goal).toBe("promo");
    expect(plan.version).toBe(1);
    expect(plan.productTitle).toBe("TCL NXTPAPER 14");
    expect(plan.bigIdea).toBe(brief.bigIdea.proposition);
    expect(plan.notes).toHaveLength(3);
    expect(plan.promo).toEqual(promo);
    for (const p of plan.platforms) checkTiming(p);
    const s = summarizePlan(plan);
    expect(s.platforms[0].hooks).toHaveLength(3);
    expect(s.platforms[0].beats[s.platforms[0].beats.length - 1]).toMatch(/cta/);
  });
});

describe("plan → script writer", () => {
  const plan = scaffoldPlatformPlan(brief, "tiktok", "promo", promo, BF);

  it("planBlock carries the chosen hook variant and the timed beats, rescaled to the script length", () => {
    const b0 = planBlock(plan, 0, { brief });
    const b1 = planBlock(plan, 1, { brief });
    expect(b0).toContain(`HOOK (0–1.5 s) = ${plan.hookVariants[0].hookId}`);
    expect(b1).toContain(`= ${plan.hookVariants[1].hookId}`);
    expect(b0).toMatch(/PITCH: .*20% OFF THIS BLACK FRIDAY/);
    expect(b0).toContain(`selling point: "${brief.sellingPoints[0].claim.slice(0, 40)}`);
    const scaled = planBlock(plan, 0, { brief, targetSec: 30 });
    expect(scaled).toMatch(/30 s \(plan was 21 s; times rescaled\)/);
    expect(scaled).toMatch(/29–30 s CTA/);
    expect(planBlock(plan, 4, { brief })).toContain(`= ${plan.hookVariants[1].hookId}`);
  });

  it("creativeBlock swaps the hook/end-card choice for the plan when one is stored", () => {
    const { text, choice } = creativeBlock({ brief, plan, hookIndex: 2, goal: "promo", platform: "tiktok" });
    expect(choice).toBeNull();
    expect(text).toContain("CAMPAIGN PLAN — TikTok");
    expect(text).toContain(`= ${plan.hookVariants[2].hookId}`);
    expect(text).not.toContain("OPENING HOOKS");
    expect(text.length).toBeLessThan(9000);
  });
});

describe("fitSpoken", () => {
  it("never cuts a voiceover line mid-sentence or with an ellipsis", async () => {
    const { fitSpoken } = await import("./campaign-planner");
    expect(fitSpoken("Zero flicker. TÜV certified for low blue light. Your eyes won't fry after hours.", 9)).toBe("Zero flicker. TÜV certified for low blue light.");
    expect(fitSpoken("NXTPAPER 3.0 kills glare, so you can read in full sun like actual paper", 9)).toBe("NXTPAPER 3.0 kills glare.");
    expect(fitSpoken("Short line.", 9)).toBe("Short line.");
    expect(fitSpoken("one two three four five six seven eight nine ten eleven", 5)).toBe("one two three four five.");
  });
});

describe("planCampaign performance bias", () => {
  it("passes the bias through to creative selection and notes it", async () => {
    const date = "2026-03-10T12:00:00Z";
    const plain = await planCampaign({ brief, platforms: ["meta_feed"], goal: "cold", runDate: date, llm: async () => ({}) });
    const target = plain.platforms[0].hookVariants[2].hookId;
    const biased = await planCampaign({ brief, platforms: ["meta_feed"], goal: "cold", runDate: date, llm: async () => ({}), bias: { [target]: 3 } });
    expect(biased.platforms[0].hookVariants[0].hookId).toBe(target);
    expect(biased.notes.join(" ")).toMatch(new RegExp(`performance bias from real results: ${target} \\+3`));
    expect(plain.notes.join(" ")).not.toMatch(/performance bias/);
  });
});

describe("fitSpoken — no dangling function word on a hard cut", () => {
  it("drops a trailing 'your' / 'the' when the budget cuts mid-phrase", async () => {
    const { fitSpoken } = await import("./campaign-planner");
    expect(fitSpoken("Want a tablet that saves your eyes every single night", 6)).toBe("Want a tablet that saves.");
    expect(fitSpoken("Read the whole book in the sun", 5)).toBe("Read the whole book.");
  });
});
