import { describe, expect, it } from "vitest";
import type { PlatformPlan } from "./campaign-plan.types";
import { directPlanStoryboard, scaffoldLockedFrames } from "./plan-to-storyboard";

const plan = {
  platform: "tiktok",
  label: "TikTok",
  durationSec: 15,
  aspect: "9:16",
  audience: "",
  styleNotes: "",
  pacing: "",
  voice: "",
  captionStyle: "",
  musicMood: "holiday",
  hookVariants: [{ hookId: "H06", name: "Gift reveal", family: "reveal", durationSec: 2, openingVisual: "Hands tear red gift wrap to reveal the tablet", openingText: "Want a New Year gift?", openingVO: "Want a New Year gift?" }],
  endCard: { id: "E02", name: "Offer badge", button: "Claim Coupon", headline: "Black Friday", data: { pct: 20 } },
  endCardAlternates: [],
  beats: [],
  scripts: [
    {
      hookId: "H06",
      title: "Gift reveal",
      beats: [
        { t0: 0, t1: 2, purpose: "hook", visual: "Hands tear red gift wrap to reveal the tablet", onScreenText: "Want a New Year gift?", vo: "Want a New Year gift?" },
        { t0: 2, t1: 3, purpose: "pitch", visual: "The tablet held up to camera", onScreenText: "20% OFF Black Friday", vo: "Twenty percent off this Black Friday." },
        { t0: 3, t1: 7, purpose: "proof", sellingPointId: "sp1", visual: "Close-up of the matte screen in bright sunlight, no glare", vo: "A matte screen that reads like paper." },
        { t0: 7, t1: 10, purpose: "benefit", visual: "A mother sketches on the tablet with the stylus at the kitchen table", vo: "Draw, read, take notes." },
        { t0: 10, t1: 14, purpose: "offer", visual: "Product hero on an oak table with ribbon", onScreenText: "Ends Sunday" },
        { t0: 14, t1: 15, purpose: "cta", visual: "Logo and button", onScreenText: "Claim Coupon" },
      ],
    },
  ],
} as unknown as PlatformPlan;

describe("scaffoldLockedFrames", () => {
  const frames = scaffoldLockedFrames({ plan, productName: "NXTPAPER 14", cast: "a Latino mother in her 30s with shoulder-length dark hair, rust cardigan" });

  it("maps every beat to a timed locked frame covering the whole ad", () => {
    expect(frames.map((f) => [f.startSec, f.endSec])).toEqual([[0, 2], [2, 3], [3, 7], [7, 10], [10, 14], [14, 15]]);
    expect(frames.map((f) => f.segment)).toEqual(["HOOK", "HOOK", "BODY", "BODY", "BODY", "CTA"]);
    expect(frames.every((f, i) => f.frameNumber === i + 1)).toBe(true);
  });

  it("routes refs by subject: people + product → cast+product, product only → product", () => {
    expect(frames[0].locked.refs).toBe("cast+product"); // hands
    expect(frames[2].locked.refs).toBe("product");
    expect(frames[3].locked.refs).toBe("cast+product");
    expect(frames[0].locked.castLock).toContain("Latino mother");
    expect(frames.filter((f) => f.locked.castLock)).toHaveLength(1);
  });

  it("zooms land on the product, the CTA frame carries the end card and every clip is first+last anchored", () => {
    expect(frames[2].locked.zoomHit).toEqual({ x: 0.5, y: 0.5 });
    expect(frames[5].locked.endCard).toEqual({ id: "E02", data: { pct: 20, button: "Claim Coupon", headline: "Black Friday" } });
    expect(frames.every((f) => f.locked.anchorEnd === true && f.locked.engine === "veo")).toBe(true);
    expect(frames[1].textOverlay).toBe("20% OFF Black Friday");
    expect(frames[1].voiceover).toBe("Twenty percent off this Black Friday.");
  });

  it("gives each spoken beat a VO delivery style from its purpose, shifted for the platform (TikTok: more energy)", () => {
    expect(frames.map((f) => f.voiceStyle ?? null)).toEqual(["excited", "excited", "cheerful", "cheerful", null, null]);
    expect(frames.filter((f) => f.voiceover).every((f) => f.voiceEnergy === 1)).toBe(true);
    const yt = scaffoldLockedFrames({ plan: { ...plan, platform: "youtube_instream_skippable" } as PlatformPlan, productName: "NXTPAPER 14" });
    expect(yt[0]).toMatchObject({ voiceStyle: "cheerful", voiceEnergy: -1 });
    expect(yt[2].voiceStyle).toBe("friendly");
  });

  it("falls back to usable prompts without a model", () => {
    expect(frames[2].imagePrompt).toMatch(/matte screen/);
    expect(frames[2].imagePrompt).toMatch(/NXTPAPER 14 from image 1/);
    expect(frames[2].videoPrompt).toMatch(/push-in/i);
  });
});

