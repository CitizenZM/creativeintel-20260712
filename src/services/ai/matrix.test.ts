import { describe, expect, it } from "vitest";
import { matrixImageSize, parseSeedanceTask, seedanceBody } from "./matrix";

describe("seedanceBody", () => {
  it("sends the keyframe as the first frame, with ratio, duration and no watermark", () => {
    expect(
      seedanceBody({ model: "doubao/seedance-2.0-fast-720p", prompt: "slow push-in", imageUrl: "https://x/k.jpg", aspectRatio: "9:16", durationSec: 5 })
    ).toEqual({
      model: "doubao/seedance-2.0-fast-720p",
      content: [
        { type: "text", text: "slow push-in" },
        { type: "image_url", image_url: { url: "https://x/k.jpg" }, role: "first_frame" },
      ],
      ratio: "9:16",
      duration: 5,
      watermark: false,
    });
  });
});

describe("parseSeedanceTask", () => {
  it("maps Ark statuses", () => {
    expect(parseSeedanceTask({ status: "running" })).toEqual({ status: "PROCESSING" });
    expect(parseSeedanceTask({ status: "succeeded", content: { video_url: "https://v/c.mp4" } })).toEqual({ status: "SUCCESS", videoUrl: "https://v/c.mp4" });
    expect(parseSeedanceTask({ status: "failed", error: { message: "OutputVideoSensitiveContentDetected" } })).toEqual({
      status: "FAIL",
      error: "OutputVideoSensitiveContentDetected",
    });
    expect(parseSeedanceTask({ status: "succeeded" }).status).toBe("FAIL");
  });
});

describe("matrixImageSize", () => {
  it("uses Qwen-Image's native vertical size for 9:16", () => {
    expect(matrixImageSize("9:16")).toBe("928x1664");
    expect(matrixImageSize("16:9")).toBe("1664x928");
  });
});
