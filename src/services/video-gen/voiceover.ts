/**
 * Voiceover and subtitles for server-assembled masters.
 *
 * The storyboard gives every 2 s frame a voiceover line; consecutive frames
 * repeat the line of their beat. Each beat is spoken once with Microsoft Edge's
 * neural TTS (free, no key — msedge-tts), placed at the beat's start, sped up a
 * little if it would run into the next beat, and mixed into one track. The same
 * word timings give the subtitles, so they match the voice exactly.
 */
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

export const DEFAULT_VOICE = "en-US-AndrewMultilingualNeural";
const MAX_TEMPO = 1.3;
const GAP_SEC = 0.12;

export interface VoFrame {
  startSec: number;
  endSec: number;
  voiceover?: string | null;
}

export interface VoLine {
  text: string;
  startSec: number;
  endSec: number;
}

export interface Word {
  text: string;
  startSec: number;
  durSec: number;
}

export interface Placement {
  startSec: number;
  tempo: number;
}

export interface SubtitleCue {
  startSec: number;
  endSec: number;
  text: string;
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/** One line per beat: consecutive frames that repeat the same voiceover. */
export function planVoiceover(frames: VoFrame[]): VoLine[] {
  const lines: VoLine[] = [];
  for (const f of frames) {
    const text = norm(f.voiceover ?? "");
    if (!text) continue;
    const last = lines[lines.length - 1];
    if (last && last.text === text && Math.abs(last.endSec - f.startSec) < 0.01) last.endSec = f.endSec;
    else lines.push({ text, startSec: f.startSec, endSec: f.endSec });
  }
  return lines;
}

/**
 * Where each line starts and how much it is sped up. A line starts on its beat
 * (or just after the previous line ends) and must finish before the next line's
 * beat or the video's end; past MAX_TEMPO it is allowed to run over.
 */
export function placeLines(lines: VoLine[], durations: number[], totalSec: number): Placement[] {
  const out: Placement[] = [];
  let prevEnd = 0;
  lines.forEach((line, i) => {
    const start = Math.max(line.startSec, i ? prevEnd + GAP_SEC : line.startSec);
    const limit = (i + 1 < lines.length ? lines[i + 1].startSec : totalSec) - start;
    const tempo = limit > 0 ? Math.min(MAX_TEMPO, Math.max(1, durations[i] / limit)) : MAX_TEMPO;
    out.push({ startSec: start, tempo });
    prevEnd = start + durations[i] / tempo;
  });
  return out;
}

const alnum = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/**
 * Subtitles show the script's own words. Edge TTS word boundaries drop
 * punctuation ("receipts" for "receipts?") and split numbers and abbreviations
 * ("2,100+" → "2" + "100", "BT.2020" → "BT" + "2020"), so walk the script's
 * tokens and give each the timing of the TTS words it covers.
 */
export function alignToSource(words: Word[], lineText: string): Word[] {
  const tokens = lineText.split(/\s+/).filter(Boolean);
  const out: Word[] = [];
  let w = 0;
  for (const token of tokens) {
    const want = alnum(token);
    if (!want) {
      // Pure punctuation ("—"): ride on the previous word.
      if (out.length) out[out.length - 1] = { ...out[out.length - 1], text: `${out[out.length - 1].text} ${token}` };
      continue;
    }
    const first = w < words.length ? words[w] : null;
    let got = "";
    let last = first;
    while (w < words.length && got.length < want.length) {
      const next = alnum(words[w].text);
      if (got && !want.startsWith(got + next)) break;
      got += next;
      last = words[w];
      w++;
    }
    const prev = out[out.length - 1];
    const startSec = first ? first.startSec : prev ? prev.startSec + prev.durSec : 0;
    const endSec = last ? last.startSec + last.durSec : startSec + 0.3;
    out.push({ text: token, startSec, durSec: Math.max(0.05, endSec - startSec) });
  }
  return out;
}

/** Subtitle cues of a few words each, breaking at punctuation, timed from the TTS word boundaries. */
export function subtitleCues(words: Word[], placement: Placement, maxChars = 32, lineText?: string): SubtitleCue[] {
  const at = (t: number) => placement.startSec + t / placement.tempo;
  const src = lineText ? alignToSource(words, lineText) : words;
  const groups: Word[][] = [];
  let cur: Word[] = [];
  for (const w of src) {
    const next = joinWords([...cur, w].map((x) => x.text));
    // A cue may run a little long to end on its sentence's punctuation.
    const endsSentence = /[.!?;:,]$/.test(w.text) && next.length <= maxChars + 8;
    if (cur.length && next.length > maxChars && !endsSentence) {
      groups.push(cur);
      cur = [];
    }
    cur.push(w);
    if (/[.!?;:,]$/.test(w.text) && joinWords(cur.map((x) => x.text)).length > 12) {
      groups.push(cur);
      cur = [];
    }
  }
  if (cur.length) groups.push(cur);
  // Don't leave one word hanging on its own when it fits with the cue before.
  for (let i = groups.length - 1; i > 0; i--) {
    const merged = joinWords([...groups[i - 1], ...groups[i]].map((x) => x.text));
    if (groups[i].length === 1 && merged.length <= maxChars + 12) {
      groups[i - 1] = [...groups[i - 1], ...groups[i]];
      groups.splice(i, 1);
    }
  }
  const cues: SubtitleCue[] = groups.map((g) => {
    const last = g[g.length - 1];
    return { startSec: at(g[0].startSec), endSec: at(last.startSec + last.durSec), text: joinWords(g.map((w) => w.text)) };
  });
  // Hold each cue until the next one starts (short gaps flicker).
  for (let i = 0; i < cues.length - 1; i++) {
    if (cues[i + 1].startSec - cues[i].endSec < 0.6) cues[i].endSec = cues[i + 1].startSec;
  }
  return cues;
}

/** Edge TTS reports punctuation as separate "words"; glue it back on. */
function joinWords(tokens: string[]): string {
  return tokens.join(" ").replace(/\s+([.,!?;:%)])/g, "$1").replace(/([($])\s+/g, "$1");
}

function srtTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`;
}

export function toSrt(cues: SubtitleCue[]): string {
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.startSec)} --> ${srtTime(c.endSec)}\n${c.text}\n`).join("\n");
}

