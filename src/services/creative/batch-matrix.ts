/**
 * Batch Mode variant matrix (Creatify "Batch Mode"): one rendered master (or one campaign-plan
 * platform) × the dimensions hook · end card · CTA button · VO voice · music mood · aspect · duration
 * → a deterministic list of named variants.
 *
 * Selection is a full factorial (capped; the pairwise core goes first so a cap never loses coverage)
 * or a pairwise / all-pairs design (IPOG): every level of every factor appears and every pair of
 * levels across two factors shares at least one variant, with far fewer variants than the factorial.
 *
 * Cost: a variant that only re-edits the master (hook restyle q/c/p, the master's own hook, end card,
 * CTA, voice, music, aspect, cutdown) is compute only (≈ $0). A hook the master doesn't contain needs a
 * new hook clip (1 keyframe + 1 short clip): those variants are flagged `needsGeneration` and are never
 * rendered automatically. Pure — no I/O.
 */
import { MOOD_IDS, moodFromText as moodFromMoodText, type MoodId } from "@/services/video-gen/edit/music-moods";
import type { CampaignPlan, PlatformPlan } from "./campaign-plan.types";
import { findVideoModel, engineFor, imageCredits, videoCredits } from "@/services/video-gen/libtv-pricing";

// ─── Levels ─────────────────────────────────────────────────────────────────

export type BatchAspect = "9:16" | "4:5" | "1:1" | "16:9";
export const BATCH_ASPECTS: BatchAspect[] = ["9:16", "4:5", "1:1", "16:9"];
export const BATCH_DURATIONS = [6, 10, 15, 30] as const;
/** Moods the edit engine's music bed can synthesise ("auto" = the engine's own pick from the copy). */
export const MUSIC_MOODS = ["auto", ...MOOD_IDS] as const;
export type MusicMood = (typeof MUSIC_MOODS)[number];
/** Hook re-edit styles of the same clips (video-gen/variants.ts): question, contrast, product blast. */
export const RESTYLE_HOOKS = ["q", "c", "p"] as const;
/** Mirrors video-gen/edit/endcard-render.ts RENDERABLE_END_CARDS (kept here so this module stays pure). */
export const RE_EDIT_END_CARDS = ["E01", "E02", "E03", "E04", "E08", "E09", "E12"];
/** Mirrors video-gen/voiceover.ts DEFAULT_VOICE. */
export const DEFAULT_BATCH_VOICE = "en-US-AndrewMultilingualNeural";
/** Free Edge TTS voices offered for VO tests. */
export const EDGE_VOICES = [
  "en-US-AndrewMultilingualNeural",
  "en-US-AvaMultilingualNeural",
  "en-US-BrianMultilingualNeural",
  "en-US-EmmaMultilingualNeural",
  "en-US-JennyNeural",
  "en-US-GuyNeural",
  "en-US-AriaNeural",
  "en-US-ChristopherNeural",
  "en-GB-RyanNeural",
  "en-GB-SoniaNeural",
  "en-AU-NatashaNeural",
];
/** A re-edit costs only server compute; treated as $0. */
export const RE_EDIT_USD = 0;

export interface BatchDims {
  hooks?: string[];
  endCards?: string[];
  ctas?: string[];
  voices?: string[];
  musicMoods?: string[];
  aspects?: string[];
  durations?: number[];
}

export interface BatchLevels {
  hooks: string[];
  endCards: string[];
  ctas: string[];
  voices: string[];
  musicMoods: MusicMood[];
  aspects: BatchAspect[];
  durations: number[];
}

/** Factor order in the design (and in the name): most decisive first. */
const FACTORS = ["hooks", "endCards", "ctas", "voices", "musicMoods", "aspects", "durations"] as const;

export type BatchSource =
  | {
      kind: "run";
      brand?: string | null;
      title?: string | null;
      masterAspect: string;
      masterDurationSec: number;
      /** The master's hook style (qcReport.hookStyle, default q). */
      masterHookStyle?: string | null;
      /** The library hook the master opens with (when the run was made from a plan script). */
      masterHookId?: string | null;
      endCardId?: string | null;
      endCardButton?: string | null;
      /** Opening text per library hook id (from the campaign plan), used as the hook headline. */
      hookTexts?: Record<string, string>;
    }
  | { kind: "plan"; brand?: string | null; title?: string | null; plan: PlatformPlan };

