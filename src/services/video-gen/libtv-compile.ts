/**
 * Compiles a 2-second storyboard into a LibtvRun plus its ordered LibtvJob
 * graph, following the `design-video-ad-libtv` playbook:
 *
 *   PROD-n / LOGO   uploaded packshots and logo — the only source of truth
 *                   for packaging
 *   K<start>        keyframe, image2image off PROD-1, one per clip group
 *   V<start>        clip, singleImage2video off "FF K<start>", one per clip group
 *
 * In `economy` mode a clip group is up to `floor(clipDurationSec / frameSeconds)`
 * consecutive non-CTA frames, so one 6 s clip supplies three 2 s windows — the
 * cut-density rule from `reference/shot-design.md` ("a 15s ad needs ~14 cuts but
 * only 8–12 generated clips"). `full` mode is the old one-group-per-frame graph.
 *
 * CTA frames never touch LibTV: text, logo and end cards are composited locally
 * by the worker's assemble.py, because video models garble type and drift on
 * packaging.
 */
import { prisma } from "@/lib/db";
import { getBrandTruthForPrompts, type SkuDimensionsCm } from "@/services/brand-kit";
import { FRAME_SECONDS, type GridFrame } from "@/lib/storyboard-grid";
import {
  DEFAULT_BUDGET_MODE,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_MAX_RUN_CREDITS,
  DEFAULT_VIDEO_MODEL,
  estimateRun,
  findVideoModel,
  framesPerClip,
  groupFrames,
  imageCredits,
  imageSettings,
  isBudgetMode,
  MAX_CLIP_PROMPT_WORDS,
  resolveVideoPrice,
  videoCredits,
  videoSettings,
  type BudgetMode,
} from "./libtv-pricing";

export const PRODUCT_LOCK_CLAUSE =
  "product stays exactly the same size, shape and label throughout — it must not grow, warp or re-letter";

export class LibtvCompileError extends Error {
  status: number;
  missing: string[];

  constructor(message: string, status: number, missing: string[] = []) {
    super(message);
    this.name = "LibtvCompileError";
    this.status = status;
    this.missing = missing;
  }
}

export interface CompileRunInput {
  projectId: string;
  storyboardId: string;
  scriptId?: string | null;
  imageModel?: string;
  videoModel?: string;
  clipDurationSec?: number;
  aspectRatio?: string;
  canvasName?: string;
  budgetMode?: BudgetMode;
  allowOverBudget?: boolean;
}

export interface FrameOffset {
  frameNumber: number;
  clipStartSec: number;
  clipEndSec: number;
}

export interface CompiledJobDraft {
  shotIndex: number;
  kind: "upload" | "image" | "video";
  nodeName: string;
  leftRefs: string[];
  prompt: string;
  modelName: string | null;
  settings: Record<string, unknown>;
  sourceUrl: string | null;
  creditsEstimated: number;
}

