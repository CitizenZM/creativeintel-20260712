/**
 * Voiceover delivery styles — how each beat is spoken.
 *
 * Beat purpose → style (hook = excited, proof = friendly, offer = cheerful, cta = excited), shifted by
 * the platform profile (TikTok more energetic, YouTube calmer), then rendered as SSML.
 *
 * WHAT ACTUALLY WORKS (measured locally 2026-10-07 with msedge-tts 2.0.8 against Edge's free
 * read-aloud endpoint; script: same line, with / without each style, ffmpeg astats + an F0 tracker):
 *   - `<mstts:express-as>` is NOT supported there: every request carrying it (Jenny, Aria, Guy — any
 *     style, even a made-up one) closed the stream with no audio ("no turn.end received"). The same
 *     SSML without it synthesized fine. So express-as is not just ignored — it breaks synthesis.
 *   - en-US-DavisNeural is not served at all (not in the endpoint's voice list; every request failed).
 *   - The endpoint's voice list (MsEdgeTTS.getVoices, 322 voices) carries no StyleList, so styles can't
 *     be discovered from it; AZURE_EXPRESS_AS below is from the Azure Speech voice docs and only applies
 *     to the paid Azure Speech service (engine "azure").
 *   - `<prosody>` IS honoured: Jenny with rate +12% / pitch +8% / volume +10% spoke the line in 5.64 s
 *     vs 6.31 s (−10.7%), median F0 195 vs 180 Hz (+8.5%), RMS −20.7 vs −21.5 dB; −10% / −10% / −40%
 *     gave 7.01 s, F0 163 Hz (−9%), RMS −26.0 dB. Andrew Multilingual: F0 112 → 125 Hz with pitch +8%.
 * So on Edge each style is a prosody preset (rate / pitch / volume). "whispering" is only a quieter,
 * lower, slower read — not a real whisper.
 * Through synthesize() (same line; spoken length / median F0): Jenny plain 6.31 s / 180 Hz, excited+TikTok
 * 5.44 s / 198 Hz, calm 6.72 s / 174 Hz; Andrew plain 6.05 s / 119 Hz, excited+TikTok 5.64 s / 127 Hz,
 * calm 6.94 s / 108 Hz. An "azure" express-as request to Edge failed and fell back to the prosody preset.
 * Run-to-run F0 noise is ~±5%, so "friendly" (+2%) is barely audible; the master's loudnorm also evens
 * out most of the volume offsets — rate and pitch carry the style.
 */
import type { BeatPurpose } from "@/services/creative/campaign-plan.types";

export type VoiceStyle = "excited" | "cheerful" | "friendly" | "hopeful" | "calm" | "whispering" | "neutral";
export type VoiceEngine = "edge" | "azure";
export type VoiceEnergy = -1 | 0 | 1;

/** Edge read-aloud rejects mstts:express-as (see header) — keep false unless a re-test shows otherwise. */
export const EDGE_SUPPORTS_EXPRESS_AS = false;

/** Azure Speech express-as styles per voice (Azure voice docs). NOT usable on the free Edge endpoint. */
export const AZURE_EXPRESS_AS: Record<string, string[]> = {
  "en-US-JennyNeural": ["assistant", "chat", "customerservice", "newscast", "angry", "cheerful", "sad", "excited", "friendly", "terrified", "shouting", "unfriendly", "whispering", "hopeful"],
  "en-US-AriaNeural": ["chat", "customerservice", "narration-professional", "newscast-casual", "newscast-formal", "cheerful", "empathetic", "angry", "sad", "excited", "friendly", "terrified", "shouting", "unfriendly", "whispering", "hopeful"],
  "en-US-GuyNeural": ["newscast", "angry", "cheerful", "sad", "excited", "friendly", "terrified", "shouting", "unfriendly", "whispering", "hopeful"],
  "en-US-DavisNeural": ["chat", "angry", "cheerful", "excited", "friendly", "hopeful", "sad", "shouting", "terrified", "unfriendly", "whispering"],
  "en-US-JaneNeural": ["angry", "cheerful", "excited", "friendly", "hopeful", "sad", "shouting", "terrified", "unfriendly", "whispering"],
  "en-US-JasonNeural": ["angry", "cheerful", "excited", "friendly", "hopeful", "sad", "shouting", "terrified", "unfriendly", "whispering"],
  "en-US-NancyNeural": ["angry", "cheerful", "excited", "friendly", "hopeful", "sad", "shouting", "terrified", "unfriendly", "whispering"],
  "en-US-SaraNeural": ["angry", "cheerful", "excited", "friendly", "hopeful", "sad", "shouting", "terrified", "unfriendly", "whispering"],
  "en-US-TonyNeural": ["angry", "cheerful", "excited", "friendly", "hopeful", "sad", "shouting", "terrified", "unfriendly", "whispering"],
};

export interface Prosody {
  rate: string;
  pitch: string;
  volume: string;
}

