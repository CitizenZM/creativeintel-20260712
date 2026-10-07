import { describe, expect, it, vi } from "vitest";
import nxt from "./__fixtures__/nxt-brief.json";
import type { CampaignPlan, PlatformPlan } from "./campaign-plan.types";
import { planCampaign } from "./campaign-planner";
import {
  applyOps,
  creativeAgentPrompts,
  HISTORY_LIMIT,
  popHistory,
  pushHistory,
  retimeBeats,
  runCreativeAgent,
  validateOp,
  type AgentContext,
  type StoryboardFrameLike,
} from "./creative-agent";
import { finalizeBrief } from "./product-brief";

const brief = finalizeBrief(nxt, "tablet_laptop");
const BF = "2026-11-27T12:00:00Z";
const noCopy = async () => ({});

async function makePlan(opts: { promo?: boolean } = {}): Promise<CampaignPlan> {
  return planCampaign({
    brief,
    platforms: ["tiktok", "meta_feed"],
    goal: opts.promo === false ? "cold" : "promo",
    promo: opts.promo === false ? undefined : { pct: 20, price: 279.99, comparePrice: 349.97, code: "NXT20" },
    runDate: BF,
    llm: noCopy,
    now: new Date(BF),
  });
}

const ctxOf = async (extra: Partial<AgentContext> = {}): Promise<AgentContext> => ({ plan: await makePlan(), brief, ...extra });
const tiktok = (plan: CampaignPlan) => plan.platforms.find((p) => p.platform === "tiktok")!;

function checkTiming(p: PlatformPlan) {
  for (const s of p.scripts) {
    expect(s.beats[0].t0).toBe(0);
    for (let i = 1; i < s.beats.length; i++) expect(s.beats[i].t0).toBeCloseTo(s.beats[i - 1].t1, 6);
    for (const b of s.beats) expect(b.t1).toBeGreaterThan(b.t0);
    expect(s.beats.reduce((a, b) => a + (b.t1 - b.t0), 0)).toBeCloseTo(p.durationSec, 6);
    expect(s.beats[s.beats.length - 1].t1).toBe(p.durationSec);
  }
}

const frames = (): StoryboardFrameLike[] =>
  [0, 1, 2, 3].map((i) => ({
    frameNumber: i + 1,
    startSec: i * 2,
    endSec: i * 2 + 2,
    imagePrompt: `Shot ${i + 1} of the NXT tablet. Photorealistic.`,
    videoPrompt: "Slow push-in.",
    textOverlay: `T${i + 1}`,
    voiceover: `Line ${i + 1}.`,
    locked: { engine: "veo", refs: i === 1 ? "cast+product" : "product", ...(i === 1 ? { castLock: "a woman in her 30s" } : {}) },
  }));