/** Speak one line with Edge TTS; returns the mp3 and its word timings. Retries transient failures. */
export async function synthesize(text: string, voice = DEFAULT_VOICE): Promise<{ audio: Buffer; words: Word[] }> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const tts = new MsEdgeTTS();
    try {
      await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, { wordBoundaryEnabled: true });
      const { audioStream, metadataStream } = tts.toStream(text);
      const chunks: Buffer[] = [];
      const words: Word[] = [];
      metadataStream?.on("data", (d: Buffer) => {
        try {
          const j = JSON.parse(d.toString()) as { Metadata?: { Type: string; Data: { text: { Text: string }; Offset: number; Duration: number } }[] };
          for (const m of j.Metadata ?? []) {
            if (m.Type === "WordBoundary") words.push({ text: m.Data.text.Text, startSec: m.Data.Offset / 1e7, durSec: m.Data.Duration / 1e7 });
          }
        } catch {
          // metadata frames that aren't JSON carry nothing we need
        }
      });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Edge TTS timed out")), 30_000);
        audioStream.on("data", (c: Buffer) => chunks.push(c));
        audioStream.on("end", () => (clearTimeout(timer), resolve()));
        audioStream.on("close", () => (clearTimeout(timer), resolve()));
        audioStream.on("error", (e: Error) => (clearTimeout(timer), reject(e)));
      });
      const audio = Buffer.concat(chunks);
      if (audio.length < 1000) throw new Error("Edge TTS returned no audio");
      return { audio, words };
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    } finally {
      try {
        tts.close();
      } catch {
        // already closed
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Edge TTS failed");
}

export interface TimedWord {
  text: string;
  startSec: number;
  endSec: number;
}

/** Each script word on the master's timeline (placement start + tempo applied). */
export function timedWords(words: Word[], placement: Placement, lineText?: string): TimedWord[] {
  const src = lineText ? alignToSource(words, lineText) : words;
  return src.map((w) => ({
    text: w.text,
    startSec: placement.startSec + w.startSec / placement.tempo,
    endSec: placement.startSec + (w.startSec + w.durSec) / placement.tempo,
  }));
}

/**
 * Word-by-word caption groups: up to `maxWords` words / `maxChars` characters,
 * breaking after punctuation, so the viewer reads one short phrase at a time
 * with the spoken word highlighted.
 */
export function kineticGroups(words: TimedWord[], maxWords = 3, maxChars = 18): TimedWord[][] {
  const groups: TimedWord[][] = [];
  let cur: TimedWord[] = [];
  for (const w of words) {
    const len = [...cur, w].map((x) => x.text).join(" ").length;
    if (cur.length && (cur.length >= maxWords || len > maxChars)) {
      groups.push(cur);
      cur = [];
    }
    cur.push(w);
    if (/[.!?;:,]$/.test(w.text)) {
      groups.push(cur);
      cur = [];
    }
  }
  if (cur.length) groups.push(cur);
  return groups;
}
