/**
 * LibTV model catalogue and credit pricing.
 *
 * Every credit figure here was measured on an annual-VIP account on
 * 2026-09-10 and is recorded in
 * `.claude/skills/design-video-ad-libtv/reference/libtv-cli.md`. The CLI has no
 * balance or price command, so a run's cost is the sum of these per-node
 * figures. Rows flagged `verified: false` have a price from the measured table
 * but a settings schema that was not read back from `libtv model <name>`.
 */

export type LibtvModality = "image" | "video";

export interface LibtvVideoPrice {
  durationSec: number;
  resolution: string;
  credits: number;
}

export interface LibtvImageModel {
  name: string;
  modality: "image";
  modeType: string;
  creditsPerImage: number;
  quality: string;
  qualityKey: "quality" | "resolution";
  ratios: string[];
  settingsKeys: string[];
  verified: boolean;
  note?: string;
}

export interface LibtvVideoModel {
  name: string;
  modality: "video";
  modeType: string;
  prices: LibtvVideoPrice[];
  defaultDurationSec: number;
  defaultResolution: string;
  settingsKeys: string[];
  verified: boolean;
  note?: string;
}

export type LibtvModel = LibtvImageModel | LibtvVideoModel;

export const IMAGE_MODELS: LibtvImageModel[] = [
  {
    name: "Seedream 4.0",
    modality: "image",
    modeType: "image2image",
    creditsPerImage: 1,
    quality: "2K",
    qualityKey: "quality",
    ratios: ["1:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3", "21:9"],
    settingsKeys: ["modeType", "ratio", "quality", "count"],
    verified: true,
    note: "1 credit per 2K image2image keyframe (measured 2026-09-11). Default while the balance is low.",
  },
  {
    name: "Seedream 5.0 Pro",
    modality: "image",
    modeType: "image2image",
    creditsPerImage: 14,
    quality: "2K",
    qualityKey: "quality",
    ratios: ["1:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3", "21:9"],
    settingsKeys: ["modeType", "ratio", "quality", "count"],
    verified: true,
    note: "Cheapest keyframe model that survives QC. Reference edges require modeType=image2image.",
  },
  {
    name: "Lib Image 2.5 Pro",
    modality: "image",
    modeType: "image2image",
    creditsPerImage: 27,
    quality: "2K",
    qualityKey: "resolution",
    ratios: ["1:1", "9:16", "16:9", "3:4", "4:3"],
    settingsKeys: ["modeType", "ratio", "resolution", "quality"],
    verified: false,
    note: "~2x Seedream. Prone to false-positive content-rule rejections.",
  },
];

export const VIDEO_MODELS: LibtvVideoModel[] = [
  {
    name: "Hailuo 2.3 Fast",
    modality: "video",
    modeType: "singleImage2video",
    prices: [
      { durationSec: 6, resolution: "768P", credits: 12 },
      { durationSec: 6, resolution: "1080P", credits: 24 },
    ],
    defaultDurationSec: 6,
    defaultResolution: "768P",
    settingsKeys: ["modeType", "duration", "resolution"],
    verified: true,
    note: "Best value for image-to-video with people. 768P is half the price of 1080P; 1080P forbids the 10s option.",
  },
  {
    name: "Kling O3",
    modality: "video",
    modeType: "frames2video",
    prices: [
      { durationSec: 3, resolution: "720P", credits: 24 },
      { durationSec: 5, resolution: "720P", credits: 40 },
    ],
    defaultDurationSec: 5,
    defaultResolution: "720P",
    settingsKeys: ["modeType", "duration", "resolution"],
    verified: false,
    note: "First+last frame. Use for exact orbit / camera-move shots.",
  },
  {
    name: "Kling 3.0 Turbo",
    modality: "video",
    modeType: "singleImage2video",
    prices: [{ durationSec: 3, resolution: "720p", credits: 36 }],
    defaultDurationSec: 3,
    defaultResolution: "720p",
    settingsKeys: ["modeType", "duration", "resolution"],
    verified: false,
  },
  {
    name: "Wan 3.0",
    modality: "video",
    modeType: "singleImage2video",
    prices: [
      { durationSec: 2, resolution: "720P", credits: 20 },
      { durationSec: 4, resolution: "720P", credits: 40 },
    ],
    defaultDurationSec: 4,
    defaultResolution: "720P",
    settingsKeys: ["modeType", "duration", "resolution"],
    verified: false,
  },
  {
    name: "Seedance 2.0 Mini",
    modality: "video",
    modeType: "singleImage2video",
    prices: [
      { durationSec: 4, resolution: "480P", credits: 32 },
      { durationSec: 4, resolution: "720P", credits: 64 },
    ],
    defaultDurationSec: 4,
    defaultResolution: "480P",
    settingsKeys: ["modeType", "duration", "resolution"],
    verified: false,
  },
  {
    name: "Seedance 2.5",
    modality: "video",
    modeType: "singleImage2video",
    prices: [
      { durationSec: 4, resolution: "480P", credits: 80 },
      { durationSec: 4, resolution: "720P", credits: 156 },
    ],
    defaultDurationSec: 4,
    defaultResolution: "480P",
    settingsKeys: ["modeType", "duration", "resolution"],
    verified: false,
    note: "6x Hailuo for no visible gain at 2s cuts.",
  },
  {
    name: "Seedance 1.5 Pro",
    modality: "video",
    modeType: "singleImage2video",
    prices: [{ durationSec: 5, resolution: "1080P", credits: 90 }],
    defaultDurationSec: 5,
    defaultResolution: "1080P",
    settingsKeys: ["modeType", "duration", "resolution"],
    verified: false,
  },
];

