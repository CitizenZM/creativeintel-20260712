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
import { buildVoiceSsml, escapeXml, type SsmlMode, type VoiceDelivery, type VoiceEnergy, type VoiceStyle } from "./voice-styles";

export { escapeXml };

export const DEFAULT_VOICE = "en-US-AndrewMultilingualNeural";
const MAX_TEMPO = 1.3;
const GAP_SEC = 0.12;

export interface VoFrame {
  startSec: number;
  endSec: number;
  voiceover?: string | null;
  /** Delivery of this beat (voice-styles.ts): style from the beat purpose, energy from the platform. */
  voiceStyle?: VoiceStyle | null;
  voiceEnergy?: VoiceEnergy | null;
}

export interface VoLine {
  text: string;
  startSec: number;
  endSec: number;
  style?: VoiceStyle;
  energy?: VoiceEnergy;
}

export interface Word {
  text: string;
  startSec: number;
  durSec: number;
}

/**
 * How long a TTS line actually speaks: the end of its last word plus a short release, not the mp3's
 * length (Edge TTS pads ~0.5–1 s of trailing silence, which made every line get sped up to fit).
 */
export function spokenDuration(words: Word[], fileSec: number, releaseSec = 0.12): number {
  const end = words.reduce((m, w) => Math.max(m, w.startSec + w.durSec), 0);
  if (!(end > 0)) return fileSec;
  return fileSec > 0 ? Math.min(fileSec, end + releaseSec) : end + releaseSec;
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

/**
 * Caption spellings in a voiceover line: `{NXTPAPER 14|Next Paper Fourteen}` is
 * spoken as "Next Paper Fourteen" and captioned as "NXTPAPER 14" (brand names,
 * numbers, units the voice must say in words).
 */
const SPELLING = /\{([^{}|]+)\|([^{}]+)\}/g;
export const spokenForm = (text: string) => text.replace(SPELLING, "$2");
export const shownForm = (text: string) => text.replace(SPELLING, "$1");
export function spellingsIn(text: string): { spoken: string; shown: string }[] {
  return [...text.matchAll(SPELLING)].map((m) => ({ shown: m[1].trim(), spoken: m[2].trim() }));
}
const bare = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** Replace each spoken phrase's words with its caption spelling, spreading the phrase's time over the new words. */
export function respell(words: Word[], spellings: { spoken: string; shown: string }[]): Word[] {
  let out = words;
  for (const sp of spellings) {
    // The phrase is matched on its letters, so a TTS that splits it differently (ja/zh) still hits.
    const said = bare(sp.spoken);
    const shown = sp.shown.split(/\s+/).filter(Boolean);
    if (!said || !shown.length) continue;
    const next: Word[] = [];
    for (let i = 0; i < out.length; ) {
      let acc = "";
      let n = 0;
      while (bare(out[i].text) && i + n < out.length && acc.length < said.length && said.startsWith(acc + bare(out[i + n].text))) acc += bare(out[i + n++].text);
      if (acc !== said) {
        next.push(out[i++]);
        continue;
      }
      const first = out[i];
      const last = out[i + n - 1];
      const tail = last.text.match(/[^\p{L}\p{N}]+$/u)?.[0] ?? "";
      const span = last.startSec + last.durSec - first.startSec;
      shown.forEach((t, k) =>
        next.push({ text: k === shown.length - 1 ? t + tail : t, startSec: first.startSec + (span * k) / shown.length, durSec: span / shown.length })
      );
      i += n;
    }
    out = next;
  }
  return out;
}

/** The caption words of a spoken line: aligned to the spoken source text, then respelled. */
function captionWords(words: Word[], lineText?: string): Word[] {
  return lineText ? respell(alignToSource(words, spokenForm(lineText)), spellingsIn(lineText)) : words;
}

/** One line per beat: consecutive frames that repeat the same voiceover. */
export function planVoiceover(frames: VoFrame[]): VoLine[] {
  const lines: VoLine[] = [];
  for (const f of frames) {
    const text = norm(f.voiceover ?? "");
    if (!text) continue;
    const last = lines[lines.length - 1];
    if (last && last.text === text && Math.abs(last.endSec - f.startSec) < 0.01) last.endSec = f.endSec;
    else lines.push({ text, startSec: f.startSec, endSec: f.endSec, ...(f.voiceStyle ? { style: f.voiceStyle } : {}), ...(f.voiceEnergy != null ? { energy: f.voiceEnergy } : {}) });
  }
  return lines;
}

/**
 * Where each line starts and how much it is sped up. A line starts on its beat
 * (or just after the previous line ends) and must finish before the next line's
 * beat or the video's end; past MAX_TEMPO it is allowed to run over. `stops` are further hard
 * limits (a talking-head frame's own voice starts there — edit/native-audio.ts).
 */
export function placeLines(lines: VoLine[], durations: number[], totalSec: number, stops: number[] = []): Placement[] {
  const out: Placement[] = [];
  let prevEnd = 0;
  lines.forEach((line, i) => {
    const start = Math.max(line.startSec, i ? prevEnd + GAP_SEC : line.startSec);
    const stop = stops.find((x) => x > start + 1e-6) ?? Infinity;
    const limit = Math.min(i + 1 < lines.length ? lines[i + 1].startSec : totalSec, stop) - start;
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
  if (UNSPACED.test(lineText)) return alignUnspaced(words, lineText);
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

/** Scripts written without spaces between words (Japanese, Chinese). */
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const CJK_EDGE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u3000-\u303F\uFF00-\uFFEF・ー]/u;

/** The separator between two caption tokens: none when either side is CJK, else a space. */
export function sepBetween(a: string, b: string): string {
  return CJK_EDGE.test(a.slice(-1)) || CJK_EDGE.test(b.slice(0, 1)) ? "" : " ";
}

/** Join caption tokens: spaces between words, none inside Japanese / Chinese. */
export function joinTokens(tokens: string[]): string {
  return tokens.reduce((out, t, i) => (i ? out + sepBetween(tokens[i - 1], t) + t : t), "");
}

/**
 * A line without spaces: each TTS word becomes one caption token cut from the source text (so the
 * script's own characters and punctuation show). Source characters the voice skipped ride on the
 * previous token; a word that can't be found keeps its TTS text.
 */
function alignUnspaced(words: Word[], lineText: string): Word[] {
  const chars = [...lineText];
  const key = (c: string) => alnum(c);
  const out: Word[] = [];
  let pos = 0;
  const matchAt = (s: number, want: string[]): number => {
    let i = s;
    let k = 0;
    while (i < chars.length && k < want.length) {
      const a = key(chars[i]);
      if (!a) {
        if (k === 0) return -1;
        i++;
        continue;
      }
      if (a !== want[k]) return -1;
      k++;
      i++;
    }
    return k === want.length ? i : -1;
  };
  for (const w of words) {
    const want = [...alnum(w.text)];
    if (!want.length) continue;
    let start = pos;
    while (start < chars.length && /\s/.test(chars[start])) start++;
    let found = -1;
    let at = start;
    for (let s = start; s < Math.min(chars.length, start + 12); s++) {
      if (!key(chars[s])) continue;
      found = matchAt(s, want);
      if (found >= 0) {
        at = s;
        break;
      }
    }
    if (found < 0) {
      out.push({ ...w });
      continue;
    }
    // Leading punctuation (「) joins this token; skipped letters join the previous one.
    let lead = start;
    while (lead < at && !key(chars[lead])) lead++;
    if (lead < at && out.length) out[out.length - 1] = { ...out[out.length - 1], text: out[out.length - 1].text + chars.slice(start, at).join("").trim() };
    const from = lead < at && out.length ? at : start;
    let end = found;
    while (end < chars.length && !key(chars[end]) && !/\s/.test(chars[end])) end++;
    const text = chars.slice(from, end).join("").trim();
    const prev = out[out.length - 1];
    // "NXT20" read as "NXT" + "20": Latin pieces with no space between them in the source stay one token.
    if (prev && from === pos && pos > 0 && /[A-Za-z0-9]$/.test(prev.text) && /^[A-Za-z0-9]/.test(text)) {
      out[out.length - 1] = { text: prev.text + text, startSec: prev.startSec, durSec: w.startSec + w.durSec - prev.startSec };
    } else out.push({ text, startSec: w.startSec, durSec: w.durSec });
    pos = end;
  }
  // Source text after the last spoken word (closing punctuation) rides on the last token.
  const rest = chars.slice(pos).join("").trim();
  if (rest && out.length && !/[\p{L}\p{N}]/u.test(rest)) out[out.length - 1] = { ...out[out.length - 1], text: out[out.length - 1].text + rest };
  return out;
}

/** Subtitle cues of a few words each, breaking at punctuation, timed from the TTS word boundaries. */
export function subtitleCues(words: Word[], placement: Placement, maxChars = 32, lineText?: string): SubtitleCue[] {
  const at = (t: number) => placement.startSec + t / placement.tempo;
  const src = captionWords(words, lineText);
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
  return joinTokens(tokens).replace(/\s+([.,!?;:%)])/g, "$1").replace(/([($])\s+/g, "$1");
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

const unescapeXml = (t: string) => t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** A style is spoken with the most expressive SSML that works; each failed attempt drops one level. */
const DOWNGRADE: Record<SsmlMode, SsmlMode> = { "express-as": "prosody", prosody: "plain", plain: "plain" };

/**
 * Speak one line with Edge TTS; returns the mp3 and its word timings. Retries transient failures.
 * With a delivery (style / energy) the line goes out as our own SSML (voice-styles.ts: prosody presets
 * on Edge); a styled request that returns no audio is retried plainer (express-as → prosody at once,
 * prosody → plain only on the last attempt).
 */
export async function synthesize(text: string, voice = DEFAULT_VOICE, delivery?: VoiceDelivery): Promise<{ audio: Buffer; words: Word[] }> {
  let lastErr: unknown;
  let force: SsmlMode | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    const tts = new MsEdgeTTS();
    const styled = delivery && (delivery.style || delivery.energy) ? buildVoiceSsml({ text, voice, ...delivery, force }) : null;
    try {
      await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, { wordBoundaryEnabled: true });
      // The text goes into SSML unescaped: a bare "&" ("Bang & Olufsen") makes the service return no audio.
      const { audioStream, metadataStream } = styled && styled.mode !== "plain" ? tts.rawToStream(styled.ssml) : tts.toStream(escapeXml(text));
      const chunks: Buffer[] = [];
      const words: Word[] = [];
      metadataStream?.on("data", (d: Buffer) => {
        try {
          const j = JSON.parse(d.toString()) as { Metadata?: { Type: string; Data: { text: { Text: string }; Offset: number; Duration: number } }[] };
          for (const m of j.Metadata ?? []) {
            if (m.Type === "WordBoundary") words.push({ text: unescapeXml(m.Data.text.Text), startSec: m.Data.Offset / 1e7, durSec: m.Data.Duration / 1e7 });
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
      // express-as is dropped at once (Edge rejects it); prosody is kept through one transient retry
      // (the endpoint resets connections now and then) and only the last attempt goes plain.
      if (styled) force = styled.mode === "express-as" ? DOWNGRADE["express-as"] : attempt >= 1 ? DOWNGRADE[styled.mode] : force;
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
  /** Which voiceover line the word belongs to (captions never merge across lines). */
  line?: number;
}

/** Each script word on the master's timeline (placement start + tempo applied). */
export function timedWords(words: Word[], placement: Placement, lineText?: string): TimedWord[] {
  const src = captionWords(words, lineText);
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
    // Break after punctuation, also when a closing quote follows it ("room?'").
    if (/[.!?;:,…、。！？；：，]['"’”)]*$/.test(w.text)) {
      groups.push(cur);
      cur = [];
    }
  }
  if (cur.length) groups.push(cur);
  return mergeFragments(groups);
}

/** A lone word closed by a comma or a period ("SUN.", "COMPLETELY,") — a question or exclamation is a deliberate punch. */
const isFragment = (g: TimedWord[]) => g.length === 1 && /[.,;:…、。，；：]['"’”)]*$/.test(g[0].text);
const sameLine = (a: TimedWord, b: TimedWord) => a.line === b.line;

/**
 * Never leave a one-word fragment alone unless its line is that one word: it joins the chunk
 * before it on the same line, or — when it opens its line — the chunk after it.
 */
function mergeFragments(groups: TimedWord[][]): TimedWord[][] {
  const out = groups.map((g) => [...g]);
  for (let i = 0; i < out.length; i++) {
    if (!isFragment(out[i])) continue;
    const w = out[i][0];
    const prev = out[i - 1];
    const next = out[i + 1];
    if (prev && sameLine(prev[prev.length - 1], w)) {
      prev.push(w);
      out.splice(i--, 1);
    } else if (next && sameLine(next[0], w)) {
      next.unshift(w);
      out.splice(i--, 1);
    }
  }
  return out;
}
