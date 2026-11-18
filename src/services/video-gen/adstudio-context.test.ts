/* eslint-disable @typescript-eslint/no-explicit-any -- the test walks the nested context JSON */
import { describe, expect, it } from "vitest";
import { hookTypeOf, isHomepage, shapeContext, summarizeContext } from "./adstudio-context";

const raw = () => ({
  project: {
    productName: "Glow Mist", campaignGoal: "Direct Conversion", productConfirmedAt: new Date(),
    productPageImages: [{ url: "https://x.com/a.jpg", alt: "bottle" }, { url: "https://x.com/a.jpg" }, { url: "data:image/png;base64,xx" }],
    userProductImages: [{ url: "https://x.com/user.jpg", caption: "in hand" }],
    productBrief: { sellingPoints: [{ point: "hydrates in 3 s", rank: 1 }], objections: ["sticky?"] },
    testPlan: { round1: ["pain vs result"] },
  },
  brand: { brandPromise: "routine in seconds", toneOfVoice: "energetic", displayGuidelines: [{ rule: "show the cap" }] },
  teardowns: [
    { hookType: "problem_agitate", hookText: "Dry skin on flights?", beats: [{ role: "hook", visual: "plane", vo: "x" }], whyItWorks: "names the pain", contentAsset: { title: "Ad A", overallScore: 90 } },
    { hookType: "curiosity_gap", hookText: "The mist nobody talks about", beats: [], whyItWorks: "gap", contentAsset: { title: "Ad B", overallScore: 70 } },
    { hookType: "problem_agitate", hookText: "Cracked skin", beats: [], whyItWorks: "pain", contentAsset: { title: "Ad C", overallScore: 60 } },
  ],
  sellingPoints: [
    { point: "weak", strength: 10, selected: false },
    { point: "picked", strength: 20, selected: true },
    { point: "gone", strength: 99, dismissed: true },
    { point: "strong", strength: 90 },
  ],
  insights: [{ category: "gap", title: "Routine overwhelm", recommendation: "lead with one step", importance: 0.9 }],
  narratives: [{ type: "DEMONSTRATION", name: "Sensory demo", description: "d", dismissed: false }],
  audience: { painPoints: [{ point: "no time" }, { point: "travel dryness" }], segments: [{ name: "Pros", ageRange: "25-38" }] },
  deep: { hookFormulas: [{ type: "before_after", formula: "show dull then dewy" }] },
  selection: { selectedActorRole: "Frequent Traveler", selectedActorDesc: "relaxed", selectedEnvironment: "Airport", selectedSellingPoints: [{ point: "Hydrating" }], platform: "instagram", totalDurationSec: 15 },
  angle: null,
  script: { angle: "Jetsetter's Dream", template: "BEFORE_AFTER" },
});

describe("shapeContext", () => {
  it("carries every pre-Studio step: setup, brand, research, insights, planning, creative", () => {
    const c = shapeContext(raw()) as Record<string, any>;
    expect(c.setup.confirmed).toBe(true);
    expect(c.setup.images.map((i: { url: string }) => i.url)).toEqual(["https://x.com/user.jpg", "https://x.com/a.jpg"]); // user photos first, deduped, only http(s)
    expect(c.setup.brief.objections).toEqual(["sticky?"]);
    expect(c.brand.tone).toBe("energetic");
    expect(c.research.winningAds.map((a: { title: string }) => a.title)).toEqual(["Ad A", "Ad B", "Ad C"]); // best score first
    expect(c.research.winningAds[0].beats[0].visual).toBe("plane");
    expect(c.insights.sellingPoints.map((s: { point: string }) => s.point)).toEqual(["picked", "strong", "weak"]); // picked first, dismissed dropped
    expect(c.insights.audience.painPoints).toEqual(["no time", "travel dryness"]);
    expect(c.planning.testPlan.round1).toEqual(["pain vs result"]);
    expect(c.creative.angle.title).toBe("Jetsetter's Dream");
    expect(c.creative.actor.role).toBe("Frequent Traveler");
    expect(c.creative.environment.name).toBe("Airport");
    expect(c.creative.template).toBe("BEFORE_AFTER");
  });
  it("suggests hook types from what won in research (votes weighted by ad score)", () => {
    expect(shapeContext(raw()).suggestedHookTypes).toEqual(["pain", "curiosity", "result"]);
  });
  it("an empty project gives an empty pack, not a crash", () => {
    const c = shapeContext({ project: {} }) as Record<string, any>;
    expect(c.v).toBe(1);
    expect(summarizeContext(c as never)).toMatchObject({ images: 0, winningAds: 0, sellingPoints: 0, plan: false, suggestedHookTypes: [] });
    expect(c.planning).toBeUndefined();
  });
  it("summary counts what the panel shows", () => {
    expect(summarizeContext(shapeContext(raw()))).toMatchObject({ images: 2, winningAds: 3, sellingPoints: 3, insights: 1, painPoints: 2, hookFormulas: 1, actor: "Frequent Traveler", environment: "Airport", plan: true });
  });
});

