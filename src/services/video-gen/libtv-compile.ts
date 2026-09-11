/**
 * Compiles a 2-second storyboard into a LibtvRun plus its ordered LibtvJob
 * graph, following the `design-video-ad-libtv` playbook:
 *
 *   PROD-n / LOGO   uploaded packshots and logo — the only source of truth
 *                   for packaging
 *   K<n>            keyframe, image2image off PROD-1, one per storyboard frame
 *   V<n>            clip, singleImage2video off "FF K<n>", one per non-CTA frame
 *
 * CTA frames never touch LibTV: text, logo and end cards are composited locally
 * by the worker's assemble.py, because video models garble type and drift on
 * packaging.
 */
import { prisma } from "@/lib/db";
import { getBrandTruthForPrompts, type SkuDimensionsCm } from "@/services/brand-kit";
import type { GridFrame } from "@/lib/storyboard-grid";
import {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_VIDEO_MODEL,
  estimateRun,
  findVideoModel,
  imageCredits,
  imageSettings,
  resolveVideoPrice,
  videoCredits,
  videoSettings,
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
}

export interface CompiledJobDraft {
  shotIndex: number;
  kind: "upload" | "image" | "video";
  nodeName: string;
  leftRefs: string[];
  prompt: string;
  modelName: string | null;
  settings: Record<string, string | number | boolean>;
  sourceUrl: string | null;
  creditsEstimated: number;
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

export interface CompileResult {
  runId: string;
  creditsEstimated: number;
  jobCount: number;
}

export async function compileRunFromStoryboard(input: CompileRunInput): Promise<CompileResult> {
  const {
    projectId,
    storyboardId,
    imageModel = DEFAULT_IMAGE_MODEL,
    videoModel = DEFAULT_VIDEO_MODEL,
    aspectRatio = "9:16",
  } = input;

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

  frames.forEach((frame, index) => {
    const n = frame.frameNumber ?? index + 1;
    const isCta = frame.segment === "CTA";

    drafts.push({
      shotIndex: index,
      kind: "image",
      nodeName: `K${n}`,
      leftRefs: ["PROD-1"],
      prompt: imagePromptFor(frame, { scale, aspectRatio, brandTruth }),
      modelName: isCta ? null : imageModel,
      settings: isCta
        ? { compositeLocally: true, frameNumber: n, segment: frame.segment }
        : { ...imgSettings, frameNumber: n, segment: frame.segment },
      sourceUrl: null,
      creditsEstimated: isCta ? 0 : imageCredits(imageModel),
    });

    if (isCta) return;

    drafts.push({
      shotIndex: index,
      kind: "video",
      nodeName: `V${n}`,
      leftRefs: [`FF K${n}`],
      prompt: videoPromptFor(frame, brandTruth),
      modelName: videoModel,
      settings: { ...vidSettings, frameNumber: n, segment: frame.segment },
      sourceUrl: null,
      creditsEstimated: videoCredits(videoModel, clipDurationSec, clipResolution),
    });
  });

  const estimate = estimateRun(drafts);
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

  return { runId: run.id, creditsEstimated: estimate.total, jobCount: drafts.length };
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
