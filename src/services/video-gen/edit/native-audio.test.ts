import { describe, expect, it } from "vitest";
import { planEdit, type PlanInputSegment } from "./edit-plan";
import { audioMixGraph, defaultSpeechSpan, nativeAudioWindows, talkCaptionWords, talkStops, ttsFrames } from "./native-audio";
import { placeLines, planVoiceover } from "../voiceover";
import { planSegments } from "../glm-assemble";

const seg = (n: number, length: number, segment: string, extra: Partial<PlanInputSegment> = {}): PlanInputSegment => ({ kind: "clip", url: `https://x/v${n}.mp4`, from: 0, length, frameNumber: n, segment, ...extra });

describe("audio routing in the edit plan", () => {
  const input = [seg(1, 3, "HOOK", { nativeAudio: true }), seg(2, 2, "BODY"), seg(3, 4, "BODY", { nativeAudio: true }), { ...seg(4, 2, "CTA"), kind: "still" as const }];
  const plan = planEdit(input, {});

  it("marks every shot cut from a talk clip as native audio (punch-ins included), nothing else", () => {
    const talk = plan.shots.filter((s) => s.nativeAudio);
    expect(talk.length).toBeGreaterThanOrEqual(2);
    expect(new Set(talk.map((s) => s.frameNumber))).toEqual(new Set([1, 3]));
    expect(plan.shots.filter((s) => s.frameNumber === 2 || s.frameNumber === 4).every((s) => !s.nativeAudio)).toBe(true);
    expect(talk.every((s) => (s.speed ?? 1) === 1)).toBe(true);
  });

  it("merges the frame's contiguous shots into one audio window per talk frame, in edit time", () => {
    const w = nativeAudioWindows(plan.shots);
    expect(w.map((x) => x.frameNumber)).toEqual([1, 3]);
    const f1 = plan.shots.filter((s) => s.frameNumber === 1);
    expect(w[0]).toMatchObject({ url: "https://x/v1.mp4", srcFrom: f1[0].srcFrom, startSec: f1[0].startSec, endSec: f1[f1.length - 1].endSec });
    // The audio plays exactly the source time the picture shows (lip sync): source advances with the edit.
    expect(w[1].srcFrom).toBeCloseTo(plan.shots.find((s) => s.frameNumber === 3)!.srcFrom, 5);
    expect(w[1].endSec - w[1].startSec).toBeCloseTo(4, 1);
  });

  it("a hook variant that swaps the opener for a product still drops that shot's native audio", () => {
    const p = planEdit(input, { hookStyle: "p" });
    expect(p.shots[0].kind).toBe("still");
    expect(p.shots[0].nativeAudio).toBeFalsy();
  });

  it("skips TTS for talk frames: their line is not spoken by the TTS voice, other lines are", () => {
    const frames = [
      { frameNumber: 1, startSec: 0, endSec: 3, voiceover: "Okay wait, look at this.", nativeAudio: true },
      { frameNumber: 2, startSec: 3, endSec: 5, voiceover: "A matte screen that reads like paper." },
      { frameNumber: 3, startSec: 5, endSec: 9, voiceover: "Twenty percent off, go.", nativeAudio: true },
    ];
    const lines = planVoiceover(ttsFrames(frames));
    expect(lines.map((l) => l.text)).toEqual(["A matte screen that reads like paper."]);
    // A TTS line must stop before the next talk frame starts (no two voices at once).
    expect(talkStops(frames)).toEqual([0, 5]);
    const [p] = placeLines(lines, [2.6], 9, talkStops(frames));
    expect(p.tempo).toBeCloseTo(1.3, 5); // 2.6 s of speech into the 2 s before the talk frame
    expect(placeLines(lines, [2.6], 9)[0].tempo).toBe(1); // without the stop it would run into the presenter
  });

  it("captions a talk frame from its known line, timed across the clip's speech span in edit time", () => {
    const w = nativeAudioWindows(plan.shots);
    const words = talkCaptionWords([{ frameNumber: 3, talkLine: "Twenty percent off, go." }], w, new Map([[3, { startSec: 0.5, endSec: 2.5 }]]));
    expect(words.map((x) => x.text)).toEqual(["Twenty", "percent", "off,", "go."]);
    expect(words[0].startSec).toBeCloseTo(w[1].startSec + 0.5, 5);
    expect(words[words.length - 1].endSec).toBeCloseTo(w[1].startSec + 2.5, 5);
    // Unmeasured: a natural-pace estimate inside the visible clip.
    const est = talkCaptionWords([{ frameNumber: 1, talkLine: "Okay wait, look at this." }], w, new Map());
    expect(est[0].startSec).toBeGreaterThanOrEqual(w[0].startSec);
    expect(est[est.length - 1].endSec).toBeLessThanOrEqual(w[0].endSec);
    expect(defaultSpeechSpan("Hi there.", 4).endSec).toBeLessThan(4);
  });

  it("mixes the native audio into the voice bus the music ducks under; TTS alone and silence keep their graphs", () => {
    const both = audioMixGraph({ ttsIdx: 1, nativeIdx: 2, musicIdx: 3, sfxIdx: 4, totalSec: 9 }).join(";");
    expect(both).toContain("[1:a]");
    expect(both).toContain("[2:a]");
    expect(both).toMatch(/amix=inputs=2:normalize=0[^;]*asplit=2\[vo\]\[vosc\]/);
    expect(both).toMatch(/\[3:a\]volume=0\.26\[mus\];\[mus\]\[vosc\]sidechaincompress/);
    const nativeOnly = audioMixGraph({ ttsIdx: -1, nativeIdx: 1, musicIdx: 2, sfxIdx: 3, totalSec: 9 }).join(";");
    expect(nativeOnly).toMatch(/^\[1:a\]aresample=44100[^;]*asplit=2\[vo\]\[vosc\]/);
    expect(nativeOnly).toContain("sidechaincompress");
    const ttsOnly = audioMixGraph({ ttsIdx: 1, nativeIdx: -1, musicIdx: 2, sfxIdx: 3, totalSec: 9 }).join(";");
    expect(ttsOnly).not.toContain("amix=inputs=2:normalize=0,asplit");
    const none = audioMixGraph({ ttsIdx: -1, nativeIdx: -1, musicIdx: 1, sfxIdx: 2, totalSec: 9 }).join(";");
    expect(none).not.toContain("sidechaincompress");
    expect(none).toContain("[1:a]volume=0.6[mus]");
  });
});

describe("talk frames on the timeline", () => {
  it("keeps a talk clip at natural speed and flags its segment native (the per-segment audio flag)", () => {
    const jobs = [
      { kind: "video", status: "completed", resultUrl: "https://x/v1.mp4", nodeName: "V1", settings: { coversFrames: [1], frameOffsetsSec: [{ frameNumber: 1, clipStartSec: 0, clipEndSec: 3 }], nativeAudio: 1, speed: 1 } },
      { kind: "video", status: "completed", resultUrl: "https://x/v2.mp4", nodeName: "V2", settings: { coversFrames: [2], frameOffsetsSec: [{ frameNumber: 2, clipStartSec: 0, clipEndSec: 3.7 }], anchorEnd: 1, speed: 1.057 } },
    ];
    const segs = planSegments(
      [
        { frameNumber: 1, startSec: 0, endSec: 3, nativeAudio: true, speed: 2 },
        { frameNumber: 2, startSec: 3, endSec: 6.5 },
      ],
      jobs as never
    );
    expect(segs[0]).toMatchObject({ kind: "clip", nativeAudio: true, speed: 1, length: 3 });
    expect(segs[1]).not.toHaveProperty("nativeAudio");
  });
});
