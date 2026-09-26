import { describe, expect, it } from "vitest";
import {
  customVideoModelName,
  DEFAULT_AI_SETTINGS,
  engineOptions,
  envAvailability,
  normalizeSettings,
  providerInputSchema,
  resolveStrictFree,
  routeOrder,
  videoDefaults,
  type CustomProviderInfo,
} from "./ai-settings-core";

const TEXT_BASE = ["openai", "gemini", "anthropic", "openrouter", "glm"];

describe("resolveStrictFree — DB > env > default", () => {
  it("uses the DB value when set", () => {
    expect(resolveStrictFree(true, undefined)).toEqual({ effective: true, source: "db" });
    expect(resolveStrictFree(false, "free")).toEqual({ effective: false, source: "db" });
  });

  it("falls back to env AI_COST_MODE when the DB has no value", () => {
    expect(resolveStrictFree(null, "free")).toEqual({ effective: true, source: "env" });
    expect(resolveStrictFree(undefined, "paid")).toEqual({ effective: false, source: "env" });
  });

  it("defaults to off", () => {
    expect(resolveStrictFree(null, undefined)).toEqual({ effective: false, source: "default" });
    expect(resolveStrictFree(null, "")).toEqual({ effective: false, source: "default" });
  });
});

describe("normalizeSettings", () => {
  it("fills defaults for missing or invalid values", () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_AI_SETTINGS);
    expect(normalizeSettings({ text: "gemini", image: 42, strictFree: "yes" })).toEqual({
      ...DEFAULT_AI_SETTINGS,
      text: "gemini",
    });
  });

  it("keeps custom provider choices and explicit strict-free", () => {
    expect(normalizeSettings({ video: "custom:abc123", strictFree: false })).toEqual({
      ...DEFAULT_AI_SETTINGS,
      video: "custom:abc123",
      strictFree: false,
    });
  });

  it("rejects an engine that does not serve the capability", () => {
    expect(normalizeSettings({ text: "libtv", video: "anthropic" })).toEqual(DEFAULT_AI_SETTINGS);
  });
});

describe("routeOrder — engine selection", () => {
  it("auto keeps today's order", () => {
    expect(routeOrder("auto", TEXT_BASE, { strictFree: false, freeIds: ["glm"] })).toEqual(TEXT_BASE);
  });

  it("puts the chosen engine first, then falls back in today's order", () => {
    expect(routeOrder("anthropic", TEXT_BASE, { strictFree: false, freeIds: ["glm"] })).toEqual([
      "anthropic",
      "openai",
      "gemini",
      "openrouter",
      "glm",
    ]);
    expect(routeOrder("custom:p1", TEXT_BASE, { strictFree: false, freeIds: ["glm"] })[0]).toBe("custom:p1");
  });

  it("AI_PROVIDER still forces a single provider when nothing is chosen", () => {
    expect(routeOrder("auto", TEXT_BASE, { strictFree: false, freeIds: ["glm"], forced: "gemini" })).toEqual(["gemini"]);
    expect(routeOrder("glm", TEXT_BASE, { strictFree: false, freeIds: ["glm"], forced: "gemini" })).toEqual(["glm", "gemini"]);
  });

  it("strict free mode keeps only free engines, whatever was chosen", () => {
    expect(routeOrder("openai", TEXT_BASE, { strictFree: true, freeIds: ["glm"] })).toEqual(["glm"]);
    expect(routeOrder("custom:p1", TEXT_BASE, { strictFree: true, freeIds: ["glm"], forced: "openai" })).toEqual(["glm"]);
    expect(
      routeOrder("pollinations", ["glm", "pollinations"], { strictFree: true, freeIds: ["glm", "pollinations"] })
    ).toEqual(["pollinations", "glm"]);
  });
});

const zhipuPaid: CustomProviderInfo = {
  id: "p1",
  name: "My Zhipu",
  type: "zhipu-paid",
  models: { video: "cogvideox-3", text: "glm-4.7" },
  prices: { perClipUsd: 0.14 },
};
const fal: CustomProviderInfo = { id: "p2", name: "fal", type: "fal", models: { image: "fal-ai/flux/dev" }, prices: null };