export const DEFAULT_IMAGE_MODEL = "Seedream 4.0";
export const DEFAULT_VIDEO_MODEL = "Hailuo 2.3 Fast";

export function findImageModel(name: string): LibtvImageModel | null {
  return IMAGE_MODELS.find((m) => m.name === name) ?? null;
}

export function findVideoModel(name: string): LibtvVideoModel | null {
  return VIDEO_MODELS.find((m) => m.name === name) ?? null;
}

/** Nearest allowed duration for a video model (>= requested where possible). */
export function resolveVideoPrice(
  model: LibtvVideoModel,
  durationSec?: number | null,
  resolution?: string | null
): LibtvVideoPrice {
  const pool = resolution
    ? model.prices.filter((p) => p.resolution === resolution)
    : model.prices.filter((p) => p.resolution === model.defaultResolution);
  const candidates = pool.length ? pool : model.prices;
  const want = durationSec ?? model.defaultDurationSec;
  let best = candidates[0];
  let bestDelta = Math.abs(best.durationSec - want);
  for (const p of candidates) {
    const delta = Math.abs(p.durationSec - want);
    if (delta < bestDelta) {
      best = p;
      bestDelta = delta;
    }
  }
  return best;
}

export function imageCredits(modelName: string): number {
  return findImageModel(modelName)?.creditsPerImage ?? 14;
}

export function videoCredits(modelName: string, durationSec?: number | null, resolution?: string | null): number {
  const model = findVideoModel(modelName);
  if (!model) return 24;
  return resolveVideoPrice(model, durationSec, resolution).credits;
}

// ─── Node settings (-s key=value pairs) ──────────────────────────────────────

export type LibtvSettings = Record<string, string | number>;

export function imageSettings(
  modelName: string,
  opts: { aspectRatio?: string; count?: number } = {}
): LibtvSettings {
  const model = findImageModel(modelName) ?? IMAGE_MODELS[0];
  const ratio = opts.aspectRatio && model.ratios.includes(opts.aspectRatio) ? opts.aspectRatio : "9:16";
  const settings: LibtvSettings = { modeType: model.modeType, ratio };
  settings[model.qualityKey] = model.quality;
  if (model.settingsKeys.includes("count")) settings.count = opts.count ?? 1;
  if (model.qualityKey === "resolution" && model.settingsKeys.includes("quality")) settings.quality = "high";
  return settings;
}

export function videoSettings(
  modelName: string,
  opts: { durationSec?: number; resolution?: string } = {}
): LibtvSettings {
  const model = findVideoModel(modelName) ?? VIDEO_MODELS[0];
  const price = resolveVideoPrice(model, opts.durationSec, opts.resolution);
  const settings: LibtvSettings = { modeType: model.modeType, duration: price.durationSec };
  if (model.settingsKeys.includes("resolution")) settings.resolution = price.resolution;
  return settings;
}

// ─── Budget modes and clip grouping ──────────────────────────────────────────

/**
 * `economy` spends one generated clip on several storyboard frames, which is
 * how the shot-design reference gets 14 visible cuts out of 8–12 clips: a 6 s
 * Hailuo clip is cut into three 2 s windows instead of being thrown away after
 * the first two seconds. `full` is the old one-clip-per-frame graph.
 */
export type BudgetMode = "economy" | "full";

export const DEFAULT_BUDGET_MODE: BudgetMode = "economy";
export const DEFAULT_MAX_RUN_CREDITS = 120;
export const MAX_CLIP_PROMPT_WORDS = 90;

export function isBudgetMode(value: unknown): value is BudgetMode {
  return value === "economy" || value === "full";
}

/** How many storyboard frames one generated clip can cover. */
export function framesPerClip(clipDurationSec: number, frameSeconds: number): number {
  const span = Number(clipDurationSec) || 0;
  const grid = Number(frameSeconds) || 2;
  if (grid <= 0) return 1;
  return Math.max(1, Math.floor(span / grid));
}

export interface GroupableFrame {
  frameNumber: number;
  isCta: boolean;
}