export type HookKind = "restyle" | "master" | "new";
export type BatchVariantStatus = "planned" | "needs_generation" | "pending" | "rendered" | "failed";

export interface BatchVariant {
  id: string;
  name: string;
  hook: string;
  hookKind: HookKind;
  hookText?: string | null;
  endCard: string;
  cta: string;
  voice: string;
  music: MusicMood;
  aspect: BatchAspect;
  durationSec: number;
  needsGeneration: boolean;
  status: BatchVariantStatus;
  masterUrl?: string | null;
  previewUrl?: string | null;
  error?: string | null;
  pendingAt?: string | null;
  renderedAt?: string | null;
}

export interface BatchCoverage {
  pairsTotal: number;
  pairsCovered: number;
  levelsTotal: number;
  levelsCovered: number;
}

export interface BatchCost {
  unit: "usd" | "libtv-credits";
  reEditVariants: number;
  needsGenerationVariants: number;
  newHookClips: number;
  perHookClipUsd: number | null;
  perHookClipCredits: number;
  totalUsd: number | null;
  totalCredits: number;
  /** Generation cost is charged to the first variant that uses each new hook. */
  perVariant: { id: string; usd: number; credits: number }[];
  models: { imageModel: string; videoModel: string; hookSec: number };
}

export interface BatchMatrix {
  id: string;
  createdAt: string;
  source: "run" | "plan";
  platform?: string;
  design: "pairwise" | "full";
  maxVariants: number;
  levels: BatchLevels;
  coverage: BatchCoverage;
  variants: BatchVariant[];
  cost?: BatchCost;
  notes: string[];
}

// ─── Designs ────────────────────────────────────────────────────────────────

/** Every row of the mixed-radix factorial, first factor slowest. */
export function fullFactorial(counts: number[], cap = Infinity): number[][] {
  const out: number[][] = [];
  if (counts.some((c) => c <= 0)) return out;
  const row = counts.map(() => 0);
  while (out.length < cap) {
    out.push([...row]);
    let i = counts.length - 1;
    while (i >= 0 && ++row[i] >= counts[i]) row[i--] = 0;
    if (i < 0) break;
  }
  return out;
}

/**
 * Deterministic all-pairs design (IPOG, strength 2). Factors are processed largest first; each new
 * factor is added to the existing rows greedily (horizontal growth) and the pairs still uncovered get
 * new rows or fill don't-care slots (vertical growth). Don't-cares left at the end take a rotating
 * level so every level shows up evenly.
 */
export function pairwiseDesign(counts: number[]): number[][] {
  const n = counts.length;
  if (n === 0) return [[]];
  if (counts.some((c) => c <= 0)) return [];
  if (n === 1) return Array.from({ length: counts[0] }, (_, i) => [i]);
  // Largest factors first (stable), mapped back at the end.
  const order = counts.map((c, i) => ({ c, i })).sort((a, b) => b.c - a.c || a.i - b.i).map((x) => x.i);
  const k = order.map((i) => counts[i]);
  type Row = (number | null)[];
  const rows: Row[] = fullFactorial([k[0], k[1]]).map((r) => [...r, ...Array(n - 2).fill(null)]);

  for (let p = 2; p < n; p++) {
    // uncovered[j][a][b]: pair (factor j = a, factor p = b) still missing.
    const uncovered = new Set<string>();
    for (let j = 0; j < p; j++) for (let a = 0; a < k[j]; a++) for (let b = 0; b < k[p]; b++) uncovered.add(`${j}:${a}:${b}`);
    const gain = (r: Row, b: number) => {
      let g = 0;
      for (let j = 0; j < p; j++) if (r[j] !== null && uncovered.has(`${j}:${r[j]}:${b}`)) g++;
      return g;
    };
    const take = (r: Row) => {
      for (let j = 0; j < p; j++) if (r[j] !== null) uncovered.delete(`${j}:${r[j]}:${r[p]}`);
    };
    // Horizontal growth.
    for (const [ri, r] of rows.entries()) {
      if (ri < k[p]) r[p] = ri;
      else {
        let best = 0;
        let bestGain = -1;
        for (let b = 0; b < k[p]; b++) {
          const g = gain(r, b);
          if (g > bestGain) {
            best = b;
            bestGain = g;
          }
        }
        r[p] = best;
      }
      take(r);
    }
    // Vertical growth, in a fixed pair order.
    for (let j = 0; j < p; j++)
      for (let a = 0; a < k[j]; a++)
        for (let b = 0; b < k[p]; b++) {
          if (!uncovered.has(`${j}:${a}:${b}`)) continue;
          const slot = rows.find((r) => r[p] === b && r[j] === null);
          if (slot) slot[j] = a;
          else {
            const r: Row = Array(n).fill(null);
            r[j] = a;
            r[p] = b;
            rows.push(r);
          }
          uncovered.delete(`${j}:${a}:${b}`);
        }
  }
  // Fill don't-cares and map back to the caller's factor order.
  return rows.map((r, ri) => {
    const out = Array<number>(n);
    r.forEach((v, pos) => {
      out[order[pos]] = v ?? (ri + pos) % k[pos];
    });
    return out;
  });
}

