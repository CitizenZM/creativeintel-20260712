import { describe, expect, it, vi } from "vitest";

vi.mock("@/services/settings/ai-settings", () => ({ cachedAiSettings: vi.fn(), cachedProvider: vi.fn(), loadAiSettings: vi.fn() }));

import { glmModelLadder, isTransientError } from "./claude-client";

describe("glmModelLadder", () => {
  it("tries the second free model before any paid one", () => {
    expect(glmModelLadder("glm-4.7-flash", "text", false)).toEqual(["glm-4.7-flash", "glm-4-flash-250414"]);
    expect(glmModelLadder("glm-4.7-flash", "text", true)).toEqual(["glm-4.7-flash", "glm-4-flash-250414", "glm-4-air-250414"]);
  });
  it("vision falls back to the cheap paid vision model only when allowed", () => {
    expect(glmModelLadder("glm-4.6v-flash", "vision", false)).toEqual(["glm-4.6v-flash"]);
    expect(glmModelLadder("glm-4.6v-flash", "vision", true)).toEqual(["glm-4.6v-flash", "glm-4.6v-flashx"]);
  });
});

describe("isTransientError", () => {
  it("treats rate limits, outages and timeouts as worth a fallback", () => {
    expect(isTransientError({ status: 429 })).toBe(true);
    expect(isTransientError({ status: 503 })).toBe(true);
    class APIConnectionTimeoutError extends Error {}
    expect(isTransientError(new APIConnectionTimeoutError("Request timed out."))).toBe(true);
  });
  it("does not retry a bad request", () => {
    expect(isTransientError({ status: 400 })).toBe(false);
    expect(isTransientError(new Error("Zod parse failed"))).toBe(false);
  });
});

describe("isTransientError in the production bundle", () => {
  it("recognises the SDK's timeout by class, whatever its minified name", async () => {
    const { APIConnectionTimeoutError } = await import("openai");
    expect(isTransientError(new APIConnectionTimeoutError())).toBe(true);
    expect(isTransientError(Object.assign(new Error("Request timed out."), { name: "rB" }))).toBe(true);
  });
});

describe("requestTimeoutMs", () => {
  it("gives slow fallback models room for a long answer, but never the whole run", async () => {
    const { requestTimeoutMs } = await import("./claude-client");
    expect(requestTimeoutMs("glm-4.7-flash", 1000)).toBe(30_000);
    expect(requestTimeoutMs("glm-4-flash-250414", 4096)).toBeGreaterThan(100_000);
    expect(requestTimeoutMs("glm-4-air-250414", 16000)).toBe(140_000);
  });
});
