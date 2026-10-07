/**
 * Localization — one finished master into many languages, without generating new video.
 *
 *   localizeFrames   the run's frames (voiceover + on-screen text + end-card copy + fine print + the
 *                    CTA button) translated in ONE batched text-model call. Brand / product names and
 *                    `{SHOWN|spoken}` caption spellings are masked with [[B0]] / [[S0]] tokens so they
 *                    survive verbatim (the model only re-says the spoken side for the target voice).
 *                    Every voiceover line gets a per-beat budget in spoken characters
 *                    (characters / second per language × the beat window); lines that run over — or
 *                    lost a token — go back in ONE more batched call, then a clause trim. Timing,
 *                    segments, clips and end-card facts never change.
 *   voiceFor         Edge TTS neural voice per locale (male / female), free.
 *   captionFontFor   a caption face that has the glyphs (CJK, Arabic, Devanagari): a local file
 *                    (macOS dev, Linux Noto) or the Google Fonts Noto family; Latin keeps brand fonts.
 *   RTL              Arabic captions get a right-to-left base direction in text-layers.renderMarkup.
 *
 * The re-edit itself (same clips, new voice, captions and text) is localize-run.ts. Pure here.
 */
import { z } from "zod";
import type { AssembleFrame } from "./glm-assemble";
import { planVoiceover, shownForm, spokenForm } from "./voiceover";

export const LOCALES = ["es-US", "es-MX", "pt-BR", "fr-FR", "de-DE", "it-IT", "ja-JP", "ko-KR", "zh-CN", "ar-SA", "hi-IN"] as const;
export type LocaleId = (typeof LOCALES)[number];
export type VoiceGender = "male" | "female";
type Script = "latin" | "ja" | "zh" | "ko" | "arabic" | "devanagari";

export interface LocaleProfile {
  id: LocaleId;
  language: string;
  voices: Record<VoiceGender, string>;
  /** Spoken letters (no spaces / punctuation / combining marks) per second at the voice's normal rate. */
  cps: number;
  script: Script;
  rtl: boolean;
  /** On-screen text length vs the English source (letters). */
  textRatio: number;
}

const P = (id: LocaleId, language: string, female: string, male: string, cps: number, script: Script, textRatio: number): LocaleProfile => ({
  id,
  language,
  voices: { female, male },
  cps,
  script,
  rtl: script === "arabic",
  textRatio,
});

/**
 * Voices: Edge TTS neural voices (checked against the service's voice list 2026-10-06). cps measured on
 * Edge TTS speech spans 2026-10-06 (es-US 11–14.6 → 12.5, ja-JP 5.9–7.6 → 6.5, zh-CN 4.3–5.3 → 4.6,
 * ar-SA 7.9–10.2 → 9.5); the other languages scaled from published speech-rate studies to the same rule.
 */
export const LOCALE_PROFILES: Record<LocaleId, LocaleProfile> = {
  "es-US": P("es-US", "Spanish (US Hispanic)", "es-US-PalomaNeural", "es-US-AlonsoNeural", 12.5, "latin", 1.4),
  "es-MX": P("es-MX", "Spanish (Mexico)", "es-MX-DaliaNeural", "es-MX-JorgeNeural", 12.5, "latin", 1.4),
  "pt-BR": P("pt-BR", "Brazilian Portuguese", "pt-BR-FranciscaNeural", "pt-BR-AntonioNeural", 12.5, "latin", 1.4),
  "fr-FR": P("fr-FR", "French (France)", "fr-FR-DeniseNeural", "fr-FR-HenriNeural", 12.5, "latin", 1.4),
  "de-DE": P("de-DE", "German", "de-DE-KatjaNeural", "de-DE-ConradNeural", 12, "latin", 1.5),
  "it-IT": P("it-IT", "Italian", "it-IT-ElsaNeural", "it-IT-DiegoNeural", 12.5, "latin", 1.4),
  "ja-JP": P("ja-JP", "Japanese", "ja-JP-NanamiNeural", "ja-JP-KeitaNeural", 6.5, "ja", 0.6),
  "ko-KR": P("ko-KR", "Korean", "ko-KR-SunHiNeural", "ko-KR-InJoonNeural", 6, "ko", 0.7),
  "zh-CN": P("zh-CN", "Simplified Chinese (Mandarin)", "zh-CN-XiaoxiaoNeural", "zh-CN-YunxiNeural", 4.6, "zh", 0.45),
  "ar-SA": P("ar-SA", "Arabic (Saudi Arabia)", "ar-SA-ZariyahNeural", "ar-SA-HamedNeural", 9.5, "arabic", 1.2),
  "hi-IN": P("hi-IN", "Hindi", "hi-IN-SwaraNeural", "hi-IN-MadhurNeural", 10, "devanagari", 1.3),
};