describe("directPlanStoryboard", () => {
  it("applies the model's prompts per frame and keeps timing/locks", async () => {
    const out = await directPlanStoryboard(
      { plan, productName: "NXTPAPER 14" },
      { llm: async () => ({ frames: [{ i: 3, imagePrompt: "Macro of the matte tablet in noon sun", videoPrompt: "Slow push-in toward the screen.", endState: "Screen fills the frame" }] }) }
    );
    expect(out.source).toBe("llm");
    // the model's prompt is kept; the coverage check appends the product framing it was missing
    expect(out.frames[2].imagePrompt).toMatch(/^Macro of the matte tablet in noon sun\. The NXTPAPER 14 from image 1 is the main subject, centered/);
    expect(out.frames[2].locked.endState).toBe("Screen fills the frame");
    expect(out.frames[2].startSec).toBe(3);
  });

  it("keeps the scaffold when the model fails", async () => {
    const out = await directPlanStoryboard({ plan, productName: "NXTPAPER 14" }, { llm: async () => { throw new Error("down"); } });
    expect(out.source).toBe("fallback");
    expect(out.frames).toHaveLength(6);
  });
});

describe("cleanVisual / refs for live plan visuals", async () => {
  const { cleanVisual } = await import("./plan-to-storyboard");
  it("strips edit-time layers from keyframe visuals", () => {
    expect(cleanVisual(`End card E02: official NXTPAPER 14 packshot + "20% OFF" badge slam.`, "NXTPAPER 14")).not.toMatch(/badge|end card/i);
    expect(cleanVisual(`Macro: slide between screens. Overlay: 'Same resolution, zero grain' — crisp text.`, "X")).not.toMatch(/Overlay|Same resolution/);
    expect(cleanVisual("End card E02: badge slam.", "NXTPAPER 14")).toMatch(/Hero shot of the NXTPAPER 14/);
  });
  it("an offer beat that starts with 'End card' still carries the product ref", () => {
    const p = { ...plan, scripts: [{ ...plan.scripts[0], beats: [{ t0: 0, t1: 2, purpose: "offer", visual: "End card E02: packshot + badge" }] }] } as unknown as PlatformPlan;
    expect(scaffoldLockedFrames({ plan: p, productName: "NXTPAPER 14" })[0].locked.refs).toBe("product");
  });
});