export function coverageOf(rows: number[][], counts: number[]): BatchCoverage {
  let pairsTotal = 0;
  let pairsCovered = 0;
  for (let a = 0; a < counts.length; a++)
    for (let b = a + 1; b < counts.length; b++) {
      const seen = new Set(rows.map((r) => `${r[a]}:${r[b]}`));
      pairsTotal += counts[a] * counts[b];
      pairsCovered += seen.size;
    }
  let levelsCovered = 0;
  counts.forEach((_, f) => (levelsCovered += new Set(rows.map((r) => r[f])).size));
  return { pairsTotal, pairsCovered, levelsTotal: counts.reduce((s, c) => s + c, 0), levelsCovered };
}

// ─── Naming ─────────────────────────────────────────────────────────────────

/** Same slug as video-gen/variants.ts variantAdName (first 4 words, PascalCase, letters/digits only). */
function slug(t: string, words = 4): string {
  return t
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, words)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("")
    .replace(/[^A-Za-z0-9]/g, "");
}

/** en-US-AndrewMultilingualNeural → AndrewMultilingual. */
export function voiceSlug(voice: string): string {
  return slug(voice.replace(/^[a-z]{2,3}-[A-Z]{2,4}-/, "").replace(/Neural$/, ""), 1) || "Default";
}

/** The full Edge voice id for a name's voice slug (null when it isn't in the catalogue). */
export function voiceFromSlug(s: string, catalogue: string[] = EDGE_VOICES): string | null {
  return catalogue.find((v) => voiceSlug(v).toLowerCase() === s.toLowerCase()) ?? null;
}

/**
 * Batch ad name — the variants.ts convention (Brand_Script_{dur}s_Hook{X}) extended with the end card,
 * aspect, voice, music and CTA: TCL_QM7LSeriesTV_15s_HookH09_E04_4x5_VAndrewMultilingual_MPop_CShopNow.
 * Parsed back by performance/import.ts parseAdName.
 */
export function batchAdName(p: { brand?: string | null; title?: string | null; durationSec: number; hook: string; endCard: string; aspect: string; voice: string; music: string; cta: string }): string {
  const hook = /^H\d{2}$/i.test(p.hook) ? p.hook.toUpperCase() : p.hook.toUpperCase().slice(0, 1);
  return [
    slug(p.brand ?? "") || "Ad",
    slug((p.title ?? "").replace(/^⚠\s*/, "")) || "Script",
    `${Math.round(p.durationSec)}s`,
    `Hook${hook}`,
    p.endCard.toUpperCase(),
    p.aspect.replace(":", "x"),
    `V${voiceSlug(p.voice)}`,
    `M${slug(p.music, 1) || "Auto"}`,
    `C${(slug(p.cta, 4) || "Cta").slice(0, 16)}`,
  ].join("_");
}

// ─── Matrix ─────────────────────────────────────────────────────────────────

const isHookId = (h: string) => /^H\d{2}$/i.test(h);

export function moodFromText(text: string | null | undefined): MusicMood {
  const t = (text ?? "").toLowerCase().trim();
  if ((MUSIC_MOODS as readonly string[]).includes(t)) return t as MusicMood;
  // Seasonal wording wins (a "holiday pop" bed is the holiday bed); else the first mood the text names.
  if (/holiday|christmas|xmas|festive|gift|winter|black friday|cyber/.test(t)) return "holiday";
  return moodFromMoodText(t) ?? "auto";
}

