/**
 * Cost model — one price table per engine and model, and a line-item forecast for a run.
 *
 * Every paid call the product makes is priced here: video clips (per second, with each model's billing
 * quirks), keyframe stills and edits (per image), vision QC (per call, from token estimates), text LLM
 * calls (per 1k tokens) and TTS (free). Each price records where it came from and when, so a stale
 * number is visible. The table is overridable from settings JSON (AppSetting "ops.prices", or env
 * CI_PRICE_OVERRIDES) — see mergePriceOverrides.
 *
 * Seeds come from the constants already in the codebase: the measured OpenRouter / Matrix notes and
 * cent prices in video-gen/libtv-pricing.ts, LIST_PRICES in ai/usage-core.ts, Kling's 5 s minimum
 * (locked-script.ts anchorPlan) and Veo 3.1 Lite's 4 / 6 / 8 s durations.
 *
 * Pure: no I/O. estimateRunCost answers "what will this run cost, worst case included" BEFORE money is
 * spent, so the approved budget covers QC and rerolls, not just the clips.
 */
import { z } from "zod";
import {
  ACTION_VIDEO_MODEL,
  findImageModel,
  findVideoModel,
  framesPerClip,
  groupFrames,
  imageCredits,
  imageSettings,
  OPENROUTER_IMAGE_MODEL,
  OPENROUTER_VIDEO_MODEL,
  videoCredits,
  videoSettings,
} from "@/services/video-gen/libtv-pricing";
import { lockedDrafts, type LockedFrame } from "@/services/video-gen/locked-script";

export const PRICES_AS_OF = "2026-10-06";

export interface PriceMeta {
  /** Where the number came from (measured bill, list price, estimate). */
  source: string;
  /** YYYY-MM-DD the price was recorded. */
  asOf: string;
  verified?: boolean;
}
export interface VideoPrice extends PriceMeta {
  perSec: number;
  /** Shorter clips are billed as this many seconds (Kling: 5). */
  minBillSec?: number;
  /** The only durations the model renders; a request snaps up to the next one (Veo: 4 / 6 / 8). */
  durations?: number[];
}
export interface ImagePrice extends PriceMeta {
  perImage: number;
}
export interface TokenPrice extends PriceMeta {
  inPer1k: number;
  outPer1k: number;
}
export interface FlatPrice extends PriceMeta {
  perCall: number;
}
/** Token estimate for one keyframe vision-QC call (keyframe-qc.ts). */
export interface QcTokenModel extends PriceMeta {
  /** System prompt + shot text. */
  promptTokens: number;
  /** Per image sent (the keyframe, then up to 3 references). */
  perImageTokens: number;
  outputTokens: { low: number; expected: number; high: number };
  /** Model priced when the caller doesn't know which vision engine will answer. */
  defaultModel: string;
}

export interface PriceTable {
  video: Record<string, VideoPrice>;
  image: Record<string, ImagePrice>;
  llm: Record<string, TokenPrice>;
  tts: Record<string, FlatPrice>;
  qc: QcTokenModel;
  /** Applied to a paid model missing from the table (conservative, flagged in warnings). */
  fallback: { videoPerSec: number; perImage: number; llm: string };
}

const LP = "ai/usage-core.ts LIST_PRICES (public list price)";
const tok = (inPerM: number, outPerM: number, source: string, asOf = PRICES_AS_OF, verified = false): TokenPrice => ({
  inPer1k: inPerM / 1000,
  outPer1k: outPerM / 1000,
  source,
  asOf,
  verified,
});

