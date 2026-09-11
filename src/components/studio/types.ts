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

export interface ModelOptionView {
  name: string;
  modality: "image" | "video";
  credits: number;
  unit: string;
  verified: boolean;
  note?: string;
  durations?: number[];
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