const uniq = <T,>(xs: T[]) => [...new Set(xs)];

function resolveLevels(source: BatchSource, dims: BatchDims, notes: string[]): BatchLevels {
  const run = source.kind === "run" ? source : null;
  const plan = source.kind === "plan" ? source.plan : null;
  const masterDur = run ? run.masterDurationSec : plan!.durationSec;
  const masterAspect = (run ? run.masterAspect : plan!.aspect) as BatchAspect;

  let hooks = uniq((dims.hooks?.length ? dims.hooks : plan ? plan.hookVariants.map((h) => h.hookId) : [run?.masterHookStyle || "q"]).map((h) => (isHookId(h) ? h.toUpperCase() : h.toLowerCase())));
  const badHooks = hooks.filter((h) => !isHookId(h) && !(RESTYLE_HOOKS as readonly string[]).includes(h));
  if (badHooks.length) notes.push(`Dropped unknown hooks ${badHooks.join(", ")} (use q/c/p restyles or library ids H01–H35).`);
  hooks = hooks.filter((h) => !badHooks.includes(h));

  let endCards = uniq((dims.endCards?.length ? dims.endCards : plan ? [plan.endCard.id, ...plan.endCardAlternates.map((e) => e.id)] : [run?.endCardId || "E01"]).map((e) => e.toUpperCase()));
  const unrenderable = endCards.filter((e) => !RE_EDIT_END_CARDS.includes(e));
  if (unrenderable.length) notes.push(`Dropped end cards ${unrenderable.join(", ")} — the re-edit engine renders only ${RE_EDIT_END_CARDS.join("/")}.`);
  endCards = endCards.filter((e) => RE_EDIT_END_CARDS.includes(e));
  if (!endCards.length) endCards = ["E01"];

  const ctas = uniq((dims.ctas?.length ? dims.ctas : [plan?.endCard.button || run?.endCardButton || "Shop now"]).map((c) => c.trim()).filter(Boolean)).slice(0, 8);

  let voices = uniq(dims.voices?.length ? dims.voices : [DEFAULT_BATCH_VOICE]);
  const badVoices = voices.filter((v) => !/^[a-z]{2,3}-[A-Z]{2,4}-[A-Za-z]+Neural$/.test(v));
  if (badVoices.length) notes.push(`Dropped voices ${badVoices.join(", ")} — use Edge TTS ids like ${DEFAULT_BATCH_VOICE}.`);
  voices = voices.filter((v) => !badVoices.includes(v));
  if (!voices.length) voices = [DEFAULT_BATCH_VOICE];

  const musicMoods = uniq((dims.musicMoods?.length ? dims.musicMoods : [plan ? plan.musicMood : "auto"]).map(moodFromText));

  let aspects = uniq((dims.aspects?.length ? dims.aspects : [masterAspect]) as string[]) as BatchAspect[];
  const badAspects = aspects.filter((a) => !BATCH_ASPECTS.includes(a));
  if (badAspects.length) notes.push(`Dropped aspects ${badAspects.join(", ")}.`);
  aspects = aspects.filter((a) => BATCH_ASPECTS.includes(a));
  if (!aspects.length) aspects = [BATCH_ASPECTS.includes(masterAspect) ? masterAspect : "9:16"];

  let durations = uniq((dims.durations?.length ? dims.durations : [masterDur]).map((d) => Math.round(d)));
  const tooLong = durations.filter((d) => d > Math.round(masterDur) || d < 5);
  if (tooLong.length) notes.push(`Dropped ${tooLong.map((d) => `${d} s`).join(", ")} — a cutdown can't be longer than the ${Math.round(masterDur)} s master (or under 5 s).`);
  durations = durations.filter((d) => !tooLong.includes(d));
  if (!durations.length) durations = [Math.round(masterDur)];

  if (!hooks.length) hooks = [run?.masterHookStyle || "q"];
  return { hooks, endCards, ctas, voices, musicMoods, aspects, durations };
}

export interface BuildBatchInput {
  source: BatchSource;
  dims: BatchDims;
  design: "pairwise" | "full";
  maxVariants: number;
  /** Fixed clock for ids (tests). */
  now?: string;
}

