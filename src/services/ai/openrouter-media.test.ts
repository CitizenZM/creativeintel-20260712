import { describe, expect, it } from "vitest";
import { openrouterAspect, openrouterVideoBody, parseVideoTask } from "./openrouter-media";
import { IMAGE_MODELS, VIDEO_MODELS, engineFor, findImageModel, imageSettings, mismatchedImageEngine, videoSettings } from "@/services/video-gen/libtv-pricing";
import { videoDefaults } from "@/services/settings/ai-settings-core";

describe("OpenRouter video body", () => {
  it("sends the keyframe as the first frame, silent, with a lower-cased resolution", () => {
    const body = openrouterVideoBody({ model: "google/veo-3.1-lite", prompt: "p", imageUrl: "https://x/k.png", aspectRatio: "9:16", durationSec: 4.2, resolution: "720P" });
    expect(body).toMatchObject({
      model: "google/veo-3.1-lite",
      aspect_ratio: "9:16",
      duration: 4,
      resolution: "720p",
      generate_audio: false,
      frame_images: [{ type: "image_url", image_url: { url: "https://x/k.png" }, frame_type: "first_frame" }],
    });
  });

  it("can drop the audio flag for models that reject it, and runs text-only without a frame", () => {
    const body = openrouterVideoBody({ model: "m", prompt: "p", aspectRatio: "16:9", durationSec: 5 }, false);
    expect(body).not.toHaveProperty("generate_audio");
    expect(body).not.toHaveProperty("frame_images");
  });
});

describe("OpenRouter job status", () => {
  it("maps pending / in_progress to PROCESSING and completed to SUCCESS with the real cost", () => {
    expect(parseVideoTask({ status: "pending" })).toEqual({ status: "PROCESSING" });
    expect(parseVideoTask({ status: "in_progress" })).toEqual({ status: "PROCESSING" });
    expect(parseVideoTask({ status: "completed", usage: { cost: 0.1188 } })).toEqual({ status: "SUCCESS", costUsd: 0.1188 });
  });

  it("surfaces the provider's error on failure", () => {
    expect(parseVideoTask({ status: "failed", error: "content policy" })).toEqual({ status: "FAIL", error: "content policy" });
    expect(parseVideoTask({ status: "expired" }).status).toBe("FAIL");
  });
});

describe("aspect ratios", () => {
  it("passes supported ratios and falls back to vertical", () => {
    expect(openrouterAspect("16:9")).toBe("16:9");
    expect(openrouterAspect("21:9")).toBe("9:16");
  });
});

describe("OpenRouter catalogue", () => {
  it("renders on the openrouter engine and carries its model id into the job settings", () => {
    expect(engineFor("Veo 3.1 Lite 720p (OpenRouter)")).toBe("openrouter");
    expect(videoSettings("Veo 3.1 Lite 720p (OpenRouter)")).toMatchObject({ openrouterModel: "google/veo-3.1-lite", duration: 4, resolution: "720P" });
    expect(imageSettings("Seedream 5 Flash (OpenRouter)")).toMatchObject({ openrouterModel: "bytedance-seed/seedream-5-0-flash", lockCharacter: 1 });
  });

  it("the free-GLM hybrid keeps CogVideoX clips: image is glm-engine, so it pairs with GLM video only", () => {
    const hybrid = "Seedream 5 Flash cast-locked (OpenRouter keyframes, free GLM clips)";
    expect(findImageModel(hybrid)?.engine).toBe("glm");
    expect(mismatchedImageEngine(hybrid, "GLM CogVideoX-Flash")).toBeNull();
    expect(mismatchedImageEngine(hybrid, "Veo 3.1 Lite 720p (OpenRouter)")).toBe("glm");
  });

  it("every OpenRouter model has an id, and Veo only offers the lengths it supports (4/6/8 s)", () => {
    for (const m of [...IMAGE_MODELS, ...VIDEO_MODELS].filter((x) => x.engine === "openrouter")) expect(m.openrouterModel).toBeTruthy();
    const veo = VIDEO_MODELS.find((m) => m.openrouterModel === "google/veo-3.1-lite")!;
    expect(veo.prices.map((p) => p.durationSec)).toEqual([4, 6, 8]);
  });

  it("is the engine default only when the key is present and not in strict free mode", () => {
    expect(videoDefaults("openrouter", false, [], { openrouterAvailable: true })).toEqual({
      imageModel: "Seedream 5 Flash (OpenRouter)",
      videoModel: "Veo 3.1 Lite 720p (OpenRouter)",
    });
    expect(videoDefaults("openrouter", true, [], { openrouterAvailable: true, glmAvailable: true }).videoModel).toBe("GLM CogVideoX-Flash");
  });
});