export const DEFAULT_PRICES: PriceTable = {
  video: {
    "google/veo-3.1-lite": { perSec: 0.03, durations: [4, 6, 8], source: "libtv-pricing.ts Veo 3.1 Lite — measured: a 4 s 720p clip cost 11.9¢", asOf: "2026-10-04", verified: true },
    "google/veo-3.1-lite@1080p": { perSec: 0.05, durations: [4, 6, 8], source: "libtv-pricing.ts Veo 3.1 Lite 1080P row (20¢ / 4 s)", asOf: PRICES_AS_OF },
    "alibaba/wan-3.0": { perSec: 0.1, source: "libtv-pricing.ts Wan 3.0 note (10¢/s, estimate)", asOf: PRICES_AS_OF },
    "kwaivgi/kling-v3.0-std": { perSec: 0.0832, minBillSec: 5, source: "libtv-pricing.ts Kling 3.0 — measured: a 3 s clip billed as 5 s (41.6¢)", asOf: PRICES_AS_OF, verified: true },
    "bytedance/seedance-2.0-fast": { perSec: 0.09, source: "libtv-pricing.ts Seedance 2.0 Fast OpenRouter note (~45¢ / 5 s, estimate)", asOf: PRICES_AS_OF },
    "doubao/seedance-2.0-fast-720p": { perSec: 0.05, source: "libtv-pricing.ts Matrix Seedance 2.0 Fast (~25¢ / 5 s, estimate)", asOf: PRICES_AS_OF },
    "doubao/seedance-2.0-pro-1080p": { perSec: 0.14, source: "libtv-pricing.ts Matrix Seedance 2.0 Pro (~70¢ / 5 s, estimate)", asOf: PRICES_AS_OF },
    "doubao/seedance-2.5-pro-1080p": { perSec: 0.18, source: "libtv-pricing.ts Matrix Seedance 2.5 Pro (~90¢ / 5 s, estimate)", asOf: PRICES_AS_OF },
  },
  image: {
    "bytedance-seed/seedream-5-0-flash": { perImage: 0.018, source: "libtv-pricing.ts Seedream 5 Flash — measured 1.8¢ a still (edits with references same price)", asOf: "2026-10-04", verified: true },
    "qwen/qwen-image-3": { perImage: 0.03, source: "libtv-pricing.ts Qwen-Image 3 note (3¢)", asOf: PRICES_AS_OF },
    "qwen/qwen-image": { perImage: 0.02, source: "libtv-pricing.ts Matrix Qwen-Image (~2¢, estimate)", asOf: PRICES_AS_OF },
    "doubao/seedream-4.5": { perImage: 0.04, source: "libtv-pricing.ts Matrix Seedream 4.5 (~4¢, estimate)", asOf: PRICES_AS_OF },
    "gpt-image-1": { perImage: 0.042, source: LP, asOf: PRICES_AS_OF },
  },
  llm: {
    "gemini-2.5-flash": tok(0.3, 2.5, LP),
    "gemini-2.5-pro": tok(1.25, 10, LP),
    "gpt-4o": tok(2.5, 10, LP),
    "gpt-4o-mini": tok(0.15, 0.6, LP),
    "gpt-4.1": tok(2, 8, LP),
    "gpt-4.1-mini": tok(0.4, 1.6, LP),
    "claude-sonnet-4-5": tok(3, 15, LP),
    "claude-haiku-4-5": tok(1, 5, LP),
    "glm-4-air-250414": tok(0.07, 0.07, LP),
    "glm-4.6v-flashx": tok(0.04, 0.42, LP),
    "glm-4.7-flash": tok(0, 0, "Zhipu free tier (ai/zhipu.ts ZHIPU_FREE)"),
    "glm-4.6v-flash": tok(0, 0, "Zhipu free tier (ai/zhipu.ts ZHIPU_FREE)"),
    "deepseek/deepseek-v4-flash": tok(0.27, 1.1, "estimate (DeepSeek V3 list price) — verify against the OpenRouter bill"),
    "deepseek/deepseek-v4-pro": tok(0.55, 2.19, "estimate (DeepSeek R1 list price) — verify against the OpenRouter bill"),
  },
  tts: {
    "msedge-tts": { perCall: 0, source: "msedge-tts (free Edge read-aloud voices, video-gen/voiceover.ts)", asOf: PRICES_AS_OF, verified: true },
  },
  qc: {
    // Calibrated 2026-10-07 on the NXTPAPER 14 test run: 48 consistency/QC calls billed $0.442
    // (≈ $0.0092 a call) — thinking output dominates; the first estimate was 3.2× low.
    promptTokens: 700,
    perImageTokens: 1100,
    outputTokens: { low: 800, expected: 3000, high: 5000 },
    defaultModel: "google/gemini-2.5-flash",
    source:
      "token estimate: keyframe-qc.ts system + identity prompt (~600 tokens) + shot text; Gemini bills 258 tokens per ≤768 px tile (512 px keyframe ≈ 1–2 tiles); 2.5 models bill thinking as output",
    asOf: PRICES_AS_OF,
  },
  fallback: { videoPerSec: 0.15, perImage: 0.05, llm: "gemini-2.5-pro" },
};

