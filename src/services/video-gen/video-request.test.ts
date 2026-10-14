import { describe, expect, it } from "vitest";
import { videoRequestSchema } from "./video-request";

describe("paid video submission validation", () => {
  it("normalizes supported defaults", () => {
    expect(videoRequestSchema.parse({ prompt: "  Product reveal  " })).toMatchObject({ prompt: "Product reveal", aspectRatio: "9:16", duration: 5 });
  });

  it.each([
    { prompt: " " },
    { prompt: "x", duration: 300 },
    { prompt: "x", duration: "5" },
    { prompt: "x", shotIndex: -1 },
    { prompt: "x", aspectRatio: "4:3" },
    { prompt: "x", imageUrl: "http://example.com/a.png" },
    { prompt: "x", endImageUrl: "file:///private/a.png" },
  ])("rejects invalid paid input %#", (input) => {
    expect(videoRequestSchema.safeParse(input).success).toBe(false);
  });
});
