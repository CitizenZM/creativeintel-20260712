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
  it("breaks a near-tie on attention: a 2 s hook beats a 6 s hook", () => {
    const base = { totalDurationSec: 20, cta: { text: "Shop now", durationSec: 4 } };
    const best = pickBestScript([
      { ...base, title: "Slow open", predictedScore: 82, hook: { text: "Let me tell you about our TV", durationSec: 6 }, bodyBeats: [{ startSec: 6, endSec: 16, voiceover: "It is great." }] },
      { ...base, title: "Fast open", predictedScore: 80, hook: { text: "Too dark in daylight?", durationSec: 2 }, bodyBeats: [{ startSec: 2, endSec: 8, voiceover: "3,000 nits fixes that." }, { startSec: 8, endSec: 16, voiceover: "Rated 4.7 stars." }] },
    ]);
    expect(best.title).toBe("Fast open");
  });
});