// ─── lookups ─────────────────────────────────────────────────────────────────

/** Free engines: Zhipu Flash models, self-hosted ComfyUI, the animatic, Pollinations. */
const FREE_MODEL = /cogvideox-flash|cogview-3-flash|comfyui|animatic|pollinations|^glm-4\.\d+v?-flash$/i;
const FREE_ENGINES = new Set(["glm", "comfyui", "animatic"]);

/** Catalogue names ("Veo 3.1 Lite 720p (OpenRouter)") → the provider model id they render with. */
function catalogueId(name: string, modality: "image" | "video"): { id: string | null; free: boolean } {
  const m = modality === "image" ? findImageModel(name) : findVideoModel(name);
  if (!m) return { id: null, free: false };
  const id = m.openrouterModel ?? m.matrixModel ?? ("zhipuModel" in m ? m.zhipuModel : undefined) ?? null;
  return { id, free: !id && FREE_ENGINES.has(m.engine ?? "libtv") };
}

function lookup<T>(group: Record<string, T>, id: string): T | undefined {
  if (group[id]) return group[id];
  const lower = id.toLowerCase();
  const bare = lower.split("/").pop()!;
  for (const [k, v] of Object.entries(group)) {
    const kl = k.toLowerCase();
    if (kl === lower || kl === bare || kl.split("/").pop() === bare) return v;
  }
  return undefined;
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

export interface PriceResult {
  usd: number | null;
  /** Priced with the conservative fallback (model not in the table). */
  fallback?: boolean;
  free?: boolean;
  source: string;
}

export function videoCostUsd(table: PriceTable, model: string, durationSec: number, resolution?: string | null): PriceResult & { billedSec: number } {
  const cat = catalogueId(model, "video");
  const id = cat.id ?? model;
  if (cat.free || FREE_MODEL.test(id)) return { usd: 0, free: true, billedSec: durationSec, source: "free engine" };
  const hi = /1080/i.test(resolution ?? "") || /1080/i.test(model);
  const p = (hi && lookup(table.video, `${id}@1080p`)) || lookup(table.video, id);
  if (!p) {
    return { usd: round(table.fallback.videoPerSec * durationSec), fallback: true, billedSec: durationSec, source: "fallback price (model not in the table)" };
  }
  let billed = Math.max(durationSec, p.minBillSec ?? 0);
  if (p.durations?.length) billed = [...p.durations].sort((a, b) => a - b).find((d) => d >= billed - 1e-6) ?? Math.max(...p.durations);
  return { usd: round(p.perSec * billed), billedSec: billed, source: `${p.source} (${p.asOf})` };
}

export function imageCostUsd(table: PriceTable, model: string): PriceResult {
  const cat = catalogueId(model, "image");
  const id = cat.id ?? model;
  if (cat.free || FREE_MODEL.test(id)) return { usd: 0, free: true, source: "free engine" };
  const p = lookup(table.image, id);
  if (!p) return { usd: table.fallback.perImage, fallback: true, source: "fallback price (model not in the table)" };
  return { usd: p.perImage, source: `${p.source} (${p.asOf})` };
}

export function llmCostUsd(table: PriceTable, model: string, inTokens: number, outTokens: number): PriceResult {
  if (FREE_MODEL.test(model.split("/").pop() ?? "")) return { usd: 0, free: true, source: "free engine" };
  const p = lookup(table.llm, model);
  const price = p ?? table.llm[table.fallback.llm];
  const usd = round((inTokens / 1000) * price.inPer1k + (outTokens / 1000) * price.outPer1k);
  return p ? { usd, source: `${p.source} (${p.asOf})` } : { usd, fallback: true, source: `fallback: priced as ${table.fallback.llm}` };
}

/** One keyframe vision-QC call: the keyframe plus `refImages` references. */
export function qcCallUsd(table: PriceTable, model: string | null | undefined, refImages: number, level: "low" | "expected" | "high"): number {
  const q = table.qc;
  const input = q.promptTokens + q.perImageTokens * (1 + Math.min(3, Math.max(0, refImages)));
  return llmCostUsd(table, model || q.defaultModel, input, q.outputTokens[level]).usd ?? 0;
}

// ─── overrides ───────────────────────────────────────────────────────────────

const metaPart = { source: z.string().max(300).optional(), asOf: z.string().max(20).optional(), verified: z.boolean().optional() };
const num = z.number().finite().nonnegative();
const overrideSchemas = {
  video: z.object({ perSec: num.optional(), minBillSec: num.optional(), durations: z.array(num).max(20).optional(), ...metaPart }),
  image: z.object({ perImage: num.optional(), ...metaPart }),
  llm: z.object({ inPer1k: num.optional(), outPer1k: num.optional(), ...metaPart }),
  tts: z.object({ perCall: num.optional(), ...metaPart }),
} as const;
const required: Record<keyof typeof overrideSchemas, string[]> = { video: ["perSec"], image: ["perImage"], llm: ["inPer1k", "outPer1k"], tts: ["perCall"] };

/**
 * Settings JSON on top of the table: `{ video: { "<model id>": { perSec, source?, asOf? } }, image: {...},
 * llm: {...}, tts: {...}, qc: {...} }`. Malformed entries are ignored; the base table is never mutated.
 */
export function mergePriceOverrides(base: PriceTable, raw: unknown, today = new Date().toISOString().slice(0, 10)): PriceTable {
  const out: PriceTable = {
    video: { ...base.video },
    image: { ...base.image },
    llm: { ...base.llm },
    tts: { ...base.tts },
    qc: { ...base.qc, outputTokens: { ...base.qc.outputTokens } },
    fallback: { ...base.fallback },
  };
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  for (const group of Object.keys(overrideSchemas) as (keyof typeof overrideSchemas)[]) {
    const entries = r[group];
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) continue;
    for (const [id, value] of Object.entries(entries as Record<string, unknown>)) {
      const parsed = overrideSchemas[group].safeParse(value);
      if (!parsed.success) continue;
      const prev = (out[group] as Record<string, object>)[id];
      const merged = { ...(prev ?? {}), ...parsed.data } as Record<string, unknown>;
      if (required[group].some((k) => typeof merged[k] !== "number")) continue;
      merged.source = parsed.data.source ?? `settings override (ops.prices)${prev ? "" : ", new model"}`;
      merged.asOf = parsed.data.asOf ?? today;
      (out[group] as Record<string, unknown>)[id] = merged;
    }
  }
  const qc = z
    .object({ promptTokens: num.optional(), perImageTokens: num.optional(), defaultModel: z.string().optional(), outputTokens: z.object({ low: num, expected: num, high: num }).optional(), ...metaPart })
    .safeParse(r.qc);
  if (qc.success && r.qc) out.qc = { ...out.qc, ...qc.data, source: qc.data.source ?? "settings override (ops.prices)", asOf: qc.data.asOf ?? today } as QcTokenModel;
  return out;
}

