/**
 * Shot types, per-shot thresholds and the compact score record — kept free of
 * sharp/vision imports so the executors can load them without the image stack.
 */
import { hasPeople } from "../prompt-safety";
import type { ConsistencyScore } from "./score";

export type ShotType = "product-closeup" | "product" | "people-product" | "people-wide" | "people";

export interface Thresholds {
  /** Overall score needed to pass. */
  pass: number;
  /** Combined product score needed (vision + pixels). */
  productMin: number;
  /** Product pixel score needed (when a box was measured). */
  productPixelMin: number;
  /** Every cast member's identity score needed. */
  castMin: number;
  /** Weights of the product and the (worst) cast member in the overall score. */
  weights: { product: number; cast: number };
  /** Share of the pixel score in the combined product score. */
  pixelBlend: number;
}

// Calibrated 2026-10-07 on the first live run (NXTPAPER 14, 14 keyframes, 48 scored attempts): frames that
// read as correct scored 0.67–0.75 and were re-rolled twice at the old 0.70–0.78 bars; the real failures
// (wrong product colour 0.30, collage 0.57) sit well below. Named major defects still fail a frame at any score.
export const SHOT_THRESHOLDS: Record<ShotType, Thresholds> = {
  "product-closeup": { pass: 0.66, productMin: 0.66, productPixelMin: 0.4, castMin: 0.6, weights: { product: 0.85, cast: 0.15 }, pixelBlend: 0.45 },
  product: { pass: 0.6, productMin: 0.6, productPixelMin: 0.35, castMin: 0.6, weights: { product: 0.7, cast: 0.3 }, pixelBlend: 0.35 },
  "people-product": { pass: 0.58, productMin: 0.55, productPixelMin: 0.25, castMin: 0.66, weights: { product: 0.5, cast: 0.5 }, pixelBlend: 0.3 },
  "people-wide": { pass: 0.56, productMin: 0.45, productPixelMin: 0.15, castMin: 0.7, weights: { product: 0.3, cast: 0.7 }, pixelBlend: 0.2 },
  people: { pass: 0.58, productMin: 0.4, productPixelMin: 0.1, castMin: 0.7, weights: { product: 0.2, cast: 0.8 }, pixelBlend: 0.15 },
};

const CLOSE = /\b(close[- ]?up|macro|detail|corner|edge|side[- ]profile|profile view|tight|extreme close)\b/i;
const WIDE = /\b(wide|medium[- ]wide|full[- ]body|establishing|group|family|crowd|24mm|28mm)\b/i;

/** The shot type from the keyframe prompt and which references the frame was edited from. */
export function inferShotType(shot: string, refs: { cast: boolean; product: boolean }): ShotType {
  const people = refs.cast || hasPeople(shot);
  if (people) {
    if (WIDE.test(shot)) return "people-wide";
    return refs.product ? "people-product" : "people";
  }
  return CLOSE.test(shot) ? "product-closeup" : "product";
}

export function isShotType(v: unknown): v is ShotType {
  return typeof v === "string" && v in SHOT_THRESHOLDS;
}

/** Compact record for job settings and the report. */
export function summarizeScore(s: ConsistencyScore) {
  return {
    score: s.score,
    pass: s.pass,
    reviewed: s.reviewed,
    shotType: s.shotType,
    product: s.product
      ? {
          score: s.product.score,
          vision: s.product.visionScore,
          pixel: s.product.pixel?.score ?? null,
          aspect: s.product.pixel?.aspect.score ?? null,
          structure: s.product.pixel?.structure.score ?? null,
          bezel: s.product.pixel?.structure.bezelScore ?? null,
          colour: s.product.pixel?.histogram.score ?? null,
          view: s.product.view,
        }
      : null,
    cast: s.cast.map((c) => ({ ref: c.ref, score: c.score, cos: c.embeddingCos })),
    defects: s.defects.slice(0, 6),
    reasons: s.reasons.slice(0, 4),
  };
}
