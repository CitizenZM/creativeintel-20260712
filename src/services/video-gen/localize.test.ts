import { describe, expect, it, vi } from "vitest";
import type { AssembleFrame } from "./glm-assemble";
import {
  LOCALES,
  captionFontFor,
  estimateSpeechSec,
  isLocale,
  localeAdName,
  localeProfile,
  localizeFrames,
  missingLocales,
  maxSpokenChars,
  protectTerms,
  restoreTerms,
  spokenChars,
  trimToBudget,
  voiceFor,
} from "./localize";
import { spokenForm } from "./voiceover";

// A 12 s locked master: hook, two body beats, CTA end card (2 s frames, beats repeat their line).
const frames: AssembleFrame[] = [
  { frameNumber: 1, startSec: 0, endSec: 2, segment: "HOOK", text: "STILL SQUINTING AT GLARE?", voiceover: "Still squinting at screen glare?" },
  { frameNumber: 2, startSec: 2, endSec: 4, segment: "BODY", text: "NO GLARE", voiceover: "The TCL {NXTPAPER 14|Next Paper Fourteen} kills reflections, even in full sun." },
  { frameNumber: 3, startSec: 4, endSec: 6, segment: "BODY", text: "NO GLARE", voiceover: "The TCL {NXTPAPER 14|Next Paper Fourteen} kills reflections, even in full sun." },
  { frameNumber: 4, startSec: 6, endSec: 8, segment: "BODY", text: "FEELS LIKE PAPER", voiceover: "It reads like real paper." },
  { frameNumber: 5, startSec: 8, endSec: 10, segment: "BODY", text: "FEELS LIKE PAPER", voiceover: "It reads like real paper." },
  { frameNumber: 6, startSec: 10, endSec: 12, segment: "CTA", text: "20% OFF TODAY", voiceover: "Get yours today.", fine: "Offer ends Sunday.", endCard: { id: "E03", data: { code: "NXT20", headline: "20% OFF TODAY", button: "Use code NXT20" } } },
];
const terms = ["TCL", "NXTPAPER 14"];

type Item = { id: string; text: string; maxChars: number; kind: string };
/** A fake translator: maps each source item through `fn` and keeps the placeholders. */
function fakeLlm(fn: (it: Item) => string, spellings: Record<string, string> = {}) {
  return vi.fn(async ({ user }: { system: string; user: string }) => {
    const u = JSON.parse(user) as { items: Item[]; spellings?: { id: string }[] };
    return { items: u.items.map((it) => ({ id: it.id, text: fn(it) })), spellings: (u.spellings ?? []).map((s) => ({ id: s.id, spoken: spellings[s.id] ?? "" })) };
  });
}

describe("locale table", () => {
  it("has the 11 launch locales, each with a male + female Edge neural voice", () => {
    expect(LOCALES).toEqual(["es-US", "es-MX", "pt-BR", "fr-FR", "de-DE", "it-IT", "ja-JP", "ko-KR", "zh-CN", "ar-SA", "hi-IN"]);
    for (const l of LOCALES) {
      const p = localeProfile(l);
      expect(p.voices.female).toMatch(new RegExp(`^${l}-\\w+Neural$`));
      expect(p.voices.male).toMatch(new RegExp(`^${l}-\\w+Neural$`));
    }
    expect(voiceFor("ja-JP")).toBe("ja-JP-KeitaNeural");
    expect(voiceFor("ja-JP", "female")).toBe("ja-JP-NanamiNeural");
    expect(voiceFor("es-US", "male")).toBe("es-US-AlonsoNeural");
    expect(isLocale("ar-SA")).toBe(true);
    expect(isLocale("en-GB")).toBe(false);
    expect(localeProfile("ar-SA").rtl).toBe(true);
    expect(localeProfile("ja-JP").rtl).toBe(false);
  });
});

describe("speech budget", () => {
  it("counts spoken letters (the spoken side of {SHOWN|spoken}, no spaces or punctuation; codes and digits twice)", () => {
    expect(spokenChars("Hola, mundo!")).toBe(9);
    expect(spokenChars("Usa el código NXT20 hoy.")).toBe(24);
    expect(spokenChars("{NXTPAPER 14|ネクスト}で、ゼロ。")).toBe(7);
  });

  it("estimates seconds from per-language characters per second and inverts to a max", () => {
    expect(estimateSpeechSec("反射ゼロ", "zh-CN")).toBeGreaterThan(estimateSpeechSec("反射ゼロ", "ja-JP"));
    expect(maxSpokenChars(4, "es-US")).toBeGreaterThan(maxSpokenChars(4, "ja-JP"));
    expect(maxSpokenChars(4, "ja-JP")).toBeGreaterThan(maxSpokenChars(4, "zh-CN"));
    const n = maxSpokenChars(3, "de-DE");
    expect(estimateSpeechSec("x".repeat(n), "de-DE")).toBeLessThanOrEqual(3 * 1.15);
  });

  it("trims an over-long line at the last clause that fits, or reports it can't", () => {
    expect(trimToBudget("Sin reflejos, incluso a pleno sol del mediodía.", 20, "es-US")).toBe("Sin reflejos.");
    expect(trimToBudget("反射ゼロ、真昼の直射日光でもくっきり。", 6, "ja-JP")).toBe("反射ゼロ。");
    expect(trimToBudget("Supercalifragilistic", 5, "es-US")).toBeNull();
  });
});

