import { describe, expect, it } from "vitest";
import { pickBestScript } from "./script-pick";

describe("pickBestScript", () => {
  it("prefers a compliant script over a higher-scoring flagged one", () => {
    const best = pickBestScript([
      { title: "⚠ Social proof", predictedScore: 85 },
      { title: "The card that works", predictedScore: 75 },
      { title: "⚠ Founder story", predictedScore: 78 },
    ]);
    expect(best.title).toBe("The card that works");
  });
  it("falls back to the best flagged script when none is compliant", () => {
    expect(pickBestScript([{ title: "⚠ A", predictedScore: 60 }, { title: "⚠ B", predictedScore: 70 }]).title).toBe("⚠ B");
  });
});