describe("AI presenter (talking-head frames)", () => {
  const ugc = {
    ...plan,
    captionStyle: "native TikTok-style white bold with black stroke",
    audience: "busy moms 30-40",
    hookVariants: [{ hookId: "H17", name: "Creator Talking Head", family: "native", durationSec: 2, openingVisual: "Creator talks to camera", openingText: "", openingVO: "" }],
    scripts: [
      {
        hookId: "H17",
        title: "Creator talking head",
        beats: [
          { t0: 0, t1: 2, purpose: "hook", visual: "A mom talks straight to camera in her kitchen", vo: "Okay, I did not expect this." },
          { t0: 2, t1: 4, purpose: "proof", visual: "Close-up of the matte screen in bright sunlight", vo: "A matte screen that reads like paper." },
          { t0: 4, t1: 6, purpose: "benefit", visual: "POV: she holds the tablet up to the camera and taps through a recipe", vo: "Recipes, notes, homework." },
          { t0: 6, t1: 8, purpose: "offer", visual: "Selfie: she smiles holding the tablet", vo: "Twenty percent off this week, seriously, go grab one before it's gone." },
          { t0: 8, t1: 9, purpose: "cta", visual: "Logo and button", vo: "Link below." },
        ],
      },
    ],
  } as unknown as PlatformPlan;

  it("does nothing without presenter", () => {
    expect(scaffoldLockedFrames({ plan: ugc, productName: "NXTPAPER 14" }).some((f) => f.locked.talk)).toBe(false);
  });

  const frames = scaffoldLockedFrames({ plan: ugc, productName: "NXTPAPER 14", presenter: true, category: "electronics", cast: "a man in a suit" });

  it("turns native-hook beats and creator / POV / selfie beats into talk frames, never the CTA or a product close-up", () => {
    expect(frames.map((f) => !!f.locked.talk)).toEqual([true, false, true, true, false]);
    const talk = frames[0].locked.talk!;
    expect(talk.line).toBe("Okay, I did not expect this.");
    expect(frames[0].locked.engine).toBe("veo");
    expect(frames[0].locked.anchorEnd).toBe(false);
  });

  it("casts one presenter (default casting) as the CAST lock and uses them for every talk frame", () => {
    const ids = new Set(frames.filter((f) => f.locked.talk).map((f) => f.locked.talk!.persona));
    expect(ids.size).toBe(1);
    const cast = frames.find((f) => f.locked.castLock)!.locked.castLock!;
    expect(cast).toMatch(/white|Latina|Latino/);
    expect(cast).not.toMatch(/suit/);
    expect(frames.filter((f) => f.locked.castLock)).toHaveLength(1);
    expect(frames[0].locked.refs).toBe("cast");
    expect(frames[2].locked.refs).toBe("cast+product");
    expect(frames[2].locked.talk!.holdsProduct).toBe(true);
  });

  it("builds selfie keyframes and quoted-line Veo prompts, and sizes long lines (later frames shift)", () => {
    expect(frames[0].videoPrompt).toContain('"Okay, I did not expect this."');
    expect(frames[0].videoPrompt).toMatch(/lip-sync/i);
    expect(frames[0].imagePrompt).toMatch(/person from image 1/);
    expect(frames[3].endSec - frames[3].startSec).toBeGreaterThan(2); // the long offer line needs more than 2 s
    expect(frames[4].startSec).toBe(frames[3].endSec);
    expect(frames[4].endSec - frames[4].startSec).toBe(1);
  });

  it("picks a named persona and carries the native caption style from the platform", () => {
    const named = scaffoldLockedFrames({ plan: ugc, productName: "NXTPAPER 14", presenter: "meta-garage-dad" });
    expect(named.find((f) => f.locked.talk)!.locked.talk!.persona).toBe("meta-garage-dad");
    expect(named[0].locked.captionStyle).toBe("native");
    // TikTok's profile asks for native captions even when the plan leaves the field empty; Meta feed doesn't.
    expect(scaffoldLockedFrames({ plan, productName: "NXTPAPER 14" })[0].locked.captionStyle).toBe("native");
    expect(scaffoldLockedFrames({ plan: { ...plan, platform: "meta_feed" } as PlatformPlan, productName: "NXTPAPER 14" })[0].locked.captionStyle).toBeUndefined();
  });

  it("falls back to a talking hook when presenter is asked for but no beat is creator-style", () => {
    const f = scaffoldLockedFrames({ plan, productName: "NXTPAPER 14", presenter: true });
    expect(f[0].locked.talk?.line).toBe("Want a New Year gift?");
  });

  it("the director pass never rewrites a talk frame's prompts", async () => {
    const out = await directPlanStoryboard(
      { plan: ugc, productName: "NXTPAPER 14", presenter: true },
      { llm: async () => ({ frames: [1, 2].map((i) => ({ i, imagePrompt: `LLM ${i}`, videoPrompt: `LLM motion ${i}` })) }) }
    );
    expect(out.frames[0].imagePrompt).not.toBe("LLM 1");
    expect(out.frames[0].videoPrompt).toContain('"Okay, I did not expect this."');
    // the model's prompt is applied; the coverage check appends the product framing it lacked
    expect(out.frames[1].imagePrompt).toMatch(/^LLM 2\. The NXTPAPER 14 from image 1 is the main subject, centered/);
    expect(out.presenter).toBeTruthy();
  });
});