export function buildBatchMatrix(input: BuildBatchInput): BatchMatrix {
  const notes: string[] = [];
  const levels = resolveLevels(input.source, input.dims, notes);
  const counts = FACTORS.map((f) => levels[f].length);
  const max = Math.max(1, Math.min(500, Math.floor(input.maxVariants)));
  const total = counts.reduce((a, b) => a * b, 1);

  let rows: number[][];
  if (input.design === "full") {
    if (total <= max) rows = fullFactorial(counts);
    else {
      // Pairwise core first, then more factorial rows up to the cap.
      const core = pairwiseDesign(counts);
      const seen = new Set(core.map((r) => r.join(",")));
      rows = [...core];
      for (const r of fullFactorial(counts)) {
        if (rows.length >= max) break;
        if (!seen.has(r.join(","))) rows.push(r);
      }
      notes.push(`Full factorial is ${total} variants; capped at ${max} (pairwise core first).`);
    }
  } else rows = pairwiseDesign(counts);
  if (rows.length > max) {
    notes.push(`Design needs ${rows.length} variants for full pair coverage; truncated to maxVariants ${max}.`);
    rows = rows.slice(0, max);
  }

  const src = input.source;
  const masterHookId = src.kind === "run" ? (src.masterHookId?.toUpperCase() ?? null) : null;
  const hookTexts: Record<string, string> =
    src.kind === "run" ? (src.hookTexts ?? {}) : Object.fromEntries(src.plan.hookVariants.map((h) => [h.hookId, h.openingText]));

  const variants: BatchVariant[] = rows.map((r, i) => {
    const pick = <F extends (typeof FACTORS)[number]>(f: F) => levels[f][r[FACTORS.indexOf(f)]] as BatchLevels[F][number];
    const hook = pick("hooks") as string;
    const hookKind: HookKind = !isHookId(hook) ? "restyle" : hook === masterHookId ? "master" : "new";
    const v = {
      hook,
      endCard: pick("endCards") as string,
      cta: pick("ctas") as string,
      voice: pick("voices") as string,
      music: pick("musicMoods") as MusicMood,
      aspect: pick("aspects") as BatchAspect,
      durationSec: pick("durations") as number,
    };
    const needsGeneration = hookKind === "new";
    return {
      id: `v${String(i + 1).padStart(3, "0")}`,
      name: batchAdName({ brand: src.brand, title: src.title, ...v }),
      hookKind,
      hookText: isHookId(hook) ? (hookTexts[hook] ?? null) : null,
      ...v,
      needsGeneration,
      status: needsGeneration ? "needs_generation" : "planned",
    };
  });
  if (variants.some((v) => v.needsGeneration)) notes.push("Variants with a new library hook need a new hook clip — they are marked needs_generation and are not rendered automatically.");

  const createdAt = input.now ?? new Date().toISOString();
  return {
    id: `b${Date.parse(createdAt).toString(36)}`,
    createdAt,
    source: src.kind,
    platform: src.kind === "plan" ? src.plan.platform : undefined,
    design: input.design,
    maxVariants: max,
    levels,
    coverage: coverageOf(rows, counts),
    variants,
    notes,
  };
}

/** The platform plan a batch starts from (first platform when none is named). */
export function planPlatform(plan: CampaignPlan | null | undefined, platform?: string | null): PlatformPlan | null {
  if (!plan?.platforms?.length) return null;
  return (platform ? plan.platforms.find((p) => p.platform === platform) : null) ?? plan.platforms[0];
}

// ─── Cost ───────────────────────────────────────────────────────────────────

/**
 * $ per variant. Re-edits are compute only ($0). A new hook clip = 1 keyframe + 1 clip of hookSec on
 * the run's models, priced with the pricing catalogue: OpenRouter / Matrix credits are US cents, the
 * free engines (GLM, ComfyUI, animatic) cost $0, LibTV is reported in its own credits.
 */