describe("validateOp", () => {
  it("accepts ops that match the library and the plan", async () => {
    const ctx = await ctxOf();
    const t = tiktok(ctx.plan);
    for (const op of [
      { op: "swapHook", platform: "tiktok", hookId: "H05" },
      { op: "setEndCard", platform: "tiktok", endCardId: "E04", button: "Grab the deal" },
      { op: "editBeat", platform: "tiktok", scriptHookId: t.scripts[0].hookId, beatIndex: 1, changes: { vo: "Twenty percent off today." } },
      { op: "retime", platform: "tiktok", beatIndex: 2, t0: t.scripts[0].beats[2].t0, t1: t.scripts[0].beats[2].t1 },
      { op: "addPlatform", platform: "youtube_shorts" },
      { op: "setPromo", pct: 25, code: "NXT25", deadline: "2026-11-30" },
      { op: "regenerateCopy", platform: "meta_feed" },
      { op: "setCast", text: "a young dad, casual" },
      { op: "setSetting", text: "a bright Scandinavian living room" },
    ]) {
      const r = validateOp(op, ctx);
      expect(r, JSON.stringify(op)).toMatchObject({ ok: true });
    }
  });

  it("rejects ops outside the closed set or the library", async () => {
    const ctx = await ctxOf();
    const bad: [unknown, RegExp][] = [
      [{ op: "deleteEverything" }, /op/i],
      [{ op: "swapHook", platform: "tiktok", hookId: "H99" }, /H99/],
      [{ op: "swapHook", platform: "tiktok", hookId: "hook 5" }, /hook/i],
      [{ op: "setEndCard", platform: "tiktok", endCardId: "E13" }, /E13/],
      [{ op: "swapHook", platform: "pinterest", hookId: "H05" }, /not in the plan/],
      [{ op: "addPlatform", platform: "myspace" }, /Unknown platform/],
      [{ op: "addPlatform", platform: "tiktok" }, /already/],
      [{ op: "editBeat", platform: "tiktok", scriptHookId: "H01X", beatIndex: 0, changes: { vo: "x" } }, /script/],
      [{ op: "editBeat", platform: "tiktok", scriptHookId: "*", beatIndex: 99, changes: { vo: "x" } }, /beat/],
      [{ op: "editBeat", platform: "tiktok", scriptHookId: "*", beatIndex: 0, changes: {} }, /change/],
      [{ op: "editBeat", target: "storyboard", beatIndex: 0, changes: { vo: "x" } }, /storyboard/],
      [{ op: "setPromo" }, /promo/i],
      [{ op: "setPromo", pct: 150 }, /pct|100/i],
      [{ op: "setCast", text: "" }, /text/i],
    ];
    for (const [op, msg] of bad) {
      const r = validateOp(op, ctx);
      expect(r.ok, JSON.stringify(op)).toBe(false);
      if (!r.ok) expect(r.error).toMatch(msg);
    }
  });

  it("an end card needing promo facts is refused when the plan has none", async () => {
    const ctx: AgentContext = { plan: await makePlan({ promo: false }), brief };
    const r = validateOp({ op: "setEndCard", platform: "tiktok", endCardId: "E02" }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/%|pct/);
    expect(validateOp({ op: "setEndCard", platform: "tiktok", endCardId: "E01" }, ctx).ok).toBe(true);
  });
});

describe("retimeBeats", () => {
  const beats = [
    { t0: 0, t1: 2, purpose: "hook" as const, visual: "a" },
    { t0: 2, t1: 5, purpose: "proof" as const, visual: "b" },
    { t0: 5, t1: 9, purpose: "proof" as const, visual: "c" },
    { t0: 9, t1: 10, purpose: "cta" as const, visual: "d" },
  ];

  it("moves a beat and shifts both neighbours; beats stay contiguous and sum to the duration", () => {
    const out = retimeBeats(beats, 1, 1.5, 6, 10);
    expect(out.map((b) => [b.t0, b.t1])).toEqual([
      [0, 1.5],
      [1.5, 6],
      [6, 9],
      [9, 10],
    ]);
    expect(out.reduce((a, b) => a + b.t1 - b.t0, 0)).toBeCloseTo(10, 9);
    expect(beats[1].t0).toBe(2); // input untouched
  });

  it("refuses moves that break the invariants", () => {
    expect(() => retimeBeats(beats, 0, 0.5, 2, 10)).toThrow(/starts at 0/);
    expect(() => retimeBeats(beats, 3, 9, 9.5, 10)).toThrow(/ends at/);
    expect(() => retimeBeats(beats, 1, 0.2, 5, 10)).toThrow(/shorter/);
    expect(() => retimeBeats(beats, 1, 2, 8.8, 10)).toThrow(/shorter/);
    expect(() => retimeBeats(beats, 1, 4, 3, 10)).toThrow();
    expect(() => retimeBeats(beats, 7, 1, 2, 10)).toThrow(/beat/);
  });
});