export interface ClipGroup {
  startFrame: number;
  startIndex: number;
  frameNumbers: number[];
  frameIndexes: number[];
}

/**
 * Consecutive non-CTA frames, chunked at `perClip`. A CTA frame closes the
 * current group: CTA cards are composited locally and never share a clip.
 */
export function groupFrames(
  frames: GroupableFrame[],
  perClip: number,
  mode: BudgetMode = DEFAULT_BUDGET_MODE
): ClipGroup[] {
  const size = mode === "economy" ? Math.max(1, Math.floor(perClip)) : 1;
  const groups: ClipGroup[] = [];
  let current: ClipGroup | null = null;

  frames.forEach((frame, index) => {
    if (frame.isCta) {
      current = null;
      return;
    }
    if (!current || current.frameNumbers.length >= size) {
      current = { startFrame: frame.frameNumber, startIndex: index, frameNumbers: [], frameIndexes: [] };
      groups.push(current);
    }
    current.frameNumbers.push(frame.frameNumber);
    current.frameIndexes.push(index);
  });

  return groups;
}

export interface BoardEstimateInput {
  frames: GroupableFrame[];
  mode: BudgetMode;
  clipDurationSec: number;
  frameSeconds: number;
  imageModel: string;
  videoModel: string;
  clipResolution?: string | null;
}

export interface BoardEstimate {
  total: number;
  keyframeCount: number;
  clipCount: number;
  ctaCount: number;
  groups: ClipGroup[];
  perClip: number;
}

/** The same arithmetic the compiler runs, so Studio can price a board before compiling. */
export function estimateBoard(input: BoardEstimateInput): BoardEstimate {
  const perClip = framesPerClip(input.clipDurationSec, input.frameSeconds);
  const groups = groupFrames(input.frames, perClip, input.mode);
  const ctaCount = input.frames.filter((f) => f.isCta).length;
  const perImage = imageCredits(input.imageModel);
  const perVideo = videoCredits(input.videoModel, input.clipDurationSec, input.clipResolution);
  return {
    total: groups.length * (perImage + perVideo),
    keyframeCount: groups.length,
    clipCount: groups.length,
    ctaCount,
    groups,
    perClip,
  };
}

// ─── Run estimation ──────────────────────────────────────────────────────────

export interface EstimatableJob {
  kind: string;
  nodeName?: string;
  creditsEstimated?: number | null;
  settings?: Record<string, unknown> | null;
}

export interface RunEstimate {
  total: number;
  byKind: Record<string, number>;
  countByKind: Record<string, number>;
  clipGroups: Array<{ nodeName: string; frameNumbers: number[] }>;
  framesCovered: number;
}

function coversFramesOf(job: EstimatableJob): number[] {
  const raw = job.settings?.coversFrames;
  if (Array.isArray(raw)) return raw.map(Number).filter(Number.isFinite);
  const single = Number(job.settings?.frameNumber);
  return Number.isFinite(single) ? [single] : [];
}

export function estimateRun(jobs: EstimatableJob[]): RunEstimate {
  const byKind: Record<string, number> = {};
  const countByKind: Record<string, number> = {};
  const clipGroups: Array<{ nodeName: string; frameNumbers: number[] }> = [];
  const covered = new Set<number>();
  let total = 0;

  for (const job of jobs) {
    const credits = job.creditsEstimated ?? 0;
    byKind[job.kind] = (byKind[job.kind] ?? 0) + credits;
    countByKind[job.kind] = (countByKind[job.kind] ?? 0) + 1;
    total += credits;

    if (job.kind === "video") {
      const frameNumbers = coversFramesOf(job);
      clipGroups.push({ nodeName: job.nodeName ?? "", frameNumbers });
      for (const n of frameNumbers) covered.add(n);
    }
  }

  return { total, byKind, countByKind, clipGroups, framesCovered: covered.size };
}

/** Shape the Studio model pickers render. */
export interface ModelOption {
  name: string;
  modality: LibtvModality;
  credits: number;
  unit: string;
  verified: boolean;
  note?: string;
  durations?: number[];
}

export function modelOptions(): { image: ModelOption[]; video: ModelOption[] } {
  return {
    image: IMAGE_MODELS.map((m) => ({
      name: m.name,
      modality: "image" as const,
      credits: m.creditsPerImage,
      unit: `credits / ${m.quality} image`,
      verified: m.verified,
      note: m.note,
    })),
    video: VIDEO_MODELS.map((m) => {
      const price = resolveVideoPrice(m, m.defaultDurationSec, m.defaultResolution);
      return {
        name: m.name,
        modality: "video" as const,
        credits: price.credits,
        unit: `credits / ${price.durationSec}s ${price.resolution}`,
        verified: m.verified,
        note: m.note,
        durations: Array.from(new Set(m.prices.map((p) => p.durationSec))).sort((a, b) => a - b),
      };
    }),
  };
}