describe("comparison visuals → two generated shots (locked.compare)", async () => {
  const { detectComparison, productShortName } = await import("./plan-to-storyboard");
  const P = "NXTPAPER 14";
  const NOT_OURS = /split|side[- ]by[- ]side|\bvs\b|versus|collage|panel|before|ipad|apple|glossy|second tablet/i;

  it("split-screen 'X vs Y': ours is the product alone, the other side debranded", () => {
    const c = detectComparison("Split-screen under the same desk lamp: a glossy iPad with harsh glare vs the NXTPAPER 14 matte screen, no glare", P)!;
    expect(c).not.toBeNull();
    expect(c.labelOurs).toBe("NXTPAPER 14");
    expect(c.labelOther).toBe("Glossy tablet");
    expect(c.other).toMatch(/glossy tablet/i);
    expect(c.other.replace(/no split screen/i, "")).not.toMatch(/ipad|apple|NXTPAPER|split|no glare/i);
    expect(c.other).toMatch(/desk lamp/);
    expect(c.ours).toMatch(/NXTPAPER 14 from image 1/);
    expect(c.ours).toMatch(/matte screen/);
    expect(c.ours).toMatch(/single .*full frame|full frame.*single/i);
    expect(c.ours.replace(/no split screen, no second device, no panels/i, "")).not.toMatch(NOT_OURS);
  });

  it("'slide between a glossy iPad and the NXTPAPER' (the live K5 plan)", () => {
    const c = detectComparison("Hands slide between a glossy iPad and the NXTPAPER 14 on a sunlit desk", P)!;
    expect(c.labelOther).toBe("Glossy tablet");
    expect(c.ours).toMatch(/^Hands hold the NXTPAPER 14 from image 1/);
    expect(c.ours).toMatch(/sunlit desk/);
    expect(c.other).toMatch(/^Hands hold a glossy tablet/);
    expect(c.ours.replace(/no split screen, no second device, no panels/i, "")).not.toMatch(NOT_OURS);
  });

  it("flicker split-screen without 'vs' (the live K3 plan), side by side, before/after", () => {
    const k3 = detectComparison("Flicker test split-screen: a phone camera on a glossy tablet shows rolling bands; on the NXTPAPER 14 the camera shows none", P)!;
    expect(k3.labelOther).toBe("Glossy tablet");
    expect(k3.ours).toMatch(/NXTPAPER 14 from image 1/);
    expect(k3.ours).toMatch(/shows none/);
    expect(k3.ours.replace(/no split screen, no second device, no panels/i, "")).not.toMatch(/glossy|rolling bands|split/i);
    expect(k3.other).toMatch(/rolling bands/);

    const sbs = detectComparison("The NXTPAPER 14 side by side with a regular LCD tablet in noon sun", P)!;
    expect(sbs.labelOther).toBe("Regular LCD tablet");
    expect(sbs.ours).toMatch(/noon sun/);

    const ba = detectComparison("Before/after: tired eyes reading a backlit tablet at night, then relaxed reading on the NXTPAPER 14", P)!;
    expect(ba).not.toBeNull();
    expect(ba.other).not.toMatch(/NXTPAPER/);
    expect(ba.ours).toMatch(/relaxed reading/);
  });

  it("nothing detected for ordinary shots", () => {
    for (const v of [
      "Close-up of the matte screen in bright sunlight, no glare",
      "Macro: slide between screens",
      "A mother sketches on the tablet with the stylus at the kitchen table",
      "The tablet next to a coffee cup on an oak desk",
      "Hands tear red gift wrap to reveal the tablet",
    ])
      expect(detectComparison(v, P)).toBeNull();
  });

  it("short product names for the label", () => {
    expect(productShortName("NXTPAPER 14")).toBe("NXTPAPER 14");
    expect(productShortName("TCL NXTPAPER 14 tablet")).toBe("NXTPAPER 14");
    expect(productShortName("TCL QM8L 85-inch QD-Mini LED TV")).toBe("QM8L 85-inch");
  });

  const cmpPlan = {
    ...plan,
    scripts: [
      {
        ...plan.scripts[0],
        beats: [
          plan.scripts[0].beats[0],
          { t0: 2, t1: 5, purpose: "proof", visual: "Hands slide between a glossy iPad and the NXTPAPER 14 under a desk lamp", vo: "No glare." },
          plan.scripts[0].beats[2],
        ],
      },
    ],
  } as unknown as PlatformPlan;

  it("the scaffold maps a comparison beat to locked.compare with a single-subject keyframe", () => {
    const f = scaffoldLockedFrames({ plan: cmpPlan, productName: P });
    expect(f[1].locked.compare).toMatchObject({ labelOurs: "NXTPAPER 14", labelOther: "Glossy tablet", other: expect.stringMatching(/glossy tablet/i) });
    expect(f[1].imagePrompt).toMatch(/NXTPAPER 14 from image 1/);
    expect(f[1].imagePrompt!.replace(/no split screen, no second device, no panels/i, "")).not.toMatch(NOT_OURS);
    expect(f[0].locked.compare).toBeUndefined();
    expect(f[2].locked.compare).toBeUndefined();
  });

  it("the director is told never to ask for split screens, and a model prompt that does is replaced", async () => {
    let system = "";
    let user = "";
    const out = await directPlanStoryboard(
      { plan: cmpPlan, productName: P },
      {
        llm: async (a) => {
          system = a.system;
          user = a.user;
          return {
            frames: [
              { i: 1, imagePrompt: "Split screen collage of two gifts", videoPrompt: "Unwrap." },
              { i: 2, imagePrompt: "Hands slide from a glossy iPad to the NXTPAPER 14 from image 1", videoPrompt: "0–2s: the hand slides between the two tablets", endState: "Both tablets side by side" },
              { i: 3, imagePrompt: "Macro of the matte NXTPAPER 14 from image 1 in noon sun" },
            ],
          };
        },
      }
    );
    expect(system).toMatch(/never ask .*split[- ]screens?.*collages?.*two-panel/i);
    expect(user).toMatch(/COMPARE/);
    expect(out.frames[0].imagePrompt).not.toMatch(/split screen|collage/i);
    expect(out.frames[1].imagePrompt).not.toMatch(/ipad|glossy/i);
    expect(out.frames[1].videoPrompt).not.toMatch(/two tablets|between/i);
    expect(out.frames[1].locked.endState).toBeUndefined();
    expect(out.frames[2].imagePrompt).toMatch(/^Macro of the matte NXTPAPER 14 from image 1 in noon sun\. The NXTPAPER 14 from image 1 is the main subject, centered/);
  });
});

