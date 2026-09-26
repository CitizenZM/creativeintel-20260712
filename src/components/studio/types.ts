import { framesPerClip, groupFrames, type BudgetMode } from "@/services/video-gen/libtv-pricing";

export type { BudgetMode };

export interface LibtvJobView {
  id: string;
  runId: string;
  shotIndex: number;
  kind: string;
  nodeName: string;
  nodeId: string | null;
  leftRefs: unknown;
  prompt: string;
  modelName: string | null;
  settings: Record<string, unknown> | null;
  sourceUrl: string | null;
  creditsEstimated: number;
  creditsSpent: number | null;
  status: string;
  resultUrl: string | null;
  remoteUrl: string | null;
  localPath: string | null;
  error: string | null;
  attempts: number;
}

export interface LibtvRunView {
  id: string;
  projectId: string;
  scriptId: string | null;
  storyboardId: string | null;
  status: string;
  canvasUuid: string | null;
  canvasUrl: string | null;
  canvasName: string | null;
  imageModel: string;
  videoModel: string;
  aspectRatio: string;
  clipDurationSec: number;
  creditsEstimated: number;
  creditsSpent: number;
  creditCap: number | null;
  approvedAt: string | null;
  masterMp4Url: string | null;
  isFinal?: boolean;
  parentRunId?: string | null;
  previewMp4Url: string | null;
  contactSheetUrl: string | null;
  error: string | null;
  workerId: string | null;
  createdAt: string;
  completedAt: string | null;
  jobs: LibtvJobView[];
}

export interface StoryboardFrameView {
  frameNumber: number;
  startSec?: number;
  endSec?: number;
  duration?: string;
  segment?: string;
  scene?: string;
  imageUrl?: string | null;
  imagePrompt?: string;
  videoPrompt?: string;
  textOverlay?: string;
  voiceover?: string;
  shotType?: string;
  cameraMove?: string;
  productAction?: string;
  sellingPoint?: string;
}

export interface StoryboardView {
  id: string;
  title: string;
  scriptId: string | null;
  totalDuration: string | null;
  frameSeconds: number;
  frames: StoryboardFrameView[];
}

export interface RunLimits {
  maxRunCredits: number;
  defaultBudgetMode: BudgetMode;
}

export interface ClipGroupView {
  nodeName: string;
  frameNumbers: number[];
}

export interface ModelOptionView {
  name: string;
  modality: "image" | "video";
  credits: number;
  unit: string;
  verified: boolean;
  note?: string;
  durations?: number[];
  /** "libtv" | "glm" | "comfyui" — the video model decides which engine renders the run. */
  engine?: string;
  /** Default picked in Settings → AI engines. */
  preferred?: boolean;
}

export interface BrandKitReadiness {
  score: number;
  missing: string[];
  ready: { creative: boolean; studio: boolean };
}

export const ACTIVE_RUN_STATUSES = ["approved", "claimed", "running", "assembling"];

export function isRunActive(status: string): boolean {
  return ACTIVE_RUN_STATUSES.includes(status);
}

export function jobsByNode(run: LibtvRunView | null): Map<string, LibtvJobView> {
  const map = new Map<string, LibtvJobView>();
  for (const job of run?.jobs ?? []) map.set(job.nodeName, job);
  return map;
}

/** Runs compiled before economy mode carry only `frameNumber` — one frame per clip. */
function coversFramesOf(job: LibtvJobView): number[] {
  const raw = job.settings?.coversFrames;
  if (Array.isArray(raw)) return raw.map(Number).filter(Number.isFinite);
  const single = Number(job.settings?.frameNumber);
  return Number.isFinite(single) ? [single] : [];
}

/**
 * Which frames each clip covers: read off a compiled run's V jobs, or predicted
 * from the board when nothing is compiled yet, so the timeline shows the same
 * grouping before and after Compile.
 */
export function clipGroupsFor(
  run: LibtvRunView | null,
  storyboard: StoryboardView | null,
  budgetMode: BudgetMode,
  clipDurationSec: number
): ClipGroupView[] {
  const fromRun = (run?.jobs ?? [])
    .filter((job) => job.kind === "video")
    .map((job) => ({ nodeName: job.nodeName, frameNumbers: coversFramesOf(job) }))
    .filter((group) => group.frameNumbers.length > 0);
  if (fromRun.length) {
    return fromRun.sort((a, b) => a.frameNumbers[0] - b.frameNumbers[0]);
  }

  if (!storyboard) return [];
  const frameSeconds = storyboard.frameSeconds || 2;
  const groups = groupFrames(
    storyboard.frames.map((frame, i) => ({
      frameNumber: frame.frameNumber ?? i + 1,
      isCta: (frame.segment || "").toUpperCase() === "CTA",
    })),
    framesPerClip(clipDurationSec, frameSeconds),
    budgetMode
  );
  return groups.map((group) => ({ nodeName: `V${group.startFrame}`, frameNumbers: group.frameNumbers }));
}

/** file:// results from a storage-less worker cannot be loaded by the browser. */
export function isPlayable(url: string | null | undefined): url is string {
  return typeof url === "string" && /^https?:\/\//.test(url);
}
