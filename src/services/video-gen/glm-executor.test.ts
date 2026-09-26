import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
const zhipu = vi.hoisted(() => ({
  generateImagePersisted: vi.fn(),
  getVideoTask: vi.fn(),
  isZhipuConfigured: vi.fn(() => true),
  persistResult: vi.fn(),
  submitVideo: vi.fn(),
}));
vi.mock("@/services/ai/zhipu", () => zhipu);

import { glmAdapter } from "./glm-executor";

const ctx = { runId: "r1", nodeName: "V2", aspectRatio: "9:16", durationSec: 5 };

beforeEach(() => vi.clearAllMocks());

describe("glmAdapter", () => {
  it("keeps the GLM run identity and limits", () => {
    expect(glmAdapter.engine).toBe("glm");
    expect(glmAdapter.workerId).toBe("glm-server");
    expect(glmAdapter.maxVideosInFlight).toBe(2);
    expect(glmAdapter.imagesPerTick).toBe(3);
    expect(glmAdapter.notConfiguredError).toBe("ZHIPU_API_KEY is not configured");
    expect(glmAdapter.pollImage).toBeUndefined();
  });

  it("renders keyframes with CogView into the run's folder", async () => {
    zhipu.generateImagePersisted.mockResolvedValue("https://cdn/k.png");
    expect(await glmAdapter.generateImage("a bottle", { ...ctx, nodeName: "K2" })).toEqual({ url: "https://cdn/k.png" });
    expect(zhipu.generateImagePersisted).toHaveBeenCalledWith("a bottle", { aspectRatio: "9:16", folder: "glm-runs/r1" });
  });

  it("submits CogVideoX off the keyframe", async () => {
    zhipu.submitVideo.mockResolvedValue("task-9");
    expect(await glmAdapter.submitVideo({ prompt: "pour", imageUrl: "https://cdn/k.png" }, ctx)).toBe("task-9");
    expect(zhipu.submitVideo).toHaveBeenCalledWith({ prompt: "pour", imageUrl: "https://cdn/k.png", aspectRatio: "9:16" });
  });

  it("persists a finished clip and keeps the remote URL", async () => {
    zhipu.getVideoTask.mockResolvedValue({ id: "task-9", status: "SUCCESS", videoUrl: "https://zhipu/v.mp4" });
    zhipu.persistResult.mockResolvedValue("https://cdn/V2.mp4");
    expect(await glmAdapter.pollVideo("task-9", ctx)).toEqual({ status: "SUCCESS", url: "https://cdn/V2.mp4", remoteUrl: "https://zhipu/v.mp4" });
    expect(zhipu.persistResult).toHaveBeenCalledWith("https://zhipu/v.mp4", "glm-runs/r1", "V2.mp4");
  });

  it("reports FAIL and keeps waiting otherwise", async () => {
    zhipu.getVideoTask.mockResolvedValueOnce({ id: "t", status: "FAIL" });
    expect(await glmAdapter.pollVideo("t", ctx)).toEqual({ status: "FAIL", error: "CogVideoX-Flash reported FAIL" });
    zhipu.getVideoTask.mockResolvedValueOnce({ id: "t", status: "PROCESSING" });
    expect(await glmAdapter.pollVideo("t", ctx)).toEqual({ status: "PROCESSING" });
    // SUCCESS without a URL is not done yet.
    zhipu.getVideoTask.mockResolvedValueOnce({ id: "t", status: "SUCCESS" });
    expect(await glmAdapter.pollVideo("t", ctx)).toEqual({ status: "PROCESSING" });
  });
});
