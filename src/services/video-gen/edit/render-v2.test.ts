import { describe, expect, it } from "vitest";
import { musicMood } from "./render-v2";

describe("musicMood", () => {
  it("picks the seasonal bed for holiday / gift copy", () => {
    expect(musicMood([{ text: "WANT A NEW YEAR GIFT?", voiceover: null }])).toBe("holiday");
    expect(musicMood([{ text: "4K at 144Hz", voiceover: "Silky motion for gaming" }])).toBe("pop");
  });
});