export const isLocale = (v: unknown): v is LocaleId => typeof v === "string" && (LOCALES as readonly string[]).includes(v);
export function localeProfile(id: LocaleId): LocaleProfile {
  const p = LOCALE_PROFILES[id];
  if (!p) throw new Error(`Unsupported locale ${id}`);
  return p;
}
/** The master's default voice (en-US Andrew) is male, so the localized versions default to male. */
export const voiceFor = (id: LocaleId, gender: VoiceGender = "male") => localeProfile(id).voices[gender];

/* ───────────────────────── speech budget ───────────────────────── */

/** The voice may speed a line up a little (placeLines allows up to 1.3×); budget to 1.15×. */
export const FIT = 1.15;

/** Letters and digits the voice says: the spoken side of {SHOWN|spoken}, no spaces, punctuation or marks. */
export const spokenChars = (text: string) => {
  const t = spokenForm(text);
  // Spelled-out acronyms / codes (TÜV, NXT20) and digits take about twice as long as letters in words.
  const spelled = (t.match(/\p{N}|(?<![\p{L}])\p{Lu}{2,}(?![\p{Ll}])/gu) ?? []).reduce((n, m) => n + [...m].length, 0);
  return (t.match(/[\p{L}\p{N}]/gu) ?? []).length + spelled;
};
const shownChars = (text: string) => (shownForm(text).match(/[\p{L}\p{N}]/gu) ?? []).length;

export const estimateSpeechSec = (text: string, locale: LocaleId) => spokenChars(text) / localeProfile(locale).cps;
export const maxSpokenChars = (windowSec: number, locale: LocaleId) => Math.max(4, Math.floor(windowSec * localeProfile(locale).cps * FIT));

const CJK_SCRIPT = (l: LocaleId) => ["ja", "zh"].includes(localeProfile(l).script);

/**
 * Cut a line at the last clause boundary (, ; : 、 。 …) outside {…} markup that fits `maxChars`
 * spoken letters, ending it with a full stop. Null when even the first clause doesn't fit.
 */
export function trimToBudget(text: string, maxChars: number, locale: LocaleId): string | null {
  const cuts: number[] = [];
  let depth = 0;
  const chars = [...text];
  chars.forEach((c, i) => {
    if (c === "{") depth++;
    else if (c === "}") depth = Math.max(0, depth - 1);
    else if (!depth && /[,;:、，。；：.!?！？—]/.test(c)) cuts.push(i);
  });
  let best: string | null = null;
  for (const i of cuts) {
    const head = chars.slice(0, i).join("").trim();
    if (!head || spokenChars(head) > maxChars) break;
    best = head;
  }
  if (!best) return null;
  return `${best.replace(/[,;:、，；：—\s]+$/, "")}${CJK_SCRIPT(locale) ? "。" : "."}`;
}

/* ───────────────────────── protected terms ───────────────────────── */

export type Slots = Record<string, string | { shown: string; spoken: string }>;

const SPELLING = /\{([^{}|]+)\|([^{}]+)\}/g;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Model numbers and codes (QM7L, NXT20, 4K): letters and digits mixed — never translated. */
const MIXED = /\b(?=[\p{L}]*\p{N})(?=\p{N}*\p{L})[\p{L}\p{N}]{2,}\b/gu;

/**
 * Mask `{SHOWN|spoken}` spellings ([[S<n>]], numbered across the batch via `spellingIds`) and brand /
 * product names + model codes ([[B<n>]], per text) so the model can't translate them.
 */