describe("videoDefaults", () => {
  it("strict free always renders on GLM", () => {
    expect(videoDefaults("libtv", true, [zhipuPaid])).toEqual({ imageModel: "GLM CogView-3-Flash", videoModel: "GLM CogVideoX-Flash" });
  });

  it("maps each choice to its compile defaults", () => {
    expect(videoDefaults("auto", false, [])).toEqual({ imageModel: "Seedream 4.0", videoModel: "Hailuo 2.3 Fast" });
    expect(videoDefaults("glm", false, [])).toEqual({ imageModel: "GLM CogView-3-Flash", videoModel: "GLM CogVideoX-Flash" });
    expect(videoDefaults("custom:p1", false, [zhipuPaid])).toEqual({
      imageModel: "GLM CogView-3-Flash",
      videoModel: customVideoModelName(zhipuPaid),
    });
    expect(videoDefaults("custom:gone", false, [zhipuPaid]).videoModel).toBe("Hailuo 2.3 Fast");
  });

  it("renders on ComfyUI only when a node is configured", () => {
    const comfy = { imageModel: "ComfyUI Image (self-hosted)", videoModel: "ComfyUI Video (self-hosted)" };
    expect(videoDefaults("comfyui", false, [], { comfyAvailable: true })).toEqual(comfy);
    // ComfyUI is zero-credit, so it stays the default in strict free mode.
    expect(videoDefaults("comfyui", true, [], { comfyAvailable: true })).toEqual(comfy);
    expect(videoDefaults("comfyui", false, [], { comfyAvailable: false }).videoModel).toBe("Hailuo 2.3 Fast");
    expect(videoDefaults("comfyui", true, [], { comfyAvailable: false }).videoModel).toBe("GLM CogVideoX-Flash");
  });
});

describe("engineOptions", () => {
  const env = envAvailability({ ZHIPU_API_KEY: "z", OPENAI_API_KEY: "o" });

  it("marks env providers connected only when their key exists", () => {
    const opts = engineOptions("text", { env, providers: [], strictFree: false });
    expect(opts.find((o) => o.value === "openai")?.connected).toBe(true);
    expect(opts.find((o) => o.value === "gemini")?.connected).toBe(false);
    expect(opts.find((o) => o.value === "gemini")?.disabledReason).toMatch(/GEMINI_API_KEY/);
  });

  it("lists custom providers only for capabilities they serve", () => {
    const image = engineOptions("image", { env, providers: [zhipuPaid, fal], strictFree: false });
    expect(image.some((o) => o.value === "custom:p2")).toBe(true);
    expect(image.some((o) => o.value === "custom:p1")).toBe(false);
    const video = engineOptions("video", { env, providers: [zhipuPaid, fal], strictFree: false });
    expect(video.map((o) => o.value)).toEqual(["auto", "glm", "comfyui", "libtv", "custom:p1"]);
    expect(video.find((o) => o.value === "comfyui")?.disabledReason).toMatch(/COMFYUI_URL/);
  });

  it("disables paid engines in strict free mode with a reason", () => {
    const opts = engineOptions("text", { env, providers: [zhipuPaid], strictFree: true });
    const openai = opts.find((o) => o.value === "openai")!;
    expect(openai.disabledReason).toMatch(/Strict free mode/);
    expect(opts.find((o) => o.value === "glm")?.disabledReason).toBeUndefined();
    expect(opts.find((o) => o.value === "custom:p1")?.disabledReason).toMatch(/Strict free mode/);
  });

  it("keeps a configured ComfyUI node selectable in strict free mode", () => {
    const withComfy = envAvailability({ ZHIPU_API_KEY: "z", COMFYUI_URL: "https://gpu.example" });
    const video = engineOptions("video", { env: withComfy, providers: [], strictFree: true });
    expect(video.find((o) => o.value === "comfyui")).toMatchObject({ connected: true, paid: false });
    expect(video.find((o) => o.value === "comfyui")?.disabledReason).toBeUndefined();
    expect(video.find((o) => o.value === "libtv")?.disabledReason).toMatch(/Strict free mode/);
  });
});

describe("providerInputSchema", () => {
  it("accepts a paid Zhipu video provider", () => {
    const r = providerInputSchema.safeParse({
      name: "My Zhipu",
      type: "zhipu-paid",
      apiKey: "abcdefgh.12345678",
      models: { video: "cogvideox-3" },
      prices: { perClipUsd: 0.14 },
    });
    expect(r.success).toBe(true);
  });

  it("rejects unknown types, extra fields and short keys", () => {
    expect(providerInputSchema.safeParse({ name: "x", type: "azure", apiKey: "abcdefghij", models: {} }).success).toBe(false);
    expect(
      providerInputSchema.safeParse({ name: "x", type: "fal", apiKey: "abcdefghij", models: {}, admin: true }).success
    ).toBe(false);
    expect(providerInputSchema.safeParse({ name: "x", type: "fal", apiKey: "short", models: {} }).success).toBe(false);
  });
});