describe("warnings", () => {
  it("flags a homepage product link (no price to read) before anything is planned", () => {
    const home = shapeContext({ ...raw(), project: { ...raw().project, productUrl: "https://mixikskin.com/" } });
    expect(summarizeContext(home).warnings[0]).toMatch(/homepage/);
    const pdp = shapeContext({ ...raw(), project: { ...raw().project, productUrl: "https://mixikskin.com/products/glow-mist" } });
    expect(summarizeContext(pdp).warnings).toEqual([]);
    expect(isHomepage("not a url")).toBe(false);
  });
});

describe("pace reference videos (P2)", () => {
  it("carries every torn-down ad with a video link, best score first, including ones outside the top 5", () => {
    const tears = [
      ...raw().teardowns,
      { hookType: "demo", contentAsset: { title: "YT ad", overallScore: 85, url: "https://youtube.com/watch?v=a", durationSec: 30 } },
      { hookType: "demo", contentAsset: { title: "Meta ad", overallScore: 50, url: "https://facebook.com/ads/library/?id=1", videoUrl: "https://cdn.x/v.mp4" } },
      { hookType: "demo", contentAsset: { title: "Blog", overallScore: 99, url: "https://blog.com/post" } },
    ];
    const c = shapeContext({ ...raw(), teardowns: tears }) as Record<string, any>;
    expect(c.research.rhythmRefs.map((x: { title: string }) => x.title)).toEqual(["YT ad", "Meta ad"]);
    expect(c.research.rhythmRefs[1]).toMatchObject({ videoUrl: "https://cdn.x/v.mp4", pageUrl: "https://facebook.com/ads/library/?id=1" });
    expect(summarizeContext(c as never).paceVideos).toBe(2);
    expect(shapeContext(raw()).research).not.toHaveProperty("rhythmRefs");
  });
});

describe("hookTypeOf", () => {
  it("maps research hook names to Ad Studio hook types", () => {
    expect(hookTypeOf("pattern_interrupt")).toBe("interrupt");
    expect(hookTypeOf("ugc_testimonial")).toBe("social");
    expect(hookTypeOf("demo_first")).toBe("result");
    expect(hookTypeOf("nothing-like-it")).toBeUndefined();
  });
});

describe("insights for the next video", () => {
  it("own video reviews take at most 3 of the 6 slots, weakest first; research insights keep their place", () => {
    const rev = (n: number, imp: number) => ({ category: "adstudio_review", title: `review ${n}`, recommendation: "fix offer", importance: imp });
    const c = shapeContext({ ...raw(), insights: [rev(1, 0.7), rev(2, 0.6), rev(3, 0.5), rev(4, 0.45), rev(5, 0.4), { category: "gap", title: "Routine overwhelm", recommendation: "lead with one step", importance: 0.3 }] });
    const titles = c.insights.insights.map((x) => String(x.title));
    expect(titles.filter((t) => t.startsWith("review"))).toEqual(["review 1", "review 2", "review 3"]);
    expect(titles).toContain("Routine overwhelm");
  });
});