export function protectTerms(text: string, terms: string[], spellingIds: Map<string, string> = new Map()): { masked: string; slots: Slots } {
  const slots: Slots = {};
  let masked = text.replace(SPELLING, (m, shown: string, spoken: string) => {
    let id = spellingIds.get(m);
    if (!id) spellingIds.set(m, (id = `S${spellingIds.size}`));
    slots[id] = { shown: shown.trim(), spoken: spoken.trim() };
    return `[[${id}]]`;
  });
  let b = 0;
  const names = [...new Set(terms.map((t) => t.trim()).filter((t) => t.length >= 2))].sort((x, y) => y.length - x.length);
  if (names.length) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}\\[])(${names.map(escapeRe).join("|")})(?![\\p{L}\\p{N}\\]])`, "giu");
    masked = masked.replace(re, (m) => {
      const id = `B${b++}`;
      slots[id] = m;
      return `[[${id}]]`;
    });
  }
  masked = masked.replace(MIXED, (m, offset: number, all: string) => {
    if (all.slice(Math.max(0, offset - 2), offset) === "[[") return m; // inside a token id
    const id = `B${b++}`;
    slots[id] = m;
    return `[[${id}]]`;
  });
  return { masked, slots };
}

/** Put the masked terms back; `spoken` gives the target-language spoken side of each spelling. Throws on a lost token. */
export function restoreTerms(masked: string, slots: Slots, spoken: Record<string, string>): string {
  const missing = Object.keys(slots).filter((id) => !masked.includes(`[[${id}]]`));
  if (missing.length) throw new Error(`missing ${missing.map((m) => `[[${m}]]`).join(", ")}`);
  const unknown = [...masked.matchAll(/\[\[([BS]\d+)\]\]/g)].map((m) => m[1]).filter((id) => !(id in slots));
  if (unknown.length) throw new Error(`unknown token ${unknown.join(", ")}`);
  return masked.replace(/\[\[([BS]\d+)\]\]/g, (_, id: string) => {
    const s = slots[id];
    if (typeof s === "string") return s;
    return `{${s.shown}|${spoken[id]?.trim() || s.spoken}}`;
  });
}

/* ───────────────────────── fonts ───────────────────────── */

export interface CaptionFont {
  source: "local" | "google";
  family: string;
  file?: string;
  google?: string;
}

const NOTO_CJK = ["/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", "/usr/share/fonts/noto-cjk/NotoSansCJK-Bold.ttc", "/usr/share/fonts/google-noto-cjk/NotoSansCJK-Bold.ttc"];
const FONT_TABLE: Record<Exclude<Script, "latin">, { local: { file: string; family: string }[]; google: string }> = {
  ja: { local: [{ file: "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc", family: "Hiragino Sans Bold" }, ...NOTO_CJK.map((file) => ({ file, family: "Noto Sans CJK JP Bold" }))], google: "Noto Sans JP" },
  zh: { local: [{ file: "/System/Library/Fonts/Hiragino Sans GB.ttc", family: "Hiragino Sans GB Bold" }, { file: "/System/Library/Fonts/STHeiti Medium.ttc", family: "Heiti SC Medium" }, ...NOTO_CJK.map((file) => ({ file, family: "Noto Sans CJK SC Bold" }))], google: "Noto Sans SC" },
  ko: { local: [{ file: "/System/Library/Fonts/AppleSDGothicNeo.ttc", family: "Apple SD Gothic Neo Bold" }, ...NOTO_CJK.map((file) => ({ file, family: "Noto Sans CJK KR Bold" }))], google: "Noto Sans KR" },
  arabic: { local: [{ file: "/System/Library/Fonts/GeezaPro.ttc", family: "Geeza Pro Bold" }, { file: "/usr/share/fonts/truetype/noto/NotoSansArabic-Bold.ttf", family: "Noto Sans Arabic Bold" }], google: "Noto Sans Arabic" },
  devanagari: { local: [{ file: "/System/Library/Fonts/Kohinoor.ttc", family: "Kohinoor Devanagari Bold" }, { file: "/usr/share/fonts/truetype/noto/NotoSansDevanagari-Bold.ttf", family: "Noto Sans Devanagari Bold" }], google: "Noto Sans Devanagari" },
};

/**
 * The caption face for a locale: null for Latin scripts (Anton / Montserrat / brand fonts cover them),
 * else the first local file that exists, else the Google Fonts Noto family to fetch.
 */
export function captionFontFor(locale: LocaleId, exists: (file: string) => boolean): CaptionFont | null {
  const script = localeProfile(locale).script;
  if (script === "latin") return null;
  const t = FONT_TABLE[script];
  const local = t.local.find((f) => exists(f.file));
  return local ? { source: "local", family: local.family, file: local.file } : { source: "google", family: `${t.google} Bold`, google: t.google };
}

/* ───────────────────────── translation ───────────────────────── */

export type LlmFn = (args: { system: string; user: string }) => Promise<unknown>;

const itemSchema = z.object({ id: z.string(), text: z.string() }).passthrough();
const spellingSchema = z.object({ id: z.string(), spoken: z.string().catch("") }).passthrough();
export const localizeResponseSchema = z
  .object({ items: z.array(z.unknown()).catch([]), spellings: z.array(z.unknown()).catch([]) })
  .partial()
  .catch({});

type Kind = "vo" | "text" | "fine" | "cta";
interface Unit {
  id: string;
  kind: Kind;
  source: string;
  masked: string;
  slots: Slots;
  /** Spoken-letter budget (vo) or visible-letter budget (text, fine, cta), tokens included. */
  limit: number;
  windowSec?: number;
  out?: string;
  issue?: string;
}

export interface LineFit {
  id: string;
  text: string;
  windowSec: number;
  estSec: number;
  ok: boolean;
}

export interface LocalizedFrames {
  locale: LocaleId;
  voice: string;
  rtl: boolean;
  frames: AssembleFrame[];
  ctaText: string | null;
  fits: LineFit[];
  notes: string[];
}

export interface LocalizeOptions {
  /** Brand and product names kept as they are. */
  terms?: string[];
  /** The CTA button's text (Brand Kit), translated too. */
  ctaText?: string | null;
  gender?: VoiceGender;
  llm?: LlmFn;
}

const letters = (s: string) => (s.match(/[\p{L}\p{N}]/gu) ?? []).length;
const tokenLetters = (slots: Slots) => Object.values(slots).reduce((n, s) => n + letters(typeof s === "string" ? s : s.spoken), 0);

function translatePrompts(locale: LocaleId, units: Unit[], spellings: { id: string; shown: string; spoken: string }[], fix: boolean): { system: string; user: string } {
  const p = localeProfile(locale);
  const system = `You localize a short video ad from English into ${p.language} (${locale}) — native, persuasive ad copy a local creator would say, not a literal translation. Output JSON only:
{"items":[{"id":"…","text":"…"}]${fix ? "" : `,"spellings":[{"id":"S0","spoken":"…"}]`}}
RULES
- Keep every [[B0]] / [[S0]] token exactly as written (brand and product names, model codes, caption spellings) — never translate, drop or add a token.
- maxChars is a hard limit in letters/digits (spaces, punctuation and the tokens don't count). "vo" lines are spoken over a fixed beat; shorter is fine, never longer — cut words, keep the selling point.
- "text" is on-screen text: short and punchy${p.script === "latin" ? ", UPPERCASE when the source is uppercase" : ""}. "fine" is legal fine print: complete and accurate. "cta" is the button label.
- Keep numbers, %, prices and codes exactly.${fix ? "\n- Each item says what was wrong with the last attempt (issue): fix exactly that." : `\n- spellings: for each spelling give "spoken" — how a ${p.language} voice should say the product name (transliterate${p.script === "latin" ? "" : " into the native script"}, numbers in words).`}`;
  const user = JSON.stringify({
    locale,
    language: p.language,
    items: units.map((u) => ({ id: u.id, kind: u.kind, text: u.masked, maxChars: Math.max(3, u.limit - tokenLetters(u.slots)), ...(fix && u.issue ? { issue: u.issue, lastAttempt: u.out ?? null } : {}) })),
    ...(fix ? {} : { spellings }),
  });
  return { system, user };
}

const defaultLlm: LlmFn = async ({ system, user }) => {
  const { analyzeWithClaude } = await import("@/services/ai/claude-client");
  return analyzeWithClaude({ systemPrompt: system, userPrompt: user, responseSchema: localizeResponseSchema, maxTokens: 4000 });
};

function readItems(raw: unknown): { items: Map<string, string>; spellings: Record<string, string> } {
  const parsed = localizeResponseSchema.parse(raw ?? {});
  const items = new Map<string, string>();
  for (const x of parsed.items ?? []) {
    const r = itemSchema.safeParse(x);
    if (r.success && r.data.text.trim()) items.set(r.data.id, r.data.text.replace(/\s+/g, " ").trim());
  }
  const spellings: Record<string, string> = {};
  for (const x of parsed.spellings ?? []) {
    const r = spellingSchema.safeParse(x);
    if (r.success && r.data.spoken.trim()) spellings[r.data.id] = r.data.spoken.trim();
  }
  return { items, spellings };
}

/** Restore + measure one unit's translation; sets out / issue. */
function check(u: Unit, text: string | undefined, spoken: Record<string, string>, locale: LocaleId) {
  u.issue = undefined;
  if (!text) {
    u.issue = "no translation returned";
    return;
  }
  let restored: string;
  try {
    restored = restoreTerms(text, u.slots, spoken);
  } catch (err) {
    u.out = text;
    u.issue = `${err instanceof Error ? err.message : String(err)} — keep every token`;
    return;
  }
  const p = localeProfile(locale);
  if (p.script === "latin" && u.kind === "text" && u.source === u.source.toUpperCase()) restored = restored.replace(/\{[^}]*\}|[^{}]+/g, (s) => (s.startsWith("{") ? s : s.toUpperCase()));
  u.out = restored;
  const n = u.kind === "vo" ? spokenChars(restored) : shownChars(restored);
  if (n > u.limit) u.issue = `${n} letters, over the ${u.limit} limit${u.kind === "vo" ? ` (${u.windowSec} s beat)` : ""} — shorten`;
}

/**
 * Translate a run's frames into `locale`: ONE batched model call (+ one fix-up call only for lines that
 * run over their beat or lost a protected token). Throws when the translation call itself fails.
 */
export async function localizeFrames(frames: AssembleFrame[], locale: LocaleId, opts: LocalizeOptions = {}): Promise<LocalizedFrames> {
  const p = localeProfile(locale);
  const llm = opts.llm ?? defaultLlm;
  const terms = opts.terms ?? [];
  const spellingIds = new Map<string, string>();
  const units: Unit[] = [];
  const byKey = new Map<string, Unit>();
  const counters: Record<Kind, number> = { vo: 0, text: 0, fine: 0, cta: 0 };
  const PREFIX: Record<Kind, string> = { vo: "vo", text: "tx", fine: "fine", cta: "cta" };
  const unit = (kind: Kind, source: string | null | undefined, limit: (masked: string) => number, windowSec?: number) => {
    const text = (source ?? "").replace(/\s+/g, " ").trim();
    if (!text) return;
    const key = `${kind === "vo" ? "vo" : kind === "fine" ? "fine" : "text"}:${text}`;
    const had = byKey.get(key);
    if (had) {
      if (windowSec !== undefined && had.windowSec !== undefined && windowSec < had.windowSec) Object.assign(had, { windowSec, limit: maxSpokenChars(windowSec, locale) });
      return;
    }
    const { masked, slots } = protectTerms(text, terms, spellingIds);
    const u: Unit = { id: `${PREFIX[kind]}${counters[kind]++}`, kind, source: text, masked, slots, limit: limit(text), windowSec };
    byKey.set(key, u);
    units.push(u);
  };

  // Voiceover: one line per beat (consecutive frames repeat it); the window runs to the next line.
  const total = frames.reduce((m, f) => Math.max(m, f.endSec ?? 0), 0);
  const lines = planVoiceover(frames);
  lines.forEach((l, i) => {
    const windowSec = Math.round(((lines[i + 1]?.startSec ?? total) - l.startSec) * 100) / 100;
    unit("vo", l.text, () => maxSpokenChars(windowSec, locale), windowSec);
  });
  const textLimit = (min: number, ratio: number) => (s: string) => Math.max(min, Math.ceil(shownChars(s) * ratio));
  const cjk = p.script === "ja" || p.script === "zh" || p.script === "ko";
  for (const f of frames) unit("text", f.text, textLimit(cjk ? 6 : 12, p.textRatio));
  for (const f of frames) {
    const d = (f.endCard?.data ?? {}) as Record<string, unknown>;
    for (const k of ["headline", "tag", "sticker", "button"]) if (typeof d[k] === "string") unit("text", d[k] as string, textLimit(cjk ? 6 : 12, p.textRatio));
    unit("fine", f.fine, textLimit(40, Math.max(2.5, p.textRatio * 2)));
  }
  unit("cta", opts.ctaText, textLimit(cjk ? 6 : 12, Math.max(1.6, p.textRatio)));
  if (!units.length) throw new Error("Nothing to translate on this run");

  const spellings = [...spellingIds.entries()].map(([m, id]) => {
    const [, shown, spoken] = /\{([^{}|]+)\|([^{}]+)\}/.exec(m)!;
    return { id, shown: shown.trim(), spoken: spoken.trim() };
  });
  let first: ReturnType<typeof readItems>;
  try {
    first = readItems(await llm(translatePrompts(locale, units, spellings, false)));
  } catch (err) {
    throw new Error(`${locale} translation failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!first.items.size) throw new Error(`${locale} translation failed: the model returned no items`);
  const spoken = first.spellings;
  for (const u of units) check(u, first.items.get(u.id), spoken, locale);

  // One fix-up call for the lines that run long or lost a token.
  const notes: string[] = [];
  const bad = units.filter((u) => u.issue);
  if (bad.length) {
    try {
      const fix = readItems(await llm(translatePrompts(locale, bad, [], true)));
      for (const u of bad) {
        const before = { out: u.out, issue: u.issue };
        check(u, fix.items.get(u.id), spoken, locale);
        // A fix that broke a token is worse than a long line we can still trim.
        if (u.issue && /missing|unknown|no translation/.test(u.issue) && before.out && !/missing|unknown|no translation/.test(before.issue ?? "")) Object.assign(u, before);
      }
    } catch (err) {
      notes.push(`fix-up call failed (${err instanceof Error ? err.message.slice(0, 80) : String(err)})`);
    }
  }
  for (const u of units.filter((x) => x.issue)) {
    if (/missing|unknown|no translation/.test(u.issue!)) {
      notes.push(`${u.id}: ${u.issue!.replace(/ — .*$/, "")} — kept the source "${u.source.slice(0, 40)}"`);
      u.out = u.source;
      continue;
    }
    if (u.kind === "vo" && u.out) {
      const cut = trimToBudget(u.out, u.limit, locale);
      if (cut) {
        notes.push(`${u.id}: trimmed to fit its ${u.windowSec} s beat`);
        u.out = cut;
        continue;
      }
    }
    notes.push(`${u.id}: ${u.issue} (kept; ${u.kind === "vo" ? "the voice speeds up to 1.3×" : "wraps to more lines"})`);
  }

  const vo = new Map(units.filter((u) => u.kind === "vo").map((u) => [u.source, u.out ?? u.source]));
  const txt = new Map(units.filter((u) => u.kind === "text").map((u) => [u.source, u.out ?? u.source]));
  const fine = new Map(units.filter((u) => u.kind === "fine").map((u) => [u.source, u.out ?? u.source]));
  const sq = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
  const out = frames.map((f) => {
    const next: AssembleFrame = { ...f };
    if (sq(f.voiceover)) next.voiceover = vo.get(sq(f.voiceover)) ?? f.voiceover;
    if (sq(f.text)) next.text = txt.get(sq(f.text)) ?? f.text;
    if (sq(f.fine)) next.fine = fine.get(sq(f.fine)) ?? f.fine;
    if (f.endCard?.data) {
      const d = { ...(f.endCard.data as Record<string, unknown>) };
      for (const k of ["headline", "tag", "sticker", "button"]) if (typeof d[k] === "string") d[k] = txt.get(sq(d[k] as string)) ?? d[k];
      next.endCard = { ...f.endCard, data: d as never };
    }
    return next;
  });
  const cta = units.find((u) => u.kind === "cta");
  const fits: LineFit[] = units
    .filter((u) => u.kind === "vo")
    .map((u) => {
      const text = u.out ?? u.source;
      const estSec = estimateSpeechSec(text, locale);
      return { id: u.id, text, windowSec: u.windowSec ?? 0, estSec, ok: estSec <= (u.windowSec ?? 0) * FIT + 1e-9 };
    });
  return { locale, voice: voiceFor(locale, opts.gender), rtl: p.rtl, frames: out, ctaText: cta ? (cta.out ?? cta.source) : null, fits, notes };
}

/* ───────────────────────── run bookkeeping (pure) ───────────────────────── */

export interface LocaleEntry {
  locale: LocaleId;
  voice: string;
  masterUrl: string;
  previewUrl: string | null;
  durationSec: number;
  passed: number;
  total: number;
  adName: string;
  createdAt: string;
  fits: LineFit[];
  notes: string[];
}

/** A claim older than this was killed mid-render: render it again. */
const PENDING_STALE_MS = 8 * 60_000;

/** The requested locales a run still lacks (done ones only with `force`; fresh pending claims skipped). */
export function missingLocales(qc: { locales?: { locale: string }[]; localesPending?: Record<string, string> }, wanted: LocaleId[], now = Date.now(), force = false): LocaleId[] {
  const done = new Set((qc.locales ?? []).map((l) => l.locale));
  const pending = qc.localesPending ?? {};
  return [...new Set(wanted)].filter((l) => (force || !done.has(l)) && !(pending[l] && now - Date.parse(pending[l]) < PENDING_STALE_MS));
}

/** A/B-ready name for a localized version: <base>_esUS. */
export const localeAdName = (base: string, locale: LocaleId) => `${base}_${locale.replace("-", "")}`;
