/**
 * Talking-head ("AI presenter" / UGC) frames: a presenter persona says one line straight to a selfie
 * camera. The clip is generated on Veo with NATIVE audio — the spoken line goes in quotes in the
 * prompt, and Veo returns the voice lip-synced to the face — and the edit keeps that audio for the
 * frame (no TTS there; the music ducks under it; captions come from the known line text).
 *
 * The keyframe is edited from the run's CAST reference (built from the persona), so every talk frame
 * shows the same presenter. Pure — prompt text, durations and caption timing only.
 */
import type { Persona } from "@/services/creative/personas";
import { personaCast } from "@/services/creative/personas";
import { shownForm, spokenForm, type Word } from "./voiceover";

/** Veo renders 4 / 6 / 8 s clips. */
const VEO_DURATIONS = [4, 6, 8];
/** Natural conversational pace: ~2.7 words/s, plus a breath before and a beat after the line. */
const WORDS_PER_SEC = 2.7;
const LEAD_SEC = 0.35;
const TAIL_SEC = 0.3;

const wordsOf = (t: string) => spokenForm(t).replace(/\s+/g, " ").trim().split(" ").filter(Boolean);

/** How long the line takes to say on camera, lead-in and release included. */
export function speechSec(line: string): number {
  return Math.round((LEAD_SEC + wordsOf(line).length / WORDS_PER_SEC + TAIL_SEC) * 100) / 100;
}

/** Clip length for a talk frame: the shortest Veo duration that holds both the frame and the line. */
export function talkClipSec(frameSec: number, line: string): number {
  const need = Math.max(frameSec, speechSec(line));
  return VEO_DURATIONS.find((d) => d >= need - 1e-6) ?? VEO_DURATIONS[VEO_DURATIONS.length - 1];
}

/** The prompt already carries this line as quoted dialogue. */
export function hasQuotedLine(prompt: string, line: string): boolean {
  const said = spokenForm(line).replace(/\s+/g, " ").trim();
  return !!said && prompt.includes(`"${said}"`);
}

const pronoun = (p: Persona) => (p.look.gender === "woman" ? { they: "She", their: "her" } : { they: "He", their: "his" });

export interface TalkPromptInput {
  line: string;
  persona: Persona;
  /** How this beat is said ("surprised, punchy"); layered on the persona's energy. */
  delivery?: string;
  /** Visible length of the frame: the line must land inside it. */
  frameSec: number;
  product?: string;
  /** The presenter holds / shows the product while talking. */
  holdsProduct?: boolean;
}

/** The Veo motion prompt for a talk frame: persona, selfie framing, the quoted line, lip-sync and an audio brief. */
export function talkVideoPrompt(i: TalkPromptInput): string {
  const { they, their } = pronoun(i.persona);
  const said = spokenForm(i.line).replace(/\s+/g, " ").trim().replace(/"/g, "'");
  const holding = i.holdsProduct && i.product ? `, holding the ${i.product} up to the lens in ${their} other hand` : "";
  const within = Math.max(1, Math.round(i.frameSec * 10) / 10);
  return [
    `Vertical selfie video on a phone front camera held at arm's length, handheld with a slight natural sway, eye-level.`,
    `${personaCast(i.persona)} ${they} is in ${i.persona.setting}${holding}.`,
    `${they} looks straight into the lens and says, in ${i.persona.voice.veo}, ${[i.delivery, i.persona.energy].filter(Boolean).join("; ")}: "${said}"`,
    `Lip-sync: mouth shapes match every syllable of the line exactly; natural blinks, small head tilts and one casual hand gesture. The whole line is spoken within the first ${within} s, then ${they.toLowerCase()} gives a quick smile to camera.`,
    `Audio: only ${their} voice, close-miked like a phone, with quiet room tone — no music, no other voices, no sound effects.`,
  ].join(" ");
}

/** The talk keyframe: an edit of the casting reference (image 1), plus the product (image 2) when held. */
export function talkKeyframePrompt(i: { persona: Persona; product?: string; holdsProduct?: boolean; setting?: string }): string {
  const { their } = pronoun(i.persona);
  const holding = i.holdsProduct && i.product ? `, holding the ${i.product} from image 2 up near ${their} face, exactly as in the reference` : "";
  return [
    `Selfie-style vertical phone photo from the front camera at arm's length: the person from image 1 (${personaCast(i.persona)}) in ${i.setting?.trim() || i.persona.setting}${holding}.`,
    `Mid-sentence, mouth slightly open, looking straight into the lens, relaxed natural expression; eye-level, head and shoulders filling the upper two thirds of the frame.`,
    `Shot on a smartphone front camera: slight wide-angle perspective, everyday room light, natural skin texture with visible pores, real fabric creases. No on-screen text, no captions, no logos.`,
  ].join(" ");
}

/**
 * Caption timing for a line whose audio we don't have word boundaries for (the clip's native speech):
 * the shown words spread over the speech span, each word's share weighted by its length.
 */
export function estimateWordTimings(line: string, span: { startSec: number; endSec: number }): Word[] {
  const tokens = shownForm(line).replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!tokens.length) return [];
  // A word's weight: its letters plus a little for the syllable onset, and a pause after punctuation.
  const weight = tokens.map((t) => Math.max(2, t.replace(/[^\p{L}\p{N}]/gu, "").length) + 1.5 + (/[.,!?;:…]$/.test(t) ? 1.5 : 0));
  const total = weight.reduce((a, b) => a + b, 0);
  const len = Math.max(0.1, span.endSec - span.startSec);
  let t = span.startSec;
  return tokens.map((text, k) => {
    const durSec = (len * weight[k]) / total;
    const w = { text, startSec: t, durSec };
    t += durSec;
    return w;
  });
}

/** ffmpeg silencedetect output → silent intervals (an open interval ends at Infinity). */
export function parseSilences(stderr: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (const m of stderr.matchAll(/silence_(start|end):\s*(-?[\d.]+)/g)) {
    const v = Math.max(0, Number(m[2]));
    if (m[1] === "start") out.push({ start: v, end: Infinity });
    else if (out.length && out[out.length - 1].end === Infinity) out[out.length - 1].end = v;
    else out.push({ start: 0, end: v });
  }
  return out;
}

/** The speech span inside a window [0, windowSec] given its silences; null when it is all silence. */
export function speechSpan(silences: { start: number; end: number }[], windowSec: number): { startSec: number; endSec: number } | null {
  let start = 0;
  let end = windowSec;
  const s = silences.map((x) => ({ start: Math.max(0, x.start), end: Math.min(windowSec, x.end) })).filter((x) => x.end > x.start);
  if (s.some((x) => x.start <= 0.02 && x.end >= windowSec - 0.02)) return null;
  const lead = s.find((x) => x.start <= 0.02);
  if (lead) start = lead.end;
  const tail = [...s].reverse().find((x) => x.end >= windowSec - 0.02);
  if (tail) end = tail.start;
  return end - start > 0.2 ? { startSec: Math.round(start * 1000) / 1000, endSec: Math.round(end * 1000) / 1000 } : null;
}