/** Prosody per style (relative %, the units Edge honoured in the measurement). */
export const PROSODY_PRESETS: Record<VoiceStyle, Prosody> = {
  excited: { rate: "+12%", pitch: "+8%", volume: "+10%" },
  cheerful: { rate: "+6%", pitch: "+5%", volume: "+5%" },
  friendly: { rate: "+2%", pitch: "+2%", volume: "+0%" },
  hopeful: { rate: "+0%", pitch: "+4%", volume: "+0%" },
  calm: { rate: "-6%", pitch: "-3%", volume: "-5%" },
  whispering: { rate: "-10%", pitch: "-10%", volume: "-40%" },
  neutral: { rate: "+0%", pitch: "+0%", volume: "+0%" },
};

/** Beat purpose → delivery. */
export const PURPOSE_STYLE: Record<BeatPurpose, VoiceStyle> = {
  hook: "excited",
  pitch: "excited",
  proof: "friendly",
  benefit: "friendly",
  objection: "calm",
  offer: "cheerful",
  cta: "excited",
};

const ENERGETIC = new Set(["tiktok", "snapchat"]);
const CALM = new Set(["youtube_instream_skippable", "youtube_instream_nonskippable_15s", "youtube_bumper_6s", "google_demand_gen"]);

/** Platform-profile default energy: TikTok / Snapchat +1, YouTube in-stream / Demand Gen −1, others 0. */
export function platformEnergy(platform?: string | null): VoiceEnergy {
  if (!platform) return 0;
  return ENERGETIC.has(platform) ? 1 : CALM.has(platform) ? -1 : 0;
}

export function styleForBeat(purpose: BeatPurpose | string, platform?: string | null): VoiceStyle {
  const base = PURPOSE_STYLE[purpose as BeatPurpose] ?? "friendly";
  const e = platformEnergy(platform);
  if (e < 0 && base === "excited") return "cheerful";
  if (e > 0 && base === "friendly") return "cheerful";
  return base;
}

const pct = (s: string) => Number.parseFloat(s) || 0;
const fmt = (n: number) => `${n >= 0 ? "+" : ""}${Math.round(n)}%`;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** The style's preset nudged by platform energy (±4% rate, ±2% pitch, −3% volume when calmer). */
export function prosodyFor(style: VoiceStyle = "neutral", energy: VoiceEnergy = 0): Prosody {
  const p = PROSODY_PRESETS[style] ?? PROSODY_PRESETS.neutral;
  return {
    rate: fmt(clamp(pct(p.rate) + 4 * energy, -25, 25)),
    pitch: fmt(clamp(pct(p.pitch) + 2 * energy, -20, 20)),
    volume: fmt(clamp(pct(p.volume) + (energy < 0 ? -3 : 0), -50, 20)),
  };
}

const isNeutral = (p: Prosody) => pct(p.rate) === 0 && pct(p.pitch) === 0 && pct(p.volume) === 0;

/** Text for SSML: a bare "&" ("Bang & Olufsen") makes the service return no audio. */
export const escapeXml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const attr = (t: string) => escapeXml(t).replace(/"/g, "&quot;");

export function supportsExpressAs(engine: VoiceEngine, voice: string, style?: string | null): boolean {
  if (!style || style === "neutral") return false;
  if (engine === "edge" && !EDGE_SUPPORTS_EXPRESS_AS) return false;
  return !!AZURE_EXPRESS_AS[voice]?.includes(style);
}

export interface VoiceDelivery {
  style?: VoiceStyle | null;
  energy?: VoiceEnergy | null;
  engine?: VoiceEngine;
}

export type SsmlMode = "plain" | "prosody" | "express-as";

/** One spoken line as SSML: express-as where the engine + voice support it, else the prosody preset. */
export function buildVoiceSsml(input: { text: string; voice: string } & VoiceDelivery & { force?: SsmlMode }): { ssml: string; mode: SsmlMode } {
  const engine = input.engine ?? "edge";
  const style = input.style ?? "neutral";
  const energy = (input.energy ?? 0) as VoiceEnergy;
  const lang = input.voice.match(/^[a-z]{2,3}-[A-Za-z]{2,4}/)?.[0] ?? "en-US";
  const text = escapeXml(input.text);
  const prosody = prosodyFor(style, energy);
  let mode: SsmlMode = supportsExpressAs(engine, input.voice, style) ? "express-as" : isNeutral(prosody) ? "plain" : "prosody";
  if (input.force === "plain" || (input.force === "prosody" && mode === "express-as")) mode = input.force === "plain" || isNeutral(prosody) ? "plain" : "prosody";
  const p = (inner: string, pr: Prosody) => `<prosody rate="${pr.rate}" pitch="${pr.pitch}" volume="${pr.volume}">${inner}</prosody>`;
  const body =
    mode === "express-as"
      ? `<mstts:express-as style="${attr(style)}" styledegree="1.5">${energy ? p(text, prosodyFor("neutral", energy)) : text}</mstts:express-as>`
      : mode === "prosody"
        ? p(text, prosody)
        : text;
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${lang}"><voice name="${attr(input.voice)}">${body}</voice></speak>`;
  return { ssml, mode };
}