// ─── run forecast ────────────────────────────────────────────────────────────

export type CostLineKind = "cast" | "keyframe" | "end_keyframe" | "reroll" | "video" | "qc" | "llm" | "tts";
export interface Range {
  low: number;
  expected: number;
  high: number;
}
export interface CostLine {
  kind: CostLineKind;
  label: string;
  model: string;
  qty: Range;
  unitUsd: number;
  usd: Range;
  source: string;
}
export interface CostJob {
  nodeName: string;
  kind: string;
  modelName?: string | null;
  settings?: Record<string, unknown> | null | unknown;
  status?: string | null;
  creditsEstimated?: number | null;
  leftRefs?: unknown;
}
export type RunCostInput =
  | { executor?: string | null; clipDurationSec?: number | null; jobs: CostJob[] }
  | { lockedFrames: LockedFrame[]; imageModel?: string; executor?: string | null };

export interface LlmCallEstimate {
  label: string;
  model: string;
  inTokens: number;
  outTokens: number;
  calls: Range;
}
export interface EstimateOptions {
  prices?: PriceTable;
  qc?: {
    enabled?: boolean;
    /** Chance a QC review rejects a keyframe (each reroll is reviewed again). Default 0.25. */
    rerollRate?: number;
    /** Reroll cap for plain keyframes (keyframe-qc MAX_KEYFRAME_REROLLS, default 1). */
    maxRerolls?: number;
    /** Reroll cap for keyframes edited from references (server-executor: at least 2). */
    strictMaxRerolls?: number;
    model?: string;
  };
  /** Only jobs not yet completed / skipped / failed (a run in progress). */
  remainingOnly?: boolean;
  llm?: LlmCallEstimate[];
}
export interface RunCostForecast {
  lines: CostLine[];
  totals: Range;
  counts: {
    castSheets: number;
    keyframes: number;
    endKeyframes: number;
    otherImages: number;
    clips: number;
    qcCalls: Range;
    rerolls: { expected: number; worst: number };
  };
  warnings: string[];
  pricesAsOf: string;
}