describe("protectTerms / restoreTerms", () => {
  it("masks spellings and brand names with tokens and restores them (spoken side localized)", () => {
    const { masked, slots } = protectTerms("The TCL {NXTPAPER 14|Next Paper Fourteen} kills glare. tcl!", terms);
    expect(masked).toBe("The [[B0]] [[S0]] kills glare. [[B1]]!");
    expect(restoreTerms("El [[B0]] [[S0]] elimina el brillo. [[B1]]!", slots, { S0: "Nekst Peiper Catorce" })).toBe("El TCL {NXTPAPER 14|Nekst Peiper Catorce} elimina el brillo. tcl!");
    expect(restoreTerms("[[S0]] sin brillo", { S0: slots.S0 }, {})).toBe("{NXTPAPER 14|Next Paper Fourteen} sin brillo");
    expect(() => restoreTerms("El [[B0]] elimina", slots, {})).toThrow(/S0/);
  });
});

describe("captionFontFor", () => {
  it("picks a CJK / Arabic / Devanagari face that exists, keeps the brand fonts for Latin scripts", () => {
    const mac = (f: string) => f.startsWith("/System/Library/Fonts/");
    expect(captionFontFor("es-US", mac)).toBeNull();
    expect(captionFontFor("ja-JP", mac)).toMatchObject({ source: "local", family: "Hiragino Sans Bold" });
    expect(captionFontFor("zh-CN", mac)?.family).toMatch(/Hiragino Sans GB|Heiti SC/);
    expect(captionFontFor("ar-SA", mac)).toMatchObject({ source: "local", family: "Geeza Pro Bold" });
    expect(captionFontFor("hi-IN", mac)?.family).toMatch(/Kohinoor Devanagari/);
    const linux = (f: string) => f.includes("/usr/share/fonts/");
    expect(captionFontFor("ja-JP", linux)).toMatchObject({ family: "Noto Sans CJK JP Bold" });
    expect(captionFontFor("ko-KR", () => false)).toMatchObject({ source: "google", google: "Noto Sans KR" });
  });
});

