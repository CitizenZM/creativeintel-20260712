import { describe, expect, it } from "vitest";
import { cleanFramePrompt, hasPeople, motionSafePrompt } from "./prompt-safety";

describe("cleanFramePrompt", () => {
  it("drops logo, overlay and text requests, hex colours and 'concept art'", () => {
    const out = cleanFramePrompt(
      "Broad view of a city alive with digital overlays illustrating progress, crisp daylight; a16z logo subtly integrated. Warm #FFD700 accents on a #000000 background. Cinematic storyboard concept art, youtube video ad, photorealistic."
    );
    expect(out).not.toMatch(/logo|overlay|#[0-9a-f]{6}|concept art|youtube/i);
    expect(out).toMatch(/city/);
    expect(out).toMatch(/golden|warm/i);
  });
  it("blurs screens so the model has no UI text to draw", () => {
    expect(cleanFramePrompt("Over-the-shoulder view of the Ramp app dashboard on a tablet")).toMatch(/abstract|blur/i);
  });
  it("leaves ordinary scenes alone apart from the style suffix", () => {
    expect(cleanFramePrompt("An emerald green duffle bag on a hotel bed.")).toMatch(/^An emerald green duffle bag on a hotel bed\./);
  });
});

describe("hasPeople", () => {
  it("spots people and faces", () => {
    expect(hasPeople("Mid-30s Caucasian male founder listens")).toBe(true);
    expect(hasPeople("A frustrated entrepreneur sweeps receipts")).toBe(true);
    expect(hasPeople("Close-up of discerning panel members nodding")).toBe(true);
    expect(hasPeople("A woman packs the weekender set")).toBe(true);
  });
  it("ignores product, hands-only and scenery shots", () => {
    expect(hasPeople("Macro shot of the faux crocodile texture")).toBe(false);
    expect(hasPeople("Hands place the card on a sensor")).toBe(false);
    expect(hasPeople("Dynamic cityscape pans quickly")).toBe(false);
  });
});

describe("motionSafePrompt", () => {
  it("asks for steady, slow motion", () => {
    expect(motionSafePrompt("The bag opens")).toMatch(/steady|slow/i);
  });
});
