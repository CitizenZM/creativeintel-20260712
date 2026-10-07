/**
 * Native-audio routing for talking-head frames (locked `talk`, talk-frame.ts). A talk clip carries its
 * own lip-synced dialogue, so in the edit:
 *   - its shots keep the clip's audio, cut at exactly the source time the picture shows (lip sync)
 *   - the TTS voiceover skips that frame, and a TTS line stops before the next talk frame
 *   - the music ducks under it (it joins the voice bus that drives the sidechain)
 *   - captions come from the known line text, timed across the clip's measured speech span
 * Pure planning here; render-v2.ts does the ffmpeg work.
 */
import type { Shot } from "./edit-plan";
import { estimateWordTimings, speechSec } from "../talk-frame";
import type { TimedWord } from "../voiceover";

export interface NativeWindow {
  url: string;
  frameNumber: number;
  /** Source time at the window's first edit frame. */
  srcFrom: number;
  startSec: number;
  endSec: number;
}

/** One audio window per run of contiguous talk shots (same clip, source advancing with the edit). */
export function nativeAudioWindows(shots: Pick<Shot, "kind" | "url" | "srcFrom" | "startSec" | "endSec" | "frameNumber" | "nativeAudio" | "speed">[]): NativeWindow[] {
  const out: NativeWindow[] = [];
  for (const s of shots) {
    if (s.kind !== "clip" || !s.nativeAudio || (s.speed ?? 1) !== 1 || s.endSec - s.startSec <= 0) continue;
    const prev = out[out.length - 1];
    const contiguous = prev && prev.url === s.url && Math.abs(prev.endSec - s.startSec) < 0.02 && Math.abs(prev.srcFrom + (prev.endSec - prev.startSec) - s.srcFrom) < 0.05;
    if (contiguous) prev.endSec = s.endSec;
    else out.push({ url: s.url, frameNumber: s.frameNumber, srcFrom: s.srcFrom, startSec: s.startSec, endSec: s.endSec });
  }
  return out;
}

/** The frames the TTS voice speaks: a talk frame's line is the clip's own audio, never TTS. */
export function ttsFrames<T extends { nativeAudio?: boolean; voiceover?: string | null }>(frames: T[]): T[] {
  return frames.map((f) => (f.nativeAudio ? { ...f, voiceover: null } : f));
}

/** Where a TTS line must be done by: the start of every talk frame. */
export function talkStops(frames: { nativeAudio?: boolean; startSec: number }[]): number[] {
  return frames.filter((f) => f.nativeAudio).map((f) => f.startSec).sort((a, b) => a - b);
}

/**
 * Speech span (relative to the visible clip start) when it couldn't be measured: a breath in, then the
 * line at natural pace, stretched toward the clip's end (Veo tends to fill the clip) but never past it.
 */
export function defaultSpeechSpan(line: string, visibleSec: number): { startSec: number; endSec: number } {
  const lead = Math.min(0.35, visibleSec * 0.1);
  const avail = Math.max(0.3, visibleSec - lead - 0.25);
  const natural = speechSec(line) - 0.65;
  return { startSec: lead, endSec: lead + Math.min(avail, Math.max(natural, 0.75 * avail)) };
}

/**
 * Caption words of the talk frames in edit time. `spans` holds each frame's measured speech span
 * (silencedetect on the clip's audio, relative to the visible clip start); missing → estimated.
 */
export function talkCaptionWords(
  frames: { frameNumber: number; talkLine?: string | null }[],
  windows: NativeWindow[],
  spans: Map<number, { startSec: number; endSec: number } | null>
): TimedWord[] {
  const out: TimedWord[] = [];
  for (const f of frames) {
    const line = f.talkLine?.trim();
    const w = windows.filter((x) => x.frameNumber === f.frameNumber);
    if (!line || !w.length) continue;
    const first = w[0];
    const last = w[w.length - 1];
    const visible = last.endSec - first.startSec;
    const span = spans.get(f.frameNumber) ?? defaultSpeechSpan(line, visible);
    const s = { startSec: Math.max(0, span.startSec), endSec: Math.min(visible, span.endSec) };
    if (s.endSec - s.startSec < 0.2) continue;
    for (const wd of estimateWordTimings(line, s)) out.push({ text: wd.text, startSec: first.startSec + wd.startSec, endSec: first.startSec + wd.startSec + wd.durSec });
  }
  return out.sort((a, b) => a.startSec - b.startSec);
}

/**
 * The final mix's audio graph. Voice bus = TTS voiceover + the talk clips' native audio; the music bed
 * is sidechain-ducked under the whole bus, then voice + ducked music + SFX are loudness-normalised.
 */
export function audioMixGraph(i: {
  ttsIdx: number;
  nativeIdx: number;
  musicIdx: number;
  sfxIdx: number;
  totalSec: number;
  lufs?: number;
  /** Music bed level under the voice (before the duck); default 0.26. */
  musicGain?: number;
  /** Music bed level with no voice at all; default 0.6. */
  musicSoloGain?: number;
}): string[] {
  const end = `loudnorm=I=${(i.lufs ?? -14).toFixed(1)}:TP=-1.5:LRA=7,alimiter=limit=0.79:attack=2:release=40:level=disabled,atrim=0:${i.totalSec.toFixed(3)}[a]`;
  const voices = [i.ttsIdx, i.nativeIdx].filter((x) => x >= 0);
  if (!voices.length) return [`[${i.musicIdx}:a]volume=${+(i.musicSoloGain ?? 0.6).toFixed(3)}[mus]`, `[mus][${i.sfxIdx}:a]amix=inputs=2:normalize=0,${end}`];
  const bus =
    voices.length === 2
      ? [
          `[${i.ttsIdx}:a]aresample=44100,aformat=channel_layouts=stereo[vt]`,
          `[${i.nativeIdx}:a]aresample=44100,aformat=channel_layouts=stereo[vn]`,
          `[vt][vn]amix=inputs=2:normalize=0,asplit=2[vo][vosc]`,
        ]
      : [`[${voices[0]}:a]aresample=44100,asplit=2[vo][vosc]`];
  return [
    ...bus,
    `[${i.musicIdx}:a]volume=${+(i.musicGain ?? 0.26).toFixed(3)}[mus]`,
    `[mus][vosc]sidechaincompress=threshold=0.02:ratio=6:attack=15:release=350[duck]`,
    `[duck][vo][${i.sfxIdx}:a]amix=inputs=3:normalize=0,${end}`,
  ];
}
