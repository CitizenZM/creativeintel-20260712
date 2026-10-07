import { describe, expect, it } from "vitest";
import { personaById } from "@/services/creative/personas";
import { estimateWordTimings, hasQuotedLine, parseSilences, speechSec, speechSpan, talkClipSec, talkKeyframePrompt, talkVideoPrompt } from "./talk-frame";

const mom = personaById("reels-kitchen-mom")!;

describe("talk-frame prompts", () => {
  const line = "Okay, this {NXTPAPER 14|Next Paper fourteen} reads like actual paper.";
  const p = talkVideoPrompt({ line, persona: mom, delivery: "surprised, punchy", frameSec: 3.5, product: "NXTPAPER 14", holdsProduct: true });

  it("carries the spoken line in quotes (spoken form) for Veo's native dialogue", () => {
    expect(p).toContain('"Okay, this Next Paper fourteen reads like actual paper."');
    expect(hasQuotedLine(p, line)).toBe(true);
    expect(hasQuotedLine("Slow push-in.", line)).toBe(false);
  });

  it("describes the persona, a selfie / handheld framing and lip-sync, with the persona's Veo voice", () => {
    expect(p).toMatch(/selfie/i);
    expect(p).toMatch(/handheld|arm's length/i);
    expect(p).toMatch(/lip[- ]sync/i);
    expect(p).toContain(mom.voice.veo);
    expect(p).toContain("kitchen");
    expect(p).toMatch(/surprised, punchy/);
    expect(p).toMatch(/no music/i);
    expect(p).toMatch(/holding the NXTPAPER 14/);
    // The line must land inside the visible frame.
    expect(p).toMatch(/within the first 3\.5 s/);
  });

  it("keyframe: the presenter from the casting reference (image 1), mid-sentence, selfie framing, no text", () => {
    const k = talkKeyframePrompt({ persona: mom, product: "NXTPAPER 14", holdsProduct: true });
    expect(k).toMatch(/person from image 1/);
    expect(k).toMatch(/NXTPAPER 14 from image 2/);
    expect(k).toMatch(/selfie/i);
    expect(k).toMatch(/mid-sentence|mouth slightly open/);
    expect(k).toMatch(/no on-screen text/i);
    expect(talkKeyframePrompt({ persona: mom })).not.toMatch(/image 2/);
  });

  it("sizes the clip to the frame and the line on Veo's 4/6/8 s durations", () => {
    expect(speechSec("Short one.")).toBeLessThan(2);
    expect(speechSec("This is a much longer line that a presenter has to say to the camera without rushing it at all.")).toBeGreaterThan(6);
    expect(talkClipSec(3, "Short one.")).toBe(4);
    expect(talkClipSec(5, "Short one.")).toBe(6);
    expect(talkClipSec(2, "This is a longer line that runs past four seconds of speech, easily.")).toBe(6);
    expect(talkClipSec(12, "x")).toBe(8);
  });
});

describe("talk captions timing", () => {
  it("spreads the shown words over the speech span by length, in order, inside the span", () => {
    const w = estimateWordTimings("Okay, this {NXTPAPER 14|Next Paper fourteen} is unreal.", { startSec: 0.4, endSec: 3.2 });
    expect(w.map((x) => x.text)).toEqual(["Okay,", "this", "NXTPAPER", "14", "is", "unreal."]);
    expect(w[0].startSec).toBeCloseTo(0.4, 5);
    const last = w[w.length - 1];
    expect(last.startSec + last.durSec).toBeCloseTo(3.2, 5);
    for (let i = 1; i < w.length; i++) expect(w[i].startSec).toBeGreaterThanOrEqual(w[i - 1].startSec + w[i - 1].durSec - 1e-9);
    // Longer words take longer.
    expect(w.find((x) => x.text === "NXTPAPER")!.durSec).toBeGreaterThan(w.find((x) => x.text === "is")!.durSec);
  });

  it("reads speech onset/offset from ffmpeg silencedetect inside the frame's window", () => {
    const stderr = [
      "[silencedetect @ 0x1] silence_start: 0",
      "[silencedetect @ 0x1] silence_end: 0.42 | silence_duration: 0.42",
      "[silencedetect @ 0x1] silence_start: 3.05",
      "[silencedetect @ 0x1] silence_end: 4 | silence_duration: 0.95",
    ].join("\n");
    const s = parseSilences(stderr);
    expect(s).toEqual([{ start: 0, end: 0.42 }, { start: 3.05, end: 4 }]);
    expect(speechSpan(s, 4)).toEqual({ startSec: 0.42, endSec: 3.05 });
    // Silence that never ends runs to the window end; all-silence → null (estimate instead).
    expect(speechSpan(parseSilences("silence_start: 2.5"), 4)).toEqual({ startSec: 0, endSec: 2.5 });
    expect(speechSpan([{ start: 0, end: 4 }], 4)).toBeNull();
    expect(speechSpan([], 4)).toEqual({ startSec: 0, endSec: 4 });
  });
});
