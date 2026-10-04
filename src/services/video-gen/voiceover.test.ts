import { describe, expect, it } from "vitest";
import { kineticGroups, placeLines, planVoiceover, respell, shownForm, spokenForm, subtitleCues, timedWords, toSrt } from "./voiceover";

describe("planVoiceover", () => {
  it("speaks each beat once, spanning the frames that repeat its line", () => {
    const lines = planVoiceover([
      { startSec: 0, endSec: 2, voiceover: "Tired of managing piles of receipts?" },
      { startSec: 2, endSec: 4, voiceover: "Tired of managing piles of receipts? " },
      { startSec: 4, endSec: 6, voiceover: "Meet Ramp." },
      { startSec: 6, endSec: 8, voiceover: "" },
      { startSec: 8, endSec: 10, voiceover: "Meet Ramp." },
    ]);
    expect(lines).toEqual([
      { text: "Tired of managing piles of receipts?", startSec: 0, endSec: 4 },
      { text: "Meet Ramp.", startSec: 4, endSec: 6 },
      { text: "Meet Ramp.", startSec: 8, endSec: 10 },
    ]);
  });
});

describe("placeLines", () => {
  it("starts lines on their beat and speeds up one that would overrun the next", () => {
    const lines = [
      { text: "a", startSec: 0, endSec: 4 },
      { text: "b", startSec: 4, endSec: 6 },
    ];
    const p = placeLines(lines, [5, 1.5], 10);
    expect(p[0]).toEqual({ startSec: 0, tempo: 1.25 });
    expect(p[1].startSec).toBeCloseTo(4.12);
    expect(p[1].tempo).toBe(1);
  });
  it("never speeds up past 1.3x", () => {
    expect(placeLines([{ text: "a", startSec: 0, endSec: 2 }], [8], 2)[0].tempo).toBe(1.3);
  });
});

describe("subtitleCues", () => {
  const words = ["Tired", "of", "managing", "piles", "of", "receipts", "?", "Meet", "Ramp", "."].map((text, i) => ({
    text,
    startSec: i * 0.4,
    durSec: 0.35,
  }));

  it("groups words into short cues, glues punctuation, and offsets by the placement", () => {
    const cues = subtitleCues(words, { startSec: 10, tempo: 1 });
    expect(cues.map((c) => c.text)).toEqual(["Tired of managing piles of", "receipts? Meet Ramp."]);
    expect(cues[0].startSec).toBeCloseTo(10);
    expect(cues[1].endSec).toBeCloseTo(10 + 9 * 0.4 + 0.35);
  });

  it("scales timings when the line is sped up", () => {
    expect(subtitleCues(words, { startSec: 0, tempo: 2 })[1].endSec).toBeCloseTo((9 * 0.4 + 0.35) / 2);
  });

  it("restores punctuation Edge TTS drops, and keeps no word on its own", () => {
    const bare = ["Tired", "of", "managing", "piles", "of", "receipts", "Meet", "Ramp"].map((text, i) => ({ text, startSec: i * 0.4, durSec: 0.35 }));
    const cues = subtitleCues(bare, { startSec: 0, tempo: 1 }, 32, "Tired of managing piles of receipts? Meet Ramp.");
    expect(cues.map((c) => c.text)).toEqual(["Tired of managing piles of receipts?", "Meet Ramp."]);
  });

  it("keeps numbers and abbreviations the TTS splits into several words", () => {
    // Edge TTS reports "2,100+" as "2" + "100" and "BT.2020" as "BT" + "2020".
    const tts = ["Over", "2", "100", "local", "dimming", "zones", "and", "BT", "2020", "colour"].map((text, i) => ({ text, startSec: i * 0.4, durSec: 0.35 }));
    const cues = subtitleCues(tts, { startSec: 0, tempo: 1 }, 40, "Over 2,100+ local dimming zones and BT.2020 colour.");
    expect(cues.map((c) => c.text).join(" ")).toBe("Over 2,100+ local dimming zones and BT.2020 colour.");
    expect(cues[0].startSec).toBeCloseTo(0);
    expect(cues.at(-1)!.endSec).toBeCloseTo(9 * 0.4 + 0.35);
  });

  it("writes SRT", () => {
    expect(toSrt([{ startSec: 1.5, endSec: 3.25, text: "Meet Ramp." }])).toBe("1\n00:00:01,500 --> 00:00:03,250\nMeet Ramp.\n");
  });
});

describe("kineticGroups", () => {
  const w = (texts: string[]) => texts.map((text, i) => ({ text, startSec: i * 0.3, endSec: i * 0.3 + 0.25 }));
  it("shows up to three short words at a time and breaks after punctuation, even inside quotes", () => {
    const g = kineticGroups(w(["Is", "this", "too", "bright", "for", "my", "room?'", "That's", "a", "common", "concern."]));
    expect(g.map((x) => x.map((y) => y.text).join(" "))).toEqual(["Is this too", "bright for my", "room?'", "That's a common", "concern."]);
  });
});

describe("caption spellings", () => {
  const line = "Unwrap {NXTPAPER 14|Next Paper Fourteen} — no glare.";
  const words = ["Unwrap", "Next", "Paper", "Fourteen", "no", "glare."].map((text, i) => ({ text, startSec: i * 0.4, durSec: 0.35 }));

  it("speaks the spoken form and shows the caption form", () => {
    expect(spokenForm(line)).toBe("Unwrap Next Paper Fourteen — no glare.");
    expect(shownForm(line)).toBe("Unwrap NXTPAPER 14 — no glare.");
  });

  it("respells the spoken words in captions, keeping the phrase's time span", () => {
    const out = respell(words, [{ spoken: "Next Paper Fourteen", shown: "NXTPAPER 14" }]);
    expect(out.map((w) => w.text)).toEqual(["Unwrap", "NXTPAPER", "14", "no", "glare."]);
    expect(out[1].startSec).toBeCloseTo(0.4);
    expect(out[2].startSec + out[2].durSec).toBeCloseTo(1.55);
  });

  it("captions and subtitles of a marked-up line use the caption spelling", () => {
    const timed = timedWords(words, { startSec: 1, tempo: 1 }, line);
    expect(timed.map((w) => w.text).join(" ")).toContain("NXTPAPER 14");
    expect(subtitleCues(words, { startSec: 1, tempo: 1 }, 32, line).map((c) => c.text).join(" ")).toContain("NXTPAPER 14");
  });
});