describe("localizeFrames", () => {
  it("translates VO, overlays and end-card copy in ONE call, keeps timing, brand names and spelling markup", async () => {
    const llm = fakeLlm(
      (it) =>
        ({
          "Still squinting at screen glare?": "¿Sigues entrecerrando los ojos?",
          "The [[B0]] [[S0]] kills reflections, even in full sun.": "El [[B0]] [[S0]] elimina reflejos, incluso al sol.",
          "It reads like real paper.": "Se lee como papel.",
          "Get yours today.": "Consíguelo hoy.",
          "STILL SQUINTING AT GLARE?": "¿TODAVÍA CON REFLEJOS?",
          "NO GLARE": "SIN REFLEJOS",
          "FEELS LIKE PAPER": "COMO PAPEL",
          "20% OFF TODAY": "20% MENOS HOY",
          "Use code [[B0]]": "Usa el código [[B0]]",
          "Offer ends Sunday.": "La oferta termina el domingo.",
          "Shop now": "Compra ya",
        })[it.text] ?? `??${it.text}`,
      { S0: "Nekst Peiper Catorce" }
    );
    const out = await localizeFrames(frames, "es-US", { terms, ctaText: "Shop now", llm });
    expect(llm).toHaveBeenCalledTimes(1);
    const u = JSON.parse(llm.mock.calls[0][0].user) as { items: Item[]; locale: string };
    expect(u.locale).toBe("es-US");
    // Each unique string once; brand names masked.
    expect(u.items.filter((i) => i.kind === "vo")).toHaveLength(4);
    expect(u.items.map((i) => i.text).join(" ")).not.toMatch(/TCL|NXTPAPER/);
    expect(out.frames.map((f) => [f.startSec, f.endSec, f.segment])).toEqual(frames.map((f) => [f.startSec, f.endSec, f.segment]));
    expect(out.frames[1].voiceover).toBe("El TCL {NXTPAPER 14|Nekst Peiper Catorce} elimina reflejos, incluso al sol.");
    expect(out.frames[2].voiceover).toBe(out.frames[1].voiceover);
    expect(out.frames[0].text).toBe("¿TODAVÍA CON REFLEJOS?");
    expect(out.frames[5].endCard?.data).toMatchObject({ code: "NXT20", headline: "20% MENOS HOY", button: "Usa el código NXT20" });
    expect(out.frames[5].fine).toBe("La oferta termina el domingo.");
    expect(out.ctaText).toBe("Compra ya");
    expect(out.voice).toBe("es-US-AlonsoNeural");
    expect(out.fits.every((f) => f.ok)).toBe(true);
    expect(out.notes).toEqual([]);
  });

  it("shortens over-long lines in one more batched call, then trims at a clause", async () => {
    const long = "Este es un texto larguísimo que de ninguna manera cabe en dos segundos de locución, ni hablando rápido, nunca.";
    const first = fakeLlm((it) => (it.kind === "vo" && it.text.startsWith("Still") ? long : it.text.replace(/\[\[S0\]\]/, "[[S0]]")));
    const calls: Item[][] = [];
    const llm = vi.fn(async (args: { system: string; user: string }) => {
      const u = JSON.parse(args.user) as { items: Item[] };
      calls.push(u.items);
      if (calls.length === 1) return first(args);
      // The shorten pass is still too long for one line → the clause trim takes over.
      return { items: u.items.map((it) => ({ id: it.id, text: "Demasiado largo todavía, sin duda alguna, con más palabras." })) };
    });
    const out = await localizeFrames(frames, "es-US", { terms, ctaText: "Shop now", llm });
    expect(llm).toHaveBeenCalledTimes(2);
    expect(calls[1].map((i) => i.id)).toEqual(["vo0"]);
    expect(calls[1][0].maxChars).toBe(maxSpokenChars(2, "es-US"));
    expect(out.frames[0].voiceover).toBe("Demasiado largo todavía.");
    expect(out.notes.join(" ")).toMatch(/vo0.*trimmed/);
    expect(out.fits[0]).toMatchObject({ ok: true, windowSec: 2 });
  });

  it("repairs a translation that dropped a protected name, else keeps the source line", async () => {
    const llm = vi
      .fn()
      .mockImplementationOnce(fakeLlm((it) => (it.text.includes("[[S0]]") ? "El producto elimina reflejos." : it.text)))
      .mockImplementationOnce(async () => ({ items: [{ id: "vo1", text: "Sigue sin nombre." }] }));
    const out = await localizeFrames(frames, "es-US", { terms, ctaText: "Shop now", llm });
    expect(llm).toHaveBeenCalledTimes(2);
    expect(out.frames[1].voiceover).toBe(frames[1].voiceover);
    expect(out.notes.join(" ")).toMatch(/vo1.*kept the source/);
  });

  it("throws when the translation call fails (nothing to render)", async () => {
    await expect(localizeFrames(frames, "ja-JP", { terms, llm: vi.fn(async () => Promise.reject(new Error("offline"))) })).rejects.toThrow(/translation failed/);
  });

  it("budgets Japanese per beat in characters and keeps CJK fits", async () => {
    const ja: Record<string, string> = {
      "Still squinting at screen glare?": "まだ画面の反射に目を細めてる？",
      "The [[B0]] [[S0]] kills reflections, even in full sun.": "[[B0]]の[[S0]]で反射ゼロ。",
      "It reads like real paper.": "まるで本物の紙。",
      "Get yours today.": "今すぐ手に入れよう。",
    };
    const llm = fakeLlm((it) => ja[it.text] ?? it.text, { S0: "ネクストペーパー フォーティーン" });
    const out = await localizeFrames(frames, "ja-JP", { terms, llm });
    expect(out.frames[1].voiceover).toBe("TCLの{NXTPAPER 14|ネクストペーパー フォーティーン}で反射ゼロ。");
    expect(out.fits.every((f) => f.ok)).toBe(true);
    expect(spokenForm(out.frames[1].voiceover!)).toContain("ネクストペーパー");
    const vo1 = out.fits.find((f) => f.id === "vo1")!;
    expect(vo1.windowSec).toBe(4);
    expect(vo1.estSec).toBeCloseTo(estimateSpeechSec(out.frames[1].voiceover!, "ja-JP"), 6);
    expect(out.voice).toBe("ja-JP-KeitaNeural");
  });
});

describe("run bookkeeping", () => {
  const now = Date.parse("2026-10-06T12:00:00Z");
  it("renders only missing locales; fresh claims wait, stale ones retry; force re-renders done ones", () => {
    const qc = { locales: [{ locale: "es-US" }], localesPending: { "ja-JP": "2026-10-06T11:58:00Z", "de-DE": "2026-10-06T11:30:00Z" } };
    expect(missingLocales(qc, ["es-US", "ja-JP", "de-DE", "ar-SA", "ar-SA"], now)).toEqual(["de-DE", "ar-SA"]);
    expect(missingLocales(qc, ["es-US"], now, true)).toEqual(["es-US"]);
    expect(missingLocales({}, ["zh-CN"], now)).toEqual(["zh-CN"]);
  });
  it("names a localized version for A/B uploads", () => {
    expect(localeAdName("TCL_Nxtpaper14_15s_HookQ", "pt-BR")).toBe("TCL_Nxtpaper14_15s_HookQ_ptBR");
  });
});
