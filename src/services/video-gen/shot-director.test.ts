import { describe, expect, it } from "vitest";
import type { GridFrame } from "@/lib/storyboard-grid";
import type { CompiledJobDraft } from "./libtv-compile";
import {
  applyDirectedShots,
  completeShots,
  fallbackShot,
  finishDirectedMotion,
  finishDirectedStill,
  frameView,
  negativePromptFor,
  REALISM_MOTION,
  REALISM_STILL,
  storedPlan,
} from "./shot-director";
import { lockedEditPrompt } from "@/services/ai/matrix";
import { negativeOptions, openrouterVideoBody } from "@/services/ai/openrouter-media";

const frame = (n: number, over: Partial<GridFrame> = {}): GridFrame => ({
  frameNumber: n,
  startSec: (n - 1) * 2.5,
  endSec: n * 2.5,
  duration: "2.5s",
  segment: "HOOK",
  scene: "A man squints at a dull old TV",
  visualDirection: "frustrated viewer",
  voiceover: "Is your picture washed out?",
  textOverlay: "",
  cameraNotes: "",
  imagePrompt: "The same middle-aged Asian male actor in a living room. cinematic storyboard concept art, tvc video ad, photorealistic.",
  videoPrompt: "Beat 1: close-up. Beat 2: wide shot.",
  shotType: "close-up",
  cameraMove: "",
  subject: "man on sofa",
  productAction: "he shakes his head and taps the remote",
  sfx: "",
  sellingPoint: "",
  howExpressed: "",
  ...over,
});

const draft = (nodeName: string, kind: "image" | "video", settings: Record<string, unknown> = {}): CompiledJobDraft => ({
  shotIndex: 0,
  kind,
  nodeName,
  leftRefs: [],
  prompt: "old storyboard prompt",
  modelName: "Veo 3.1 Lite 720p (OpenRouter)",
  settings,
  sourceUrl: null,
  creditsEstimated: 12,
});

const llmShot = (f: number, over: Record<string, unknown> = {}) => ({ f, kf: "KEYFRAME ".repeat(8), mo: "MOTION ".repeat(10), cam: "orbit", act: false, vo: "Three thousand nits.", txt: "3,000 NITS", sp: 0, ...over });

describe("frameView (director input)", () => {
  it("uses short keys, a word budget for the shot length, and drops empty fields", () => {
    const v = frameView(frame(3));
    expect(v).toMatchObject({ f: 3, seg: "HOOK", words: 6, vo: "Is your picture washed out?" });
    expect(v).not.toHaveProperty("txt");
    expect(v).not.toHaveProperty("cmp");
  });

  it("flags a comparison frame", () => {
    expect(frameView(frame(5, { visualDirection: "split screen: old TV vs TCL" })).cmp).toBe(1);
  });
});

describe("fallback shot", () => {
  it("moves the camera and is one continuous action — no Beat 1 / Beat 2, no storyboard-art wording", () => {
    const s = fallbackShot(frame(1), 2);
    expect(s.motion).not.toMatch(/Beat \d/);
    expect(s.motion).toMatch(/one continuous take/i);
    expect(s.camera).toMatch(/arc/);
    expect(s.keyframe).not.toMatch(/storyboard concept art|tvc video ad/i);
  });
});

describe("completeShots", () => {
  it("keeps the model's copy and camera, and falls back for frames it skipped", () => {
    const ad = completeShots([frame(1), frame(2)], { cast: " A man in his 40s ", sp: [{ claim: "3,000 nits", proof: "sunlit room" }], shots: [llmShot(1, { act: true })] });
    expect(ad.source).toBe("llm");
    expect(ad.cast).toBe("A man in his 40s");
    expect(ad.sellingPoints).toEqual([{ claim: "3,000 nits", proof: "sunlit room" }]);
    expect(ad.shots.get(1)).toMatchObject({ camera: "orbit", action: true, voiceover: "Three thousand nits.", onScreen: "3,000 NITS" });
    expect(ad.shots.get(2)!.motion).toMatch(/one continuous take/i);
  });

  it("forces a comparison frame to keep 'split screen' so the comparison split still runs", () => {
    const ad = completeShots([frame(5, { scene: "side by side with an old TV" })], { shots: [llmShot(5, { kf: "Close-up of two TVs in a sunlit room, one dull and one vivid." })] });
    expect(ad.shots.get(5)!.keyframe).toMatch(/^Split screen:/);
  });

  it("drops an on-screen line that is a sentence, not a keyword", () => {
    const ad = completeShots([frame(1)], { shots: [llmShot(1, { txt: "This TV is the brightest one you will ever buy" })] });
    expect(ad.shots.get(1)!.onScreen).toBeNull();
  });
});