/** Ceiling for a single compiled run; a board over it needs `allowOverBudget`. */
export function maxRunCredits(): number {
  const raw = Number(process.env.LIBTV_MAX_RUN_CREDITS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MAX_RUN_CREDITS;
}

function asFrames(value: unknown): GridFrame[] {
  return Array.isArray(value) ? (value as GridFrame[]) : [];
}

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** "About 7 cm tall — roughly a quarter of a face" beats any adjective. */
function scaleClause(skuName: string | null, dims: SkuDimensionsCm | null): string {
  const label = skuName ? `the ${skuName}` : "the product";
  if (!dims?.height) {
    return `Match ${label} to the uploaded packshot exactly: same silhouette, cap, colour and wordmark. Keep it at believable real-world scale — marketing packshots exaggerate size.`;
  }
  return `${label.charAt(0).toUpperCase()}${label.slice(1)} is SMALL — about ${dims.height} cm tall in real life; keep it at that scale relative to hands and faces and do not enlarge it. Match the uploaded packshot exactly: same silhouette, cap, colour and wordmark.`;
}

function imagePromptFor(
  frame: GridFrame,
  opts: { scale: string; aspectRatio: string; brandTruth: string }
): string {
  const base = clean(frame.imagePrompt || frame.visualDirection || frame.scene || `Beat ${frame.frameNumber}`);
  const parts: string[] = [base];

  const craft = [frame.shotType, frame.subject, frame.productAction].filter(Boolean).map(clean);
  if (craft.length) parts.push(craft.join(" · "));

  parts.push(`Vertical ${opts.aspectRatio} composition, product in frame.`);
  parts.push(opts.scale);

  if (frame.segment === "HOOK") {
    parts.push(
      "First frame of the ad: high-key bright set, the product pushed toward the lens, no dark build-up."
    );
  }
  parts.push("Capture the action mid-motion, never a static pose — this still becomes a clip's first frame.");

  if (opts.brandTruth) parts.push(opts.brandTruth);
  return parts.join("\n\n");
}

/** Clips inherit their first frame; a single-beat prompt yields a slideshow. */
function twoBeatMotion(frame: GridFrame): string {
  const base = clean(frame.videoPrompt || "");
  const beatOne = clean(frame.cameraMove || frame.cameraNotes || "camera holds steady");
  const beatTwo = clean(frame.productAction || frame.subject || frame.scene || "the action completes");
  const beats = `Beat 1: ${beatOne}. Beat 2: ${beatTwo} — one complete action inside the shot.`;
  return base ? `${base}\n\n${beats}` : beats;
}

function videoPromptFor(frame: GridFrame, brandTruth: string): string {
  const parts = [twoBeatMotion(frame), PRODUCT_LOCK_CLAUSE];
  if (frame.sfx) parts.push(`Sound design cue: ${clean(frame.sfx)}`);
  if (brandTruth) parts.push(brandTruth);
  return parts.join("\n\n");
}

function wordsOf(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/**
 * Cuts to a clause boundary rather than mid-phrase: a beat ending "…reveal the
 * electronic." reads as a mistake to the model and to whoever reviews the run.
 */
function truncateWords(text: string, max: number): string {
  const words = wordsOf(text);
  if (words.length <= max) return text;

  const kept = words.slice(0, max).join(" ");
  const sentence = kept.lastIndexOf(". ");
  const trailing = sentence > 0 ? wordsOf(kept.slice(sentence + 1)).length : Infinity;
  const whole = trailing < 4 ? kept.slice(0, sentence) : kept;

  const boundary = Math.max(whole.lastIndexOf(","), whole.lastIndexOf(";"), whole.lastIndexOf(" — "));
  const clause = boundary > 0 ? whole.slice(0, boundary) : whole;
  const usable = wordsOf(clause).length >= Math.ceil(max * 0.6) ? clause : whole;
  return usable.replace(/[\s,;:.–—-]+$/, "");
}

/** One frame's motion, stripped to the clause a beat phrase can absorb. */
function beatFor(frame: GridFrame): string {
  const base = clean(frame.videoPrompt || "");
  if (base) return base.replace(/\.\s*$/, "");
  const move = clean(frame.cameraMove || frame.cameraNotes || "camera holds steady");
  const action = clean(frame.productAction || frame.subject || frame.scene || "the action completes");
  return `${move}, ${action}`;
}

const CONTINUOUS_TAKE = "One continuous take, no cut between beats.";

/**
 * A grouped clip must read as a single uninterrupted move: the 2 s windows are
 * cut out of it afterwards, so a prompt listing three separate shots produces
 * three jump cuts inside one clip. Each beat gets an equal share of the word
 * budget rather than the tail being chopped, so the last window still has
 * direction.
 */
function groupVideoPrompt(group: GridFrame[]): string {
  const reserved = wordsOf(PRODUCT_LOCK_CLAUSE).length + wordsOf(CONTINUOUS_TAKE).length;
  const budget = Math.max(group.length * 8, MAX_CLIP_PROMPT_WORDS - reserved);
  const perBeat = Math.max(6, Math.floor(budget / group.length) - 2);

  const beats = group.map((frame, i) => `Beat ${i + 1}: ${truncateWords(beatFor(frame), perBeat)}`);
  const phrase = truncateWords(`${beats.join(". ")}. ${CONTINUOUS_TAKE}`, budget + reserved - wordsOf(PRODUCT_LOCK_CLAUSE).length);
  return `${phrase}\n\n${PRODUCT_LOCK_CLAUSE}`;
}

/** Frame i of a group is cut from clip time [i·frameSeconds, +window length]. */
function frameOffsets(group: GridFrame[], frameSeconds: number, clipDurationSec: number): FrameOffset[] {
  return group.map((frame, i) => {
    const windowLength =
      Number.isFinite(frame.endSec) && Number.isFinite(frame.startSec) && frame.endSec > frame.startSec
        ? frame.endSec - frame.startSec
        : frameSeconds;
    const clipStartSec = Math.min(i * frameSeconds, clipDurationSec);
    return {
      frameNumber: frame.frameNumber,
      clipStartSec,
      clipEndSec: Math.min(clipStartSec + windowLength, clipDurationSec),
    };
  });
}

export interface CompileResult {
  runId: string;
  creditsEstimated: number;
  jobCount: number;
  budgetMode: BudgetMode;
  clipGroups: Array<{ nodeName: string; frameNumbers: number[] }>;
  maxRunCredits: number;
}

export async function compileRunFromStoryboard(input: CompileRunInput): Promise<CompileResult> {
  const {
    projectId,
    storyboardId,
    imageModel = DEFAULT_IMAGE_MODEL,
    videoModel = DEFAULT_VIDEO_MODEL,
    aspectRatio = "9:16",
  } = input;
  const budgetMode: BudgetMode = isBudgetMode(input.budgetMode) ? input.budgetMode : DEFAULT_BUDGET_MODE;

  const [project, storyboard, kit] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, brandName: true, productName: true, libtvCanvasUuid: true },
    }),
    prisma.storyboard.findUnique({ where: { id: storyboardId } }),
    prisma.brandKit.findUnique({
      where: { projectId },
      include: { assets: { orderBy: { createdAt: "asc" } } },
    }),
  ]);

  if (!project) throw new LibtvCompileError("Project not found", 404);
  if (!storyboard || storyboard.projectId !== projectId) {
    throw new LibtvCompileError("Storyboard not found for this project", 404);
  }

  const frames = asFrames(storyboard.frames);
  if (!frames.length) throw new LibtvCompileError("Storyboard has no frames", 409);

  const packshots = (kit?.assets ?? []).filter((a) => a.kind === "PACKSHOT" && a.url);
  if (!packshots.length) {
    throw new LibtvCompileError(
      "Brand kit has no product packshot — every legible product frame is composited from the official photo, so a run cannot be compiled without one.",
      409,
      ["Product packshots (at least 1, front view, transparent background preferred)"]
    );
  }
  const logo = (kit?.assets ?? []).find((a) => a.kind === "LOGO" && a.url) ?? null;

  const brandTruth = await getBrandTruthForPrompts(projectId);
  const dims = (kit?.skuDimensionsCm as SkuDimensionsCm | null) ?? null;
  const skuName = kit?.skuName || project.productName || null;
  const scale = scaleClause(skuName, dims);

  const video = findVideoModel(videoModel);
  const requestedDuration = input.clipDurationSec ?? video?.defaultDurationSec ?? 6;
  const price = video ? resolveVideoPrice(video, requestedDuration, video.defaultResolution) : null;
  const clipDurationSec = price?.durationSec ?? requestedDuration;
  const clipResolution = price?.resolution;

  const drafts: CompiledJobDraft[] = [];

  packshots.slice(0, 4).forEach((asset, i) => {
    drafts.push({
      shotIndex: -1,
      kind: "upload",
      nodeName: `PROD-${i + 1}`,
      leftRefs: [],
      prompt: `Official packshot${asset.variant ? ` (${asset.variant})` : ""} — product reference`,
      modelName: null,
      settings: {},
      sourceUrl: asset.url,
      creditsEstimated: 0,
    });
  });

  if (logo) {
    drafts.push({
      shotIndex: -1,
      kind: "upload",
      nodeName: "LOGO",
      leftRefs: [],
      prompt: "Brand logo — end card and overlays are composited locally",
      modelName: null,
      settings: {},
      sourceUrl: logo.url,
      creditsEstimated: 0,
    });
  }

  const imgSettings = imageSettings(imageModel, { aspectRatio });
  const vidSettings = videoSettings(videoModel, {
    durationSec: clipDurationSec,
    resolution: clipResolution,
  });

  const frameSeconds = storyboard.frameSeconds || FRAME_SECONDS;
  const normalized = frames.map((frame, index) => ({
    ...frame,
    frameNumber: frame.frameNumber ?? index + 1,
    startSec: Number.isFinite(frame.startSec) ? frame.startSec : index * frameSeconds,
    endSec: Number.isFinite(frame.endSec) ? frame.endSec : (index + 1) * frameSeconds,
  }));

  const perClip = framesPerClip(clipDurationSec, frameSeconds);
  const groups = groupFrames(
    normalized.map((frame) => ({ frameNumber: frame.frameNumber, isCta: frame.segment === "CTA" })),
    perClip,
    budgetMode
  );
  const groupByStartIndex = new Map(groups.map((g) => [g.startIndex, g]));
  const coveredIndexes = new Set(groups.flatMap((g) => g.frameIndexes));

  normalized.forEach((frame, index) => {
    const n = frame.frameNumber;

    if (frame.segment === "CTA") {
      drafts.push({
        shotIndex: index,
        kind: "image",
        nodeName: `K${n}`,
        leftRefs: ["PROD-1"],
        prompt: imagePromptFor(frame, { scale, aspectRatio, brandTruth }),
        modelName: null,
        settings: { compositeLocally: true, frameNumber: n, segment: frame.segment, coversFrames: [n], budgetMode },
        sourceUrl: null,
        creditsEstimated: 0,
      });
      return;
    }

    const group = groupByStartIndex.get(index);
    if (!group) {
      if (!coveredIndexes.has(index)) {
        throw new LibtvCompileError(`Frame ${n} was not assigned to a clip group`, 500);
      }
      return;
    }

    const groupFramesList = group.frameIndexes.map((i) => normalized[i]);
    const offsets = frameOffsets(groupFramesList, frameSeconds, clipDurationSec);

    drafts.push({
      shotIndex: index,
      kind: "image",
      nodeName: `K${n}`,
      leftRefs: ["PROD-1"],
      prompt: imagePromptFor(frame, { scale, aspectRatio, brandTruth }),
      modelName: imageModel,
      settings: {
        ...imgSettings,
        frameNumber: n,
        segment: frame.segment,
        coversFrames: group.frameNumbers,
        budgetMode,
      },
      sourceUrl: null,
      creditsEstimated: imageCredits(imageModel),
    });

    drafts.push({
      shotIndex: index,
      kind: "video",
      nodeName: `V${n}`,
      leftRefs: [`FF K${n}`],
      prompt:
        groupFramesList.length > 1 ? groupVideoPrompt(groupFramesList) : videoPromptFor(frame, brandTruth),
      modelName: videoModel,
      settings: {
        ...vidSettings,
        frameNumber: n,
        segment: frame.segment,
        coversFrames: group.frameNumbers,
        frameOffsetsSec: offsets,
        frameSeconds,
        budgetMode,
      },
      sourceUrl: null,
      creditsEstimated: videoCredits(videoModel, clipDurationSec, clipResolution),
    });
  });

  const estimate = estimateRun(drafts);
  const creditCeiling = maxRunCredits();
  if (!input.allowOverBudget && estimate.total > creditCeiling) {
    throw new LibtvCompileError(
      `This board compiles to ${estimate.total} credits, over the ${creditCeiling}-credit ceiling (LIBTV_MAX_RUN_CREDITS). ` +
        `Economy mode, a shorter board or a cheaper clip model brings it down; re-send with allowOverBudget to compile anyway.`,
      409,
      [
        `Estimate ${estimate.total} credits vs cap ${creditCeiling}`,
        `${estimate.countByKind.image ?? 0} keyframes + ${estimate.countByKind.video ?? 0} clips in ${budgetMode} mode`,
      ]
    );
  }

  const canvasName =
    input.canvasName ||
    clean(`CI ${project.brandName} ${storyboard.title}`).slice(0, 60);

  const run = await prisma.libtvRun.create({
    data: {
      projectId,
      scriptId: input.scriptId ?? storyboard.scriptId ?? null,
      storyboardId,
      status: "awaiting_approval",
      canvasUuid: project.libtvCanvasUuid ?? null,
      canvasUrl: project.libtvCanvasUuid ? canvasUrlFor(project.libtvCanvasUuid) : null,
      canvasName,
      imageModel,
      videoModel,
      aspectRatio,
      clipDurationSec,
      creditsEstimated: estimate.total,
      jobs: {
        create: drafts.map((d) => ({
          projectId,
          shotIndex: d.shotIndex,
          kind: d.kind,
          nodeName: d.nodeName,
          leftRefs: d.leftRefs,
          prompt: d.prompt,
          modelName: d.modelName,
          settings: d.settings as object,
          sourceUrl: d.sourceUrl,
          creditsEstimated: d.creditsEstimated,
        })),
      },
    },
    select: { id: true },
  });

  return {
    runId: run.id,
    creditsEstimated: estimate.total,
    jobCount: drafts.length,
    budgetMode,
    clipGroups: estimate.clipGroups,
    maxRunCredits: creditCeiling,
  };
}

/**
 * Canvas deep link. The CLI prints only `uuid` in `libtv project list`; the web
 * app addresses a canvas by that uuid as `projectId` — the form documented in
 * `~/.claude/skills/libtv-cli/commands/project.md`.
 */
export function canvasUrlFor(canvasUuid: string, spaceId?: number | string | null): string {
  const base = `https://www.liblib.tv/canvas?projectId=${encodeURIComponent(canvasUuid)}`;
  return spaceId ? `${base}&spaceId=${encodeURIComponent(String(spaceId))}` : base;
}