/** Expected rerolls of one keyframe when each review fails with probability p, capped at max. */
export function expectedRerolls(p: number, max: number): number {
  let e = 0;
  for (let k = 1; k <= max; k++) e += Math.pow(p, k);
  return e;
}

const TERMINAL = new Set(["completed", "skipped", "failed"]);
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

/** The provider model a job renders with (job settings win over the catalogue name). */
export function jobModel(job: Pick<CostJob, "kind" | "modelName" | "settings">): string {
  const s = (job.settings ?? {}) as Record<string, unknown>;
  return str(s.openrouterModel) ?? str(s.matrixModel) ?? (job.kind === "video" ? str(s.zhipuModel) : undefined) ?? job.modelName ?? "unknown";
}

/** Engines whose job credits are US cents (libtv-pricing: OpenRouter, Matrix, paid Zhipu). */
function centsJob(executor: string | null | undefined, job: CostJob): boolean {
  const s = (job.settings ?? {}) as Record<string, unknown>;
  return executor === "openrouter" || executor === "matrix" || !!s.openrouterModel || !!s.matrixModel || !!s.zhipuModel;
}

/** USD for one image / clip job (null = not priceable: LibTV credits). */
export function jobUnitUsd(table: PriceTable, job: CostJob, executor?: string | null, clipDurationSec?: number | null): PriceResult & { billedSec?: number } {
  const s = (job.settings ?? {}) as Record<string, unknown>;
  const model = jobModel(job);
  const cents = centsJob(executor, job);
  if (!cents && (executor ?? "libtv") === "libtv") return { usd: null, source: "LibTV credits (prepaid membership, not billed per call)" };
  // A free engine's own models (no paid model id on the job) cost nothing, whatever the job's display name.
  if (!cents && FREE_ENGINES.has(executor ?? "")) return { usd: 0, free: true, source: "free engine" };
  const priced =
    job.kind === "video"
      ? videoCostUsd(table, model, Number(s.duration) || Number(clipDurationSec) || 5, str(s.resolution))
      : imageCostUsd(table, model);
  // A model missing from the table but carrying a cents estimate (Matrix, paid Zhipu): trust the estimate.
  if (priced.fallback && cents && (job.creditsEstimated ?? 0) > 0) return { usd: (job.creditsEstimated ?? 0) / 100, source: "job credit estimate (US cents)" };
  return priced;
}