describe("product coverage + music bed on the storyboard", async () => {
  const { hasProductFraming } = await import("./product-coverage");

  it("the scaffold already meets the coverage rules (no issues) and names the bed on frame 1", async () => {
    const out = await directPlanStoryboard({ plan, productName: "NXTPAPER 14" }, { llm: async () => { throw new Error("down"); } });
    expect(out.coverage).toEqual([]);
    expect(out.frames[0].locked.musicMood).toBe("holiday");
    for (const f of out.frames.filter((x) => x.locked.refs === "product")) expect(hasProductFraming(f.imagePrompt ?? "")).toBe(true);
  });

  it("fixes a model prompt that loses the product: corner framing and a CTA that is not a hero", async () => {
    const out = await directPlanStoryboard(
      { plan, productName: "NXTPAPER 14" },
      { llm: async () => ({ frames: [
        { i: 3, imagePrompt: "The NXTPAPER 14 from image 1 rests in the lower corner of a sunny room" },
        { i: 6, imagePrompt: "A family waves goodbye at the door" },
      ] }) }
    );
    expect(out.source).toBe("llm");
    expect(out.coverage.map((i) => [i.code, i.frameNumber, i.fixed])).toEqual(expect.arrayContaining([["cta_not_hero", 6, true], ["weak_product_framing", 3, true]]));
    expect(hasProductFraming(out.frames[2].imagePrompt ?? "")).toBe(true);
    expect(out.frames[5].imagePrompt).toMatch(/^Hero shot of the NXTPAPER 14 from image 1/);
  });

  it("picks the bed from the plan's musicMood, the category and the platform", async () => {
    const { planMusicMood } = await import("./plan-to-storyboard");
    const calm = { ...plan, musicMood: "on-trend aesthetic pop/lo-fi/house", scripts: [{ ...plan.scripts[0], beats: plan.scripts[0].beats.map((b) => ({ ...b, onScreenText: "Read anywhere", vo: "Read anywhere." })) }], endCard: { ...plan.endCard, headline: "" } } as unknown as PlatformPlan;
    expect(planMusicMood({ plan: calm, productName: "X", category: "home_air_cleaning" })).toBe("chill-lofi");
    expect(planMusicMood({ plan: calm, productName: "X", category: "tablet_laptop" })).toBe("upbeat-pop");
    expect(planMusicMood({ plan, productName: "X" })).toBe("holiday");
  });
});

describe("CTA copy follows the button", () => {
  it("the CTA frame's on-screen line is the CTA button copy when one is given", () => {
    const f = scaffoldLockedFrames({ plan, productName: "NXTPAPER 14", ctaButton: "Claim Coupon" });
    const cta = f.find((x) => x.segment === "CTA")!;
    expect(cta.textOverlay).toBe("CLAIM COUPON");
    expect(scaffoldLockedFrames({ plan, productName: "NXTPAPER 14" }).find((x) => x.segment === "CTA")!.textOverlay).toBe("Claim Coupon");
  });
});

describe("comparison label from the live autopilot plan", async () => {
  const { detectComparison } = await import("./plan-to-storyboard");
  it("'X and Y side-by-side' labels the rival by its device, not by a later sentence", () => {
    const m = detectComparison("NXTPAPER 14 and a glossy iPad side-by-side under a harsh desk lamp. Glare blasts the iPad; the NXTPAPER is clear. Zoom into the matte texture.", "NXTPAPER 14")!;
    expect(m.labelOther).toBe("Glossy tablet");
    expect(m.other).not.toMatch(/ipad|nxtpaper/i);
  });
});
