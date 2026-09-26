import { describe, expect, it } from "vitest";
import {
  ANIMATIC_IMAGE_MODEL,
  ANIMATIC_VIDEO_MODEL,
  COMFY_IMAGE_MODEL,
  COMFY_VIDEO_MODEL,
  GLM_IMAGE_MODEL,
  GLM_VIDEO_MODEL,
  engineFor,
  engineLabel,
  imageCredits,
  isServerEngine,
  mismatchedImageEngine,
  modelOptions,
  videoCredits,
} from "./libtv-pricing";

describe("engineFor", () => {
  it("routes by the video model", () => {
    expect(engineFor("Hailuo 2.3 Fast")).toBe("libtv");
    expect(engineFor(GLM_VIDEO_MODEL)).toBe("glm");
    expect(engineFor(COMFY_VIDEO_MODEL)).toBe("comfyui");
    expect(engineFor("unknown model")).toBe("libtv");
  });

  it("knows which engines render on the server", () => {
    expect(isServerEngine("glm")).toBe(true);
    expect(isServerEngine("comfyui")).toBe(true);
    expect(isServerEngine("libtv")).toBe(false);
    expect(isServerEngine(null)).toBe(false);
    expect(engineLabel("comfyui")).toMatch(/ComfyUI/);
  });

  it("prices ComfyUI at 0 credits", () => {
    expect(imageCredits(COMFY_IMAGE_MODEL)).toBe(0);
    expect(videoCredits(COMFY_VIDEO_MODEL, 5)).toBe(0);
  });
});

describe("mismatchedImageEngine", () => {
  it("flags a server-side image model paired with another engine", () => {
    expect(mismatchedImageEngine(COMFY_IMAGE_MODEL, "Hailuo 2.3 Fast")).toBe("comfyui");
    expect(mismatchedImageEngine(GLM_IMAGE_MODEL, COMFY_VIDEO_MODEL)).toBe("glm");
    expect(mismatchedImageEngine(COMFY_IMAGE_MODEL, COMFY_VIDEO_MODEL)).toBeNull();
    expect(mismatchedImageEngine("Seedream 4.0", "Hailuo 2.3 Fast")).toBeNull();
    // A LibTV image model on a server engine is simply ignored by that engine.
    expect(mismatchedImageEngine("Seedream 4.0", GLM_VIDEO_MODEL)).toBeNull();
  });
});

describe("modelOptions", () => {
  const names = (o: ReturnType<typeof modelOptions>) => [...o.image, ...o.video].map((m) => m.name);

  it("hides ComfyUI when no node is configured", () => {
    expect(names(modelOptions(false, false))).not.toContain(COMFY_VIDEO_MODEL);
    expect(names(modelOptions(true, false, {}, true))).toEqual([GLM_IMAGE_MODEL, ANIMATIC_IMAGE_MODEL, GLM_VIDEO_MODEL, ANIMATIC_VIDEO_MODEL]);
  });

  it("hides the GLM models when no Zhipu key is set", () => {
    const all = names(modelOptions(false, false, {}, false));
    expect(all).not.toContain(GLM_VIDEO_MODEL);
    expect(all).not.toContain(GLM_IMAGE_MODEL);
    expect(all).toContain("Hailuo 2.3 Fast");
  });

  it("offers ComfyUI when COMFYUI_URL is set, including in strict free mode", () => {
    expect(names(modelOptions(false, true))).toEqual(expect.arrayContaining([COMFY_IMAGE_MODEL, COMFY_VIDEO_MODEL, "Hailuo 2.3 Fast"]));
    const free = names(modelOptions(true, true, {}, true));
    expect(free).toEqual(expect.arrayContaining([GLM_IMAGE_MODEL, GLM_VIDEO_MODEL, COMFY_IMAGE_MODEL, COMFY_VIDEO_MODEL]));
    expect(free).not.toContain("Hailuo 2.3 Fast");
  });

  it("reads COMFYUI_URL by default", () => {
    const before = process.env.COMFYUI_URL;
    process.env.COMFYUI_URL = "http://gpu.internal:8188";
    try {
      expect(names(modelOptions(true))).toContain(COMFY_VIDEO_MODEL);
    } finally {
      if (before === undefined) delete process.env.COMFYUI_URL;
      else process.env.COMFYUI_URL = before;
    }
  });

  it("exposes the ComfyUI clip durations at 0 credits", () => {
    const video = modelOptions(false, true).video.find((m) => m.name === COMFY_VIDEO_MODEL)!;
    expect(video.credits).toBe(0);
    expect(video.durations).toEqual([4, 5]);
  });
});