describe("realism", () => {
  it("adds the realism block once and strips plastic-making words and hex codes", () => {
    const still = finishDirectedStill("A photorealistic cinematic 8K man, wall #FFD700.");
    expect(still).toContain(REALISM_STILL);
    expect(still).not.toMatch(/photorealistic|cinematic|8K|#FFD700/i);
    expect(finishDirectedStill(still)).toBe(still);
    expect(finishDirectedMotion("Push in.")).toContain(REALISM_MOTION);
    expect(finishDirectedMotion(finishDirectedMotion("Push in."))).toBe(finishDirectedMotion("Push in."));
  });

  it("never carries the legacy wrapper that froze clips and plasticised faces", () => {
    expect(finishDirectedMotion("Push in.")).not.toMatch(/steady, slow camera|smooth motion|film still|sharp focus/i);
  });

  it("sends 3–5 negatives per model family through the provider's own field", () => {
    expect(negativePromptFor("kwaivgi/kling-v3.0-std").split(",").length).toBeLessThanOrEqual(5);
    // Kling is served by atlas-cloud on OpenRouter; options.kling was silently dropped.
    expect(negativeOptions("kwaivgi/kling-v3.0-std", "waxy skin")).toEqual({ options: { "atlas-cloud": { parameters: { negative_prompt: "waxy skin" } } } });
    expect(negativeOptions("google/veo-3.1-lite", "over-smoothed")).toEqual({ options: { "google-vertex": { parameters: { negativePrompt: "over-smoothed" } } } });
    expect(negativeOptions("alibaba/wan-3.0", "x")).toBeNull();
    expect(openrouterVideoBody({ model: "kwaivgi/kling-v3.0-std", prompt: "p", aspectRatio: "9:16", durationSec: 3, negativePrompt: "waxy skin" })).toHaveProperty("provider");
    expect(openrouterVideoBody({ model: "kwaivgi/kling-v3.0-std", prompt: "p", aspectRatio: "9:16", durationSec: 3, negativePrompt: "waxy skin" }, true, false)).not.toHaveProperty("provider");
  });
});

describe("applyDirectedShots", () => {
  const ad = completeShots([frame(1), frame(2)], { shots: [llmShot(1), llmShot(2, { act: true })] });
  const kling = { modelName: "Kling 3.0 Std 720p (OpenRouter)", settings: { openrouterModel: "kwaivgi/kling-v3.0-std", duration: 3 }, credits: 26 };

  it("rewrites prompts, marks them directed, and sends action shots to Kling", () => {
    const drafts = [draft("K1", "image", { frameNumber: 1 }), draft("V1", "video"), draft("V2", "video", { openrouterModel: "google/veo-3.1-lite", duration: 4 })];
    expect(applyDirectedShots(drafts, ad, { castLocked: true, videoDirected: true, actionVideo: kling })).toBe(3);
    expect(drafts[0].settings).toMatchObject({ directed: 1, directedKeyframe: expect.stringContaining("KEYFRAME") });
    expect(drafts[1]).toMatchObject({ modelName: "Veo 3.1 Lite 720p (OpenRouter)", creditsEstimated: 12 });
    expect(drafts[2]).toMatchObject({ modelName: "Kling 3.0 Std 720p (OpenRouter)", creditsEstimated: 26 });
    expect(drafts[2].settings).toMatchObject({ openrouterModel: "kwaivgi/kling-v3.0-std", duration: 3, actionShot: 1, camera: "orbit" });
  });

  it("leaves CTA frames (composited locally) and free-GLM clip prompts alone", () => {
    const drafts = [draft("K1", "image", { compositeLocally: true }), draft("V1", "video")];
    expect(applyDirectedShots(drafts, ad, { castLocked: false, videoDirected: false })).toBe(0);
    expect(drafts.every((d) => d.prompt === "old storyboard prompt")).toBe(true);
  });
});

describe("storedPlan", () => {
  it("keeps the copy the edit needs, and nothing for a fallback plan", () => {
    const ad = completeShots([frame(1)], { shots: [llmShot(1)] });
    expect(storedPlan(ad)!.frames["1"]).toEqual({ vo: "Three thousand nits.", txt: "3,000 NITS", cam: "orbit", act: false });
    expect(storedPlan(completeShots([frame(1)], null))).toBeNull();
  });
});

describe("lockedEditPrompt long form", () => {
  const shot = "Medium close-up, 35mm. A man sits forward on a sofa. Sunlight from the left through sheer curtains, dust motes drift. Visible pores and fine lines, worn cotton tee creases. " + "Extra detail sentence. ".repeat(10);
  it("keeps the whole directed shot for models that accept long prompts, and stays short for Matrix", () => {
    expect(lockedEditPrompt("cast", shot, { maxChars: 1400 })).toContain("dust motes");
    expect(lockedEditPrompt("cast", shot).length).toBeLessThanOrEqual(430);
  });
});

describe("fitVoiceover", () => {
  const f = (n: number, seg = "BODY") => frame(n, { startSec: (n - 1) * 2, endSec: n * 2, segment: seg as GridFrame["segment"] });
  it("lets a long line take over the next shot, and trims it at a clause when it still doesn't fit", () => {
    const frames = [f(1), f(2), f(3), f(4, "CTA")];
    const ad = completeShots(frames, {
      shots: [
        llmShot(1, { vo: "Up to three thousand nits keeps it bright, curtains open." }),
        llmShot(2, { vo: "Second line." }),
        llmShot(3, { vo: "Colours stay true, every single scene, every single day, all year round, for everyone at home, forever and ever." }),
        llmShot(4, { vo: "Shop the sale now." }),
      ],
    });
    expect(ad.shots.get(1)!.voiceover).toBe("Up to three thousand nits keeps it bright, curtains open.");
    expect(ad.shots.get(2)!.voiceover).toBeNull();
    // Frame 3 cannot take over the CTA: trimmed to its own 5-word budget at a clause.
    expect(ad.shots.get(3)!.voiceover!.split(/\s+/).length).toBeLessThanOrEqual(6);
    expect(ad.shots.get(4)!.voiceover).toBe("Shop the sale now.");
  });
});

describe("frameCopy (director plan over the storyboard)", () => {
  it("never falls back to the storyboard line when the plan leaves a shot silent", async () => {
    const { frameCopy } = await import("./server-executor");
    expect(frameCopy({ vo: null, txt: "3,000 NITS" }, "old text", "old line")).toEqual({ text: "3,000 NITS", voiceover: null });
    // …but a shot without a keyword keeps the storyboard's on-screen text (the hook headline).
    expect(frameCopy({ vo: "Line.", txt: null }, "Is your TV too dark?", "old line")).toEqual({ text: "Is your TV too dark?", voiceover: "Line." });
    expect(frameCopy(undefined, "old text", "old line")).toEqual({ text: "old text", voiceover: "old line" });
  }, 30_000); // cold dynamic import of the executor's module graph
});

describe("CTA line", () => {
  it("keeps the storyboard's call to action when the plan leaves the end card silent", () => {
    const frames = [frame(1, { segment: "BODY" }), frame(2, { segment: "CTA", voiceover: "Shop TCL today." }), frame(3, { segment: "CTA", voiceover: "Shop TCL today." })];
    const ad = completeShots(frames, { shots: [llmShot(1), llmShot(2, { vo: null }), llmShot(3, { vo: null })] });
    expect(ad.shots.get(2)!.voiceover).toBe("Shop TCL today.");
    expect(ad.shots.get(3)!.voiceover).toBeNull();
  });
});