describe("applyOps", () => {
  it("swapHook: an existing variant moves to the lead; a new hook replaces the lead and keeps the body", async () => {
    const ctx = await ctxOf();
    const t = tiktok(ctx.plan);
    const second = t.hookVariants[1].hookId;
    const moved = await applyOps(ctx, [{ op: "swapHook", platform: "tiktok", hookId: second }]);
    expect(tiktok(moved.plan).hookVariants[0].hookId).toBe(second);
    expect(tiktok(moved.plan).scripts[0].hookId).toBe(second);
    expect(tiktok(moved.plan).hookVariants).toHaveLength(t.hookVariants.length);

    const fresh = ["H05", "H12", "H22", "H31"].find((id) => !t.hookVariants.some((v) => v.hookId === id))!;
    const swapped = await applyOps(ctx, [{ op: "swapHook", platform: "tiktok", hookId: fresh }]);
    const p = tiktok(swapped.plan);
    expect(p.hookVariants[0].hookId).toBe(fresh);
    expect(p.hookVariants.map((v) => v.hookId)).not.toContain(t.hookVariants[0].hookId);
    expect(p.scripts[0].hookId).toBe(fresh);
    expect(p.scripts[0].beats[0].shotType).toBe(fresh);
    expect(p.scripts[0].beats.slice(1)).toEqual(t.scripts[0].beats.slice(1));
    checkTiming(p);
    expect(swapped.applied[0].summary).toMatch(new RegExp(fresh));
    // The other platform is untouched.
    expect(swapped.plan.platforms[1]).toEqual(ctx.plan.platforms[1]);
  });

  it("setEndCard: new card leads, the old one moves to the alternates, the CTA beat follows the button", async () => {
    const ctx = await ctxOf();
    const old = tiktok(ctx.plan).endCard;
    const next = old.id === "E03" ? "E04" : "E03";
    const r = await applyOps(ctx, [{ op: "setEndCard", platform: "tiktok", endCardId: next, button: "Claim coupon" }]);
    const p = tiktok(r.plan);
    expect(p.endCard.id).toBe(next);
    expect(p.endCard.button).toBe("Claim coupon");
    expect(p.endCardAlternates.map((e) => e.id)).toContain(old.id);
    expect(p.endCardAlternates.map((e) => e.id)).not.toContain(next);
    for (const s of p.scripts) {
      const cta = s.beats.find((b) => b.purpose === "cta")!;
      expect(cta.onScreenText).toBe("CLAIM COUPON");
      expect(cta.vo).toMatch(/Claim coupon/);
    }
    checkTiming(p);
  });

  it("editBeat: one script, every script (and the shared body), and the hook beat", async () => {
    const ctx = await ctxOf();
    const t = tiktok(ctx.plan);
    const [a, b] = t.scripts.map((s) => s.hookId);
    const one = await applyOps(ctx, [{ op: "editBeat", platform: "tiktok", scriptHookId: a, beatIndex: 2, changes: { vo: "It just works.", onScreenText: "JUST WORKS" } }]);
    const p1 = tiktok(one.plan);
    expect(p1.scripts[0].beats[2].vo).toBe("It just works.");
    expect(p1.scripts[0].beats[2].onScreenText).toBe("JUST WORKS");
    expect(p1.scripts[1].beats[2]).toEqual(t.scripts[1].beats[2]);
    expect(p1.scripts[0].beats[2].t0).toBe(t.scripts[0].beats[2].t0);

    const all = await applyOps(ctx, [{ op: "editBeat", platform: "tiktok", scriptHookId: "*", beatIndex: 2, changes: { visual: "Close-up of the NXT tablet screen" } }]);
    const p2 = tiktok(all.plan);
    expect(p2.scripts.every((s) => s.beats[2].visual === "Close-up of the NXT tablet screen")).toBe(true);
    expect(p2.beats[1].visual).toBe("Close-up of the NXT tablet screen");

    const hook = await applyOps(ctx, [{ op: "editBeat", platform: "tiktok", scriptHookId: b, beatIndex: 0, changes: { onScreenText: "WAIT FOR IT" } }]);
    const p3 = tiktok(hook.plan);
    expect(p3.scripts.find((s) => s.hookId === b)!.beats[0].onScreenText).toBe("WAIT FOR IT");
    expect(p3.hookVariants.find((v) => v.hookId === b)!.openingText).toBe("WAIT FOR IT");
  });

  it("retime: every script of the platform, the shared body and the hook length follow", async () => {
    const ctx = await ctxOf();
    const t = tiktok(ctx.plan);
    const beat = t.scripts[0].beats[2];
    const r = await applyOps(ctx, [{ op: "retime", platform: "tiktok", beatIndex: 2, t0: beat.t0 - 0.5, t1: beat.t1 + 0.5 }]);
    expect(r.rejected).toEqual([]);
    const p = tiktok(r.plan);
    checkTiming(p);
    for (const s of p.scripts) {
      expect(s.beats[2].t0).toBeCloseTo(beat.t0 - 0.5, 6);
      expect(s.beats[1].t1).toBeCloseTo(beat.t0 - 0.5, 6);
      expect(s.beats[3].t0).toBeCloseTo(beat.t1 + 0.5, 6);
    }
    expect(p.beats[1].t0).toBeCloseTo(beat.t0 - 0.5, 6);

    const hookEnd = t.scripts[0].beats[0].t1;
    const h = await applyOps(ctx, [{ op: "retime", platform: "tiktok", beatIndex: 0, t0: 0, t1: hookEnd + 0.5 }]);
    if (h.rejected.length === 0) {
      expect(tiktok(h.plan).hookVariants.every((v) => v.durationSec === hookEnd + 0.5)).toBe(true);
      checkTiming(tiktok(h.plan));
    }

    const bad = await applyOps(ctx, [{ op: "retime", platform: "tiktok", beatIndex: 2, t0: 0.1, t1: beat.t1 }]);
    expect(bad.applied).toEqual([]);
    expect(bad.rejected[0].error).toMatch(/shorter|starts/);
    expect(bad.plan).toEqual(ctx.plan);
  });

  it("addPlatform, setPromo, setCast, setSetting", async () => {
    const ctx = await ctxOf();
    const r = await applyOps(ctx, [
      { op: "addPlatform", platform: "youtube_shorts" },
      { op: "setPromo", pct: 30, code: "NXT30", deadline: "2026-11-30" },
      { op: "setCast", text: "a young dad, casual" },
      { op: "setSetting", text: "a bright living room" },
    ]);
    expect(r.rejected).toEqual([]);
    expect(r.plan.platforms.map((p) => p.platform)).toEqual(["tiktok", "meta_feed", "youtube_shorts"]);
    checkTiming(r.plan.platforms[2]);
    expect(r.plan.promo).toMatchObject({ pct: 30, code: "NXT30", deadline: "2026-11-30", price: 279.99 });
    for (const p of r.plan.platforms.slice(0, 2)) {
      if (p.endCard.data && "pct" in p.endCard.data) expect(p.endCard.data.pct).toBe(30);
      if (p.endCard.data && "code" in p.endCard.data) expect(p.endCard.data.code).toBe("NXT30");
    }
    expect(r.plan.cast).toBe("a young dad, casual");
    expect(r.plan.setting).toBe("a bright living room");
    expect(r.applied).toHaveLength(4);
  });

  it("regenerateCopy re-scaffolds the platform (same hooks, end card, duration) and runs the copy pass", async () => {
    const ctx = await ctxOf();
    const before = tiktok(ctx.plan);
    const rewrite = vi.fn(async (scaffold: PlatformPlan) => ({ ...scaffold, copySource: "llm" as const, beats: scaffold.beats.map((b) => ({ ...b, vo: `NEW ${b.vo ?? ""}` })) }));
    const r = await applyOps(ctx, [{ op: "regenerateCopy", platform: "tiktok" }], { rewrite });
    expect(rewrite).toHaveBeenCalledOnce();
    const scaffold = rewrite.mock.calls[0][0];
    expect(scaffold.hookVariants.map((h) => h.hookId)).toEqual(before.hookVariants.map((h) => h.hookId));
    expect(scaffold.endCard.id).toBe(before.endCard.id);
    expect(scaffold.durationSec).toBe(before.durationSec);
    const p = tiktok(r.plan);
    expect(p.copySource).toBe("llm");
    expect(p.scripts[0].beats[1].vo).toMatch(/^NEW/);
    checkTiming(p);
  });

  it("is deterministic: the same ops on the same plan give the same result", async () => {
    const ctx = await ctxOf();
    const ops = [
      { op: "swapHook", platform: "tiktok", hookId: "H22" },
      { op: "setEndCard", platform: "meta_feed", endCardId: "E01" },
      { op: "retime", platform: "meta_feed", beatIndex: 1, t0: tiktok(ctx.plan).scripts[0].beats[1].t0, t1: tiktok(ctx.plan).scripts[0].beats[1].t1 },
      { op: "setPromo", pct: 25 },
    ];
    const a = await applyOps(ctx, ops);
    const b = await applyOps(ctx, ops);
    expect(a).toEqual(b);
  });

  it("storyboard target: editBeat edits the frame's prompts / overlay / voiceover, not the plan", async () => {
    const ctx = await ctxOf({ frames: frames() });
    const r = await applyOps(ctx, [
      { op: "editBeat", target: "storyboard", beatIndex: 2, changes: { visual: "Extreme close-up of the NXT tablet screen", onScreenText: "4K", vo: "Look closer." } },
      { op: "setCast", text: "a man in his 40s, glasses" },
      { op: "setSetting", text: "a sunny kitchen" },
    ]);
    expect(r.rejected).toEqual([]);
    expect(r.frames![2]).toMatchObject({ textOverlay: "4K", voiceover: "Look closer." });
    expect(r.frames![2].imagePrompt).toBe("Extreme close-up of the NXT tablet screen Setting: a sunny kitchen.");
    expect(r.frames![1].locked).toMatchObject({ castLock: "a man in his 40s, glasses" });
    expect(r.frames!.every((f) => String(f.imagePrompt).includes("Setting: a sunny kitchen."))).toBe(true);
    expect(r.framesChanged).toBe(true);
    expect(r.changedFrames).toEqual([1, 2, 3, 4]);
    expect(r.plan.platforms).toEqual(ctx.plan.platforms);
    // Setting again replaces the clause instead of stacking it.
    const again = await applyOps({ ...ctx, frames: r.frames }, [{ op: "setSetting", text: "a garage" }]);
    expect(again.frames!.every((f) => (String(f.imagePrompt).match(/Setting:/g) ?? []).length === 1)).toBe(true);
  });
});

