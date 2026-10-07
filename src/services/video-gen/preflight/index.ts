/**
 * Pre-flight creative score for a rendered master: measure (ffmpeg + sharp, local, free) + score
 * against the platform profile. Used after edit-v2 renders (QcReport.preflight) and by the operator
 * `preflight` action on finished runs.
 */
import type { PlatformId } from "@/services/creative/types";
import { measurePreflight } from "./measure";
import { defaultPlatform } from "./plan";
import { scorePreflight } from "./score";
import type { PreflightPlan, PreflightReport } from "./types";

export type { PreflightPlan, PreflightReport } from "./types";
export { planFromEdit, planFromStoryboard, layersFromOverlays, defaultPlatform } from "./plan";

export async function runPreflight(input: {
  file: string;
  dir: string;
  plan: PreflightPlan | null;
  platform?: PlatformId | null;
  aspectRatio?: string;
  goal?: string | null;
  known?: { loudnessLufs?: number | null; truePeakDb?: number | null; cutsSec?: number[] };
}): Promise<PreflightReport> {
  const measures = await measurePreflight(input.file, input.dir, input.known);
  const platform = input.platform ?? defaultPlatform(input.aspectRatio ?? (measures.width > measures.height ? "16:9" : measures.width === measures.height ? "1:1" : "9:16"));
  return scorePreflight(measures, input.plan, { platform, goal: input.goal });
}

const ROLE_BY_FILE: [RegExp, string][] = [
  [/v2cap/, "caption"],
  [/v2card/, "card"],
  [/v2cta/, "cta"],
  [/v2logo/, "logo"],
  [/v2end/, "endcard"],
  [/v2domain/, "domain"],
];

/** The edit-v2 hook: plan from the edit, layer boxes from the overlay PNGs, measurements reused from the QC. */
export async function preflightForEdit(input: {
  master: string;
  dir: string;
  aspectRatio: string;
  canvas: { w: number; h: number };
  plan: import("./plan").EditPlanLike;
  frames: { startSec: number; endSec: number; voiceover?: string | null }[];
  overlays: { file: string; y: number; startSec: number; endSec: number }[];
  captions: { text: string; startSec: number; endSec: number }[];
  captionCoverage: number | null;
  known: { loudnessLufs?: number | null; truePeakDb?: number | null; cutsSec?: number[] };
}): Promise<PreflightReport> {
  const { layersFromOverlays, planFromEdit } = await import("./plan");
  const layers = await layersFromOverlays(
    input.overlays.map((o) => ({ ...o, role: ROLE_BY_FILE.find(([re]) => re.test(o.file))?.[1] ?? "text" })),
    input.canvas
  );
  const plan = planFromEdit(input.plan, input.frames, { layers, captionCoverage: input.captionCoverage, captions: input.captions });
  return runPreflight({ file: input.master, dir: input.dir, plan, aspectRatio: input.aspectRatio, known: input.known });
}
