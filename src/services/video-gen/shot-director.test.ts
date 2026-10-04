import { describe, expect, it } from "vitest";
import type { GridFrame } from "@/lib/storyboard-grid";
import type { CompiledJobDraft } from "./libtv-compile";
import { applyDirectedShots, completeShots, fallbackShot, finishDirectedMotion, finishDirectedStill, frameView, REALISM_MOTION, REALISM_STILL } from "./shot-director";
import { lockedEditPrompt } from "@/services/ai/matrix";

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
  cameraMove: "slow push-in",
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
  modelName: "m",
  settings,
  sourceUrl: null,
  creditsEstimated: 1,
});

describe("fallback shot", () => {
  it("is one continuous action from the first frame — no Beat 1 / Beat 2, no storyboard-art wording", () => {
    const s = fallbackShot(frame(1));
    expect(s.motion).not.toMatch(/Beat \d/);
    expect(s.motion).toMatch(/one continuous shot/i);
    expect(s.motion).toMatch(/first frame/i);
    expect(s.keyframe).not.toMatch(/storyboard concept art|tvc video ad/i);
    expect(s.keyframe).toMatch(/35mm/);
  });
});

describe("completeShots", () => {
  it("uses the model's shots and falls back for frames it skipped", () => {
    const frames = [frame(1), frame(2)];
    const ad = completeShots(frames, {
      cast: " A man in his 40s ",
      shots: [{ frameNumber: 1, keyframe: "K".repeat(40), motion: "M".repeat(40) }],
    });
    expect(ad.source).toBe("llm");
    expect(ad.cast).toBe("A man in his 40s");
    expect(ad.shots.get(1)!.keyframe).toBe("K".repeat(40));
    expect(ad.shots.get(2)!.motion).toMatch(/one continuous shot/i);
  });

  it("reports the fallback source when the model returned nothing", () => {
    expect(completeShots([frame(1)], null)).toMatchObject({ source: "fallback", cast: null });
  });
});

describe("finishing", () => {
  it("adds the realism block once and drops hex codes", () => {
    const still = finishDirectedStill("A man, wall #FFD700.");
    expect(still).toContain(REALISM_STILL);
    expect(still).not.toContain("#FFD700");
    expect(finishDirectedStill(still)).toBe(still);
    expect(finishDirectedMotion("Push in.")).toContain(REALISM_MOTION);
    expect(finishDirectedMotion(finishDirectedMotion("Push in."))).toBe(finishDirectedMotion("Push in."));
  });

  it("never carries the legacy wrapper that froze clips and plasticised faces", () => {
    const clip = finishDirectedMotion("Push in.");
    expect(clip).not.toMatch(/steady, slow camera|smooth motion|film still|sharp focus/i);
  });
});

describe("applyDirectedShots", () => {
  const ad = completeShots([frame(1)], { shots: [{ frameNumber: 1, keyframe: "KEYFRAME ".repeat(8), motion: "MOTION ".repeat(10) }] });

  it("rewrites keyframe and clip prompts and marks them directed", () => {
    const drafts = [draft("K1", "image", { frameNumber: 1 }), draft("V1", "video", { frameNumber: 1 })];
    expect(applyDirectedShots(drafts, ad, { castLocked: true, videoDirected: true })).toBe(2);
    expect(drafts[0].prompt).toContain("KEYFRAME");
    expect(drafts[0].settings).toMatchObject({ directed: 1, directedKeyframe: expect.stringContaining("KEYFRAME") });
    expect(drafts[1].prompt).toContain("MOTION");
    expect(drafts[1].settings).toMatchObject({ directed: 1 });
  });

  it("leaves CTA frames (composited locally) and free-GLM clip prompts alone", () => {
    const drafts = [draft("K1", "image", { compositeLocally: true }), draft("V1", "video")];
    expect(applyDirectedShots(drafts, ad, { castLocked: false, videoDirected: false })).toBe(0);
    expect(drafts.every((d) => d.prompt === "old storyboard prompt")).toBe(true);
  });

  it("adds the product facts to a keyframe only when there is no cast-lock reference", () => {
    const a = [draft("K1", "image", { frameNumber: 1 })];
    applyDirectedShots(a, ad, { castLocked: false, videoDirected: true, brandTruth: "PRODUCT FACTS" });
    expect(a[0].prompt).toContain("PRODUCT FACTS");
    const b = [draft("K1", "image", { frameNumber: 1 })];
    applyDirectedShots(b, ad, { castLocked: true, videoDirected: true, brandTruth: "PRODUCT FACTS" });
    expect(b[0].prompt).not.toContain("PRODUCT FACTS");
  });
});

describe("lockedEditPrompt long form", () => {
  const shot = "Medium close-up, 35mm. A man sits forward on a sofa. Sunlight from the left through sheer curtains, dust motes drift. Visible pores and fine lines, worn cotton tee creases. " + "Extra detail sentence. ".repeat(10);
  it("keeps the whole directed shot for models that accept long prompts, and stays short for Matrix", () => {
    const long = lockedEditPrompt("cast", shot, { maxChars: 1400 });
    expect(long).toContain("dust motes");
    expect(long.length).toBeGreaterThan(430);
    expect(lockedEditPrompt("cast", shot).length).toBeLessThanOrEqual(430);
  });
});

describe("frameView", () => {
  it("trims a frame to what the director needs", () => {
    expect(frameView(frame(3))).toMatchObject({ frameNumber: 3, segment: "HOOK", voiceover: "Is your picture washed out?" });
  });
});
