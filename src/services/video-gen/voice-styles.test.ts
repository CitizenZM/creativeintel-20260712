import * as cheerio from "cheerio";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tts = vi.hoisted(() => {
  const calls: { kind: "raw" | "plain"; input: string }[] = [];
  let failRawWhen: RegExp | null = null;
  const stream = (ok: boolean) => {
    const handlers: Record<string, ((x?: unknown) => void)[]> = {};
    const audioStream = { on: (ev: string, fn: (x?: unknown) => void) => ((handlers[ev] ??= []).push(fn), audioStream) };
    setTimeout(() => {
      if (ok) handlers.data?.forEach((f) => f(Buffer.alloc(2000, 1)));
      handlers.end?.forEach((f) => f());
    }, 0);
    return { audioStream, metadataStream: null };
  };
  class MsEdgeTTS {
    async setMetadata() {}
    toStream(input: string) {
      calls.push({ kind: "plain", input });
      return stream(true);
    }
    rawToStream(input: string) {
      calls.push({ kind: "raw", input });
      return stream(!(failRawWhen && failRawWhen.test(input)));
    }
    close() {}
  }
  return { MsEdgeTTS, OUTPUT_FORMAT: { AUDIO_24KHZ_48KBITRATE_MONO_MP3: "mp3" }, calls, failRaw: (re: RegExp | null) => (failRawWhen = re) };
});
vi.mock("msedge-tts", () => tts);

import { AZURE_EXPRESS_AS, buildVoiceSsml, platformEnergy, PROSODY_PRESETS, prosodyFor, styleForBeat, supportsExpressAs } from "./voice-styles";
import { escapeXml, planVoiceover, synthesize } from "./voiceover";

const parse = (ssml: string) => cheerio.load(ssml, { xml: true });

describe("style per beat purpose and platform", () => {
  it("hook = excited, proof = friendly, offer = cheerful, cta = excited", () => {
    expect(styleForBeat("hook")).toBe("excited");
    expect(styleForBeat("proof")).toBe("friendly");
    expect(styleForBeat("offer")).toBe("cheerful");
    expect(styleForBeat("cta")).toBe("excited");
  });
  it("TikTok is more energetic, YouTube calmer", () => {
    expect(platformEnergy("tiktok")).toBe(1);
    expect(platformEnergy("youtube_instream_skippable")).toBe(-1);
    expect(platformEnergy("meta_feed")).toBe(0);
    // YouTube tones an excited hook down to cheerful; TikTok lifts friendly proof to cheerful.
    expect(styleForBeat("hook", "youtube_instream_skippable")).toBe("cheerful");
    expect(styleForBeat("proof", "tiktok")).toBe("cheerful");
    const tik = prosodyFor("cheerful", 1);
    const yt = prosodyFor("cheerful", -1);
    expect(parseFloat(tik.rate)).toBeGreaterThan(parseFloat(PROSODY_PRESETS.cheerful.rate));
    expect(parseFloat(yt.rate)).toBeLessThan(parseFloat(PROSODY_PRESETS.cheerful.rate));
  });
});

describe("buildVoiceSsml", () => {
  it("Edge (default): never express-as — the read-aloud endpoint drops the stream — prosody preset instead", () => {
    const { ssml, mode } = buildVoiceSsml({ text: "Bang & Olufsen <wow>", voice: "en-US-JennyNeural", style: "excited" });
    expect(mode).toBe("prosody");
    expect(ssml).not.toMatch(/express-as/);
    const $ = parse(ssml);
    expect($("speak").attr("xml:lang")).toBe("en-US");
    expect($("voice").attr("name")).toBe("en-US-JennyNeural");
    expect($("prosody").attr("rate")).toBe(PROSODY_PRESETS.excited.rate);
    expect($("prosody").attr("pitch")).toBe(PROSODY_PRESETS.excited.pitch);
    expect($("prosody").text()).toBe("Bang & Olufsen <wow>");
    expect(ssml).toContain(escapeXml("Bang & Olufsen <wow>"));
  });
  it("Azure engine + a voice that has the style → mstts:express-as", () => {
    expect(supportsExpressAs("azure", "en-US-JennyNeural", "excited")).toBe(true);
    expect(supportsExpressAs("edge", "en-US-JennyNeural", "excited")).toBe(false);
    const { ssml, mode } = buildVoiceSsml({ text: "Hi", voice: "en-US-JennyNeural", style: "excited", engine: "azure" });
    expect(mode).toBe("express-as");
    expect(parse(ssml)("mstts\\:express-as").attr("style")).toBe("excited");
  });
  it("Azure engine but the voice lacks the style → prosody fallback", () => {
    expect(AZURE_EXPRESS_AS["en-US-AndrewMultilingualNeural"]).toBeUndefined();
    expect(buildVoiceSsml({ text: "Hi", voice: "en-US-AndrewMultilingualNeural", style: "excited", engine: "azure" }).mode).toBe("prosody");
  });
  it("no style and no energy → plain SSML; energy alone still shapes prosody", () => {
    expect(buildVoiceSsml({ text: "Hi", voice: "en-GB-RyanNeural" })).toMatchObject({ mode: "plain" });
    expect(buildVoiceSsml({ text: "Hi", voice: "en-GB-RyanNeural" }).ssml).toContain('xml:lang="en-GB"');
    expect(buildVoiceSsml({ text: "Hi", voice: "en-GB-RyanNeural", energy: 1 }).mode).toBe("prosody");
  });
});

describe("synthesize with a delivery style", () => {
  beforeEach(() => {
    tts.calls.length = 0;
    tts.failRaw(null);
  });
  it("unstyled lines keep the old plain path", async () => {
    await synthesize("Plain line", "en-US-JennyNeural");
    expect(tts.calls).toEqual([{ kind: "plain", input: "Plain line" }]);
  });
  it("styled lines send our SSML (prosody on Edge)", async () => {
    await synthesize("Wait for it & see", "en-US-JennyNeural", { style: "excited", energy: 1 });
    expect(tts.calls).toHaveLength(1);
    expect(tts.calls[0].kind).toBe("raw");
    expect(tts.calls[0].input).toMatch(/<prosody rate="\+\d+%" pitch="\+\d+%" volume="\+\d+%">Wait for it &amp; see<\/prosody>/);
  });
  it("falls back express-as → prosody → plain when the service returns no audio", async () => {
    tts.failRaw(/express-as/);
    await synthesize("Hi", "en-US-JennyNeural", { style: "excited", engine: "azure" });
    expect(tts.calls.map((c) => (c.kind === "raw" ? (/express-as/.test(c.input) ? "express-as" : "prosody") : "plain"))).toEqual(["express-as", "prosody"]);
  }, 20_000);
});

describe("planVoiceover carries the beat's delivery", () => {
  it("keeps style / energy on the line", () => {
    const lines = planVoiceover([
      { startSec: 0, endSec: 2, voiceover: "Hook!", voiceStyle: "excited", voiceEnergy: 1 },
      { startSec: 2, endSec: 4, voiceover: "Proof.", voiceStyle: "friendly", voiceEnergy: 1 },
      { startSec: 4, endSec: 6, voiceover: "No style." },
    ]);
    expect(lines.map((l) => [l.style, l.energy])).toEqual([["excited", 1], ["friendly", 1], [undefined, undefined]]);
  });
});
