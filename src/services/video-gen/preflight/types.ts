/**
 * Pre-flight creative score (thumb-stop predictor): what the render plan says is on screen plus what
 * ffmpeg + sharp measure on the master, scored 0–100 per platform with concrete fixes. No ad spend.
 */
import type { PlatformId } from "@/services/creative/types";

/** Measured on the file (measure.ts). Light/colour/motion values are 0–1. */
export interface PreflightMeasures {
  durationSec: number;
  width: number;
  height: number;
  firstFrame: { brightness: number; contrast: number; saturation: number };
  /** Mean absolute luma change between frames (12 fps) over 0–1 s. */
  motion1s: number;
  /** Edge-density heuristic: first time a text-like band appears (null: none in the first 3 s). */
  textOnsetSec: number | null;
  cutsSec: number[];
  hasAudio: boolean;
  loudnessLufs: number | null;
  truePeakDb: number | null;
  leadingSilenceSec: number;
  /** The last second: motion and edge density (a held end card is still and text-dense). */
  end: { motion: number; edgeDensity: number };
}

export interface PlanLayer {
  role: string;
  /** Pixels on the master's canvas. */
  x: number;
  y: number;
  w: number;
  h: number;
  startSec: number;
  endSec: number;
}

/** What the render plan / locked script says the viewer gets (all optional — the score uses what exists). */
export interface PreflightPlan {
  goal?: string | null;
  /** On-screen text (headline, claims, captions, offer, CTA). */
  texts: { text: string; startSec: number; endSec: number; role?: string }[];
  voiceover: { text: string; startSec: number; endSec: number }[];
  /** Shots that show the product (packshot, zoom hit on it, end card); null = unknown. */
  productShots: { startSec: number; endSec: number }[] | null;
  ctaSec: number | null;
  /** Share of voiceover time with captions on screen (from the edit QC), null = unknown. */
  captionCoverage: number | null;
  /** Readable layer boxes, for the safe-zone check; null = unknown. */
  layers: PlanLayer[] | null;
  /** Brand name, to spot it in early text. */
  brandName?: string | null;
}

export interface PreflightCheck {
  key: string;
  label: string;
  value: number | string | null;
  target: string;
  /** 0–1 partial credit; null when it couldn't be measured (left out of the score). */
  score: number | null;
  weight: number;
  pass: boolean | null;
  fix?: string;
}

export interface PreflightReport {
  version: 1;
  platform: PlatformId;
  /** 0–100. */
  score: number;
  verdict: "ready" | "fix first" | "rework";
  checks: PreflightCheck[];
  /** Highest-impact fixes first. */
  topFixes: string[];
  durationSec: number;
  measuredAt: string;
  /** Which inputs fed it ("plan", "heuristic"). */
  sources: string[];
}