function lockedToJobs(input: { lockedFrames: LockedFrame[]; imageModel?: string }): CostJob[] {
  const imageModel = input.imageModel ?? OPENROUTER_IMAGE_MODEL;
  const veo = (resolution: string) => ({ modelName: OPENROUTER_VIDEO_MODEL, settings: videoSettings(OPENROUTER_VIDEO_MODEL, { durationSec: 4, resolution }), credits: videoCredits(OPENROUTER_VIDEO_MODEL, 4, resolution) });
  // Mirrors libtv-compile's locked-script branch.
  const { drafts } = lockedDrafts(input.lockedFrames, {
    imageModel,
    imgSettings: imageSettings(imageModel, { aspectRatio: "9:16" }),
    imageCredits: imageCredits(imageModel),
    video: (engine) =>
      engine === "kling"
        ? { modelName: ACTION_VIDEO_MODEL, settings: videoSettings(ACTION_VIDEO_MODEL, { durationSec: 5 }), credits: videoCredits(ACTION_VIDEO_MODEL, 5, "720P") }
        : veo(engine === "veo1080" ? "1080P" : "720P"),
  });
  return drafts;
}

/**
 * Line-item forecast for a compiled run (its jobs) or a locked script (its frames): keyframes, end
 * keyframes K<n>E, cast sheet, QC rerolls (expected and worst case from the reroll caps), clips, QC
 * calls and LLM calls, with low / expected / high totals.
 */