export function estimateBatchCost(variants: BatchVariant[], models: { imageModel: string; videoModel: string; hookSec?: number }): BatchCost {
  const hookSec = models.hookSec ?? 3;
  const engine = engineFor(models.videoModel);
  const free = engine === "glm" || engine === "comfyui" || engine === "animatic";
  const credits = free ? 0 : imageCredits(models.imageModel) + videoCredits(models.videoModel, hookSec, findVideoModel(models.videoModel)?.defaultResolution);
  const usdPerCredit = free ? 0 : engine === "openrouter" || engine === "matrix" ? 0.01 : null;
  const charged = new Set<string>();
  const perVariant = variants.map((v) => {
    if (!v.needsGeneration || charged.has(v.hook)) return { id: v.id, usd: RE_EDIT_USD, credits: 0 };
    charged.add(v.hook);
    return { id: v.id, usd: usdPerCredit === null ? 0 : credits * usdPerCredit, credits };
  });
  const totalCredits = perVariant.reduce((s, p) => s + p.credits, 0);
  return {
    unit: usdPerCredit === null ? "libtv-credits" : "usd",
    reEditVariants: variants.filter((v) => !v.needsGeneration).length,
    needsGenerationVariants: variants.filter((v) => v.needsGeneration).length,
    newHookClips: charged.size,
    perHookClipUsd: usdPerCredit === null ? null : Math.round(credits * usdPerCredit * 10000) / 10000,
    perHookClipCredits: credits,
    totalUsd: usdPerCredit === null ? null : Math.round(totalCredits * usdPerCredit * 10000) / 10000,
    totalCredits,
    perVariant,
    models: { imageModel: models.imageModel, videoModel: models.videoModel, hookSec },
  };
}

// ─── Render inputs ──────────────────────────────────────────────────────────

type EndCardFrame = { segment?: string | null; endCard?: { id: string; data: object } | null };

export interface VariantRenderParams<F> {
  hookStyle: "q" | "c" | "p";
  hookText: string | null;
  outputAspect?: string;
  cutdownSec?: number;
  voice: string;
  musicMood?: MoodId;
  ctaText: string;
  frames: F[];
}

/**
 * The re-edit inputs for one variant (glm-assemble renderFromRun): hook style/text, aspect, cutdown,
 * voice, music, and the frames with the variant's end card + button on the CTA frame. Throws for a
 * variant that needs a new hook clip.
 */
export function renderParamsFor<F extends EndCardFrame>(v: BatchVariant, master: { masterAspect: string; masterDurationSec: number; masterHookStyle?: string | null }, frames: F[]): VariantRenderParams<F> {
  if (v.needsGeneration) throw new Error(`Variant ${v.id} (${v.hook}) needs a new hook clip — generate it first; batch renders only re-edit the master.`);
  const masterStyle = (["q", "c", "p"].includes(master.masterHookStyle ?? "") ? master.masterHookStyle : "q") as "q" | "c" | "p";
  const hookStyle = v.hookKind === "restyle" ? (v.hook as "q" | "c" | "p") : masterStyle;
  let target = -1;
  frames.forEach((f, i) => {
    if (f.endCard?.id) target = i;
  });
  if (target < 0) {
    frames.forEach((f, i) => {
      if ((f.segment ?? "").toUpperCase() === "CTA") target = i;
    });
  }
  if (target < 0) target = frames.length - 1;
  const out = frames.map((f, i) => (i === target ? ({ ...f, endCard: { id: v.endCard, data: { ...(f.endCard?.data ?? {}), button: v.cta } } } as F) : f));
  return {
    hookStyle,
    hookText: v.hookText ?? null,
    outputAspect: v.aspect !== master.masterAspect ? v.aspect : undefined,
    cutdownSec: v.durationSec < Math.round(master.masterDurationSec) ? v.durationSec : undefined,
    voice: v.voice,
    musicMood: v.music === "auto" ? undefined : v.music,
    ctaText: v.cta,
    frames: out,
  };
}

// ─── Queue ──────────────────────────────────────────────────────────────────

/** A pending claim older than this was killed mid-render: it can be claimed again. */
export const BATCH_PENDING_STALE_MS = 8 * 60_000;

/**
 * The next free re-edit variants to render, in matrix order: planned ones and stale pending claims.
 * Rendered, failed (retry by re-planning) and needs_generation variants are never picked.
 */
export function claimableVariants(variants: BatchVariant[], limit: number, now = Date.now()): BatchVariant[] {
  return variants
    .filter((v) => !v.needsGeneration && (v.status === "planned" || (v.status === "pending" && (!v.pendingAt || now - Date.parse(v.pendingAt) >= BATCH_PENDING_STALE_MS))))
    .slice(0, Math.max(0, limit));
}