describe("runCreativeAgent (one mocked LLM call)", () => {
  it("applies valid ops, rejects invalid ones with reasons, and shows the model the library", async () => {
    const ctx = await ctxOf();
    const llm = vi.fn(async () => ({
      reply: "Swapped the TikTok hook and switched the end card.",
      ops: [
        { op: "swapHook", platform: "tiktok", hookId: "H22" },
        { op: "swapHook", platform: "tiktok", hookId: "H77" },
        { op: "setEndCard", platform: "meta_feed", endCardId: "E01", button: "Shop now" },
        { op: "makeItPop" },
        "garbage",
      ],
    }));
    const r = await runCreativeAgent(ctx, "Use a different hook on TikTok and a plain lockup on Meta", { llm });
    expect(llm).toHaveBeenCalledOnce();
    const prompt = (llm.mock.calls[0] as unknown as [{ system: string; user: string }])[0];
    expect(prompt.system).toMatch(/H35/);
    expect(prompt.system).toMatch(/E12/);
    expect(prompt.system).toMatch(/youtube_shorts/);
    expect(prompt.user).toMatch(/Use a different hook on TikTok/);
    expect(r.applied.map((a) => a.op.op)).toEqual(["swapHook", "setEndCard"]);
    expect(r.rejected).toHaveLength(3);
    expect(r.rejected[0].error).toMatch(/H77/);
    expect(r.planChanged).toBe(true);
    expect(r.reply).toMatch(/Swapped/);
    expect(tiktok(r.plan).hookVariants[0].hookId).toBe("H22");
  });

  it("a model failure changes nothing", async () => {
    const ctx = await ctxOf();
    const r = await runCreativeAgent(ctx, "anything", { llm: async () => { throw new Error("model down"); } });
    expect(r.error).toMatch(/model down/);
    expect(r.applied).toEqual([]);
    expect(r.planChanged).toBe(false);
    expect(r.plan).toEqual(ctx.plan);
  });

  it("the prompt lists the storyboard frames when one is targeted", async () => {
    const ctx = await ctxOf({ frames: frames() });
    const { user, system } = creativeAgentPrompts(ctx, "make frame 3 a close-up");
    expect(user).toMatch(/"frameNumber":3/);
    expect(system).toMatch(/storyboard/);
  });
});

describe("edit history (undo)", () => {
  it("keeps the newest HISTORY_LIMIT entries and pops the newest first", () => {
    let h: unknown = null;
    for (let i = 0; i < HISTORY_LIMIT + 3; i++) h = pushHistory(h, { at: `t${i}`, message: `m${i}`, summary: [] });
    expect((h as unknown[]).length).toBe(HISTORY_LIMIT);
    const top = popHistory(h)!;
    expect(top.entry.message).toBe(`m${HISTORY_LIMIT + 2}`);
    expect(top.rest).toHaveLength(HISTORY_LIMIT - 1);
    expect(popHistory([])).toBeNull();
    expect(popHistory("junk")).toBeNull();
  });
});