export function estimateRunCost(input: RunCostInput, opts: EstimateOptions = {}): RunCostForecast {
  const table = opts.prices ?? DEFAULT_PRICES;
  const executor = "jobs" in input ? (input.executor ?? null) : (input.executor ?? "openrouter");
  const clipSec = "jobs" in input ? input.clipDurationSec : null;
  const all = "jobs" in input ? input.jobs : lockedToJobs(input);
  const jobs = opts.remainingOnly ? all.filter((j) => !TERMINAL.has(j.status ?? "")) : all;
  const qcOn = (opts.qc?.enabled ?? true) && executor !== "animatic";
  const p = opts.qc?.rerollRate ?? 0.25;
  const maxPlain = opts.qc?.maxRerolls ?? 1;
  const maxStrict = opts.qc?.strictMaxRerolls ?? Math.max(2, maxPlain);
  const qcModel = opts.qc?.model ?? table.qc.defaultModel;
  const warnings = new Set<string>();
  const groups = new Map<string, CostLine & { nodes: string[] }>();

  const add = (kind: CostLineKind, title: string, model: string, unit: number, qty: Range, source: string, node?: string) => {
    const key = `${kind}|${model}|${unit}`;
    const g = groups.get(key) ?? { kind, label: title, model, qty: { low: 0, expected: 0, high: 0 }, unitUsd: unit, usd: { low: 0, expected: 0, high: 0 }, source, nodes: [] };
    g.qty.low += qty.low;
    g.qty.expected += qty.expected;
    g.qty.high += qty.high;
    if (node) g.nodes.push(node);
    groups.set(key, g);
  };

  const counts: RunCostForecast["counts"] = { castSheets: 0, keyframes: 0, endKeyframes: 0, otherImages: 0, clips: 0, qcCalls: { low: 0, expected: 0, high: 0 }, rerolls: { expected: 0, worst: 0 } };

  for (const j of jobs) {
    if (j.kind !== "image" && j.kind !== "video") continue;
    const s = (j.settings ?? {}) as Record<string, unknown>;
    if (j.kind === "image" && s.compositeLocally) continue;
    const price = jobUnitUsd(table, j, executor, clipSec);
    if (price.usd === null) {
      warnings.add("LibTV jobs are paid in LibTV credits, not dollars — they are not in the USD totals.");
      continue;
    }
    if (price.fallback) warnings.add(`${jobModel(j)} is not in the price table — priced at the conservative fallback; add it to ops.prices.`);
    const model = jobModel(j);
    if (j.kind === "video") {
      counts.clips++;
      const label = price.billedSec ? `Video clips (${price.billedSec} s billed)` : "Video clips";
      add("video", label, model, price.usd, { low: 1, expected: 1, high: 1 }, price.source, j.nodeName);
      continue;
    }
    const kind: CostLineKind = j.nodeName === "CAST" || s.castSheet ? "cast" : /^K\d+E$/.test(j.nodeName) || s.editFrom === "end" ? "end_keyframe" : "keyframe";
    if (kind === "cast") counts.castSheets++;
    else if (kind === "end_keyframe") counts.endKeyframes++;
    else if (/^K\d+$/.test(j.nodeName)) counts.keyframes++;
    else counts.otherImages++;
    const title = kind === "cast" ? "Casting reference sheet" : kind === "end_keyframe" ? "End keyframes K<n>E" : "Keyframes";
    add(kind, title, model, price.usd, { low: 1, expected: 1, high: 1 }, price.source, j.nodeName);
    if (!qcOn || price.free) continue;
    // Reference-edited keyframes are also identity-checked, with the strict reroll cap.
    const refs = Array.isArray(j.leftRefs) ? j.leftRefs.length : 0;
    const cap = s.editFrom && refs ? maxStrict : maxPlain;
    const exp = expectedRerolls(p, cap);
    counts.rerolls.expected += exp;
    counts.rerolls.worst += cap;
    add("reroll", "QC rerolls (regenerated keyframes)", model, price.usd, { low: 0, expected: exp, high: cap }, price.source, j.nodeName);
    const refImages = s.editFrom ? Math.min(3, refs) : 0;
    const qty = { low: 1, expected: 1 + exp, high: 1 + cap };
    counts.qcCalls.low += qty.low;
    counts.qcCalls.expected += qty.expected;
    counts.qcCalls.high += qty.high;
    // QC cost varies by output length (thinking tokens), so the per-call price differs per level.
    const key = `qc|${qcModel}|${refImages}`;
    const g = groups.get(key) ?? {
      kind: "qc" as const,
      label: `Vision QC calls (${refImages ? `keyframe + ${refImages} ref${refImages > 1 ? "s" : ""}` : "keyframe only"})`,
      model: qcModel,
      qty: { low: 0, expected: 0, high: 0 },
      unitUsd: qcCallUsd(table, qcModel, refImages, "expected"),
      usd: { low: 0, expected: 0, high: 0 },
      source: `${table.qc.source} (${table.qc.asOf})`,
      nodes: [],
    };
    g.qty.low += qty.low;
    g.qty.expected += qty.expected;
    g.qty.high += qty.high;
    g.usd.low += qty.low * qcCallUsd(table, qcModel, refImages, "low");
    g.usd.expected += qty.expected * qcCallUsd(table, qcModel, refImages, "expected");
    g.usd.high += qty.high * qcCallUsd(table, qcModel, refImages, "high");
    groups.set(key, g);
  }

  for (const call of opts.llm ?? []) {
    const unit = llmCostUsd(table, call.model, call.inTokens, call.outTokens);
    if (unit.fallback) warnings.add(`${call.model} is not in the price table — priced as ${table.fallback.llm}.`);
    add("llm", call.label, call.model, unit.usd ?? 0, call.calls, unit.source);
  }
  const tts = table.tts["msedge-tts"];
  if (tts) add("tts", "Voiceover (TTS)", "msedge-tts", tts.perCall, { low: 1, expected: 1, high: 1 }, `${tts.source} (${tts.asOf})`);

  const lines: CostLine[] = [...groups.values()].map(({ nodes, ...g }) => {
    const usd = g.kind === "qc" ? g.usd : { low: g.qty.low * g.unitUsd, expected: g.qty.expected * g.unitUsd, high: g.qty.high * g.unitUsd };
    const shown = nodes.length ? ` — ${nodes.slice(0, 8).join(", ")}${nodes.length > 8 ? ` +${nodes.length - 8}` : ""}` : "";
    return {
      ...g,
      label: `${g.label}${shown}`,
      qty: { low: round(g.qty.low), expected: round(g.qty.expected), high: round(g.qty.high) },
      unitUsd: round(g.unitUsd),
      usd: { low: round(usd.low), expected: round(usd.expected), high: round(usd.high) },
    };
  });
  const order: CostLineKind[] = ["cast", "keyframe", "end_keyframe", "reroll", "video", "qc", "llm", "tts"];
  lines.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  const totals = lines.reduce((t, l) => ({ low: t.low + l.usd.low, expected: t.expected + l.usd.expected, high: t.high + l.usd.high }), { low: 0, expected: 0, high: 0 });
  return {
    lines,
    totals: { low: round(totals.low), expected: round(totals.expected), high: round(totals.high) },
    counts: { ...counts, qcCalls: { low: round(counts.qcCalls.low), expected: round(counts.qcCalls.expected), high: round(counts.qcCalls.high) }, rerolls: { expected: round(counts.rerolls.expected), worst: counts.rerolls.worst } },
    warnings: [...warnings],
    pricesAsOf: PRICES_AS_OF,
  };
}

