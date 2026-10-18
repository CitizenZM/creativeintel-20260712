import { describe, expect, it, vi } from "vitest";

const generateImageByEngine = vi.hoisted(() => vi.fn(async () => "https://cdn.example/keyframe.jpg"));
vi.mock("@/services/ai/image-engine", () => ({ generateImageByEngine }));
vi.mock("./bach", () => ({ bachConfigured: () => true, pollBachVideo: vi.fn(), submitBachVideo: vi.fn() }));

import { bachAdapter } from "./bach-executor";

describe("Bach keyframe references", () => {
  it("passes source product photos to the image engine", async () => {
    await bachAdapter.generateImage("official product packshot on a table", {
      runId: "run1", nodeName: "K1", aspectRatio: "9:16", durationSec: 5,
      projectId: "project1", settings: {}, creditsEstimated: 0,
      referenceUrls: ["https://cdn.example/product-front.png", "https://cdn.example/product-back.png"],
    });
    expect(generateImageByEngine).toHaveBeenCalledWith(expect.objectContaining({
      referenceImageUrls: ["https://cdn.example/product-front.png", "https://cdn.example/product-back.png"],
    }));
  });
});