/** Token estimate for the AI director's review of a master (director.ts: one 360 px still per beat). */
export function directorReviewCall(frames: number, model?: string): LlmCallEstimate {
  return { label: "AI director review (optional)", model: model ?? DEFAULT_PRICES.qc.defaultModel, inTokens: 600 + frames * 330, outTokens: 1500, calls: { low: 0, expected: 1, high: 1 } };
}

/**
 * Jobs a (not locked) storyboard would compile to — one keyframe + one clip per clip group, CTA frames
 * composited locally — for a forecast before compiling. Mirrors libtv-compile's grouping.
 */
export function storyboardJobs(input: {
  frames: { frameNumber?: number; segment?: string | null }[];
  frameSeconds?: number;
  imageModel?: string;
  videoModel?: string;
  clipDurationSec?: number;
}): { executor: string; clipDurationSec: number; jobs: CostJob[] } {
  const imageModel = input.imageModel ?? OPENROUTER_IMAGE_MODEL;
  const videoModel = input.videoModel ?? OPENROUTER_VIDEO_MODEL;
  const clip = input.clipDurationSec ?? 4;
  const frames = input.frames.map((f, i) => ({ frameNumber: f.frameNumber ?? i + 1, isCta: f.segment === "CTA" }));
  const groups = groupFrames(frames, framesPerClip(clip, input.frameSeconds ?? 2));
  const img = imageSettings(imageModel, { aspectRatio: "9:16" });
  const vid = videoSettings(videoModel, { durationSec: clip });
  const jobs: CostJob[] = groups.flatMap((g) => [
    { nodeName: `K${g.startFrame}`, kind: "image", modelName: imageModel, settings: img, creditsEstimated: imageCredits(imageModel) },
    { nodeName: `V${g.startFrame}`, kind: "video", modelName: videoModel, settings: vid, creditsEstimated: videoCredits(videoModel, clip) },
  ]);
  const engine = findVideoModel(videoModel)?.engine ?? "libtv";
  return { executor: engine, clipDurationSec: clip, jobs };
}
