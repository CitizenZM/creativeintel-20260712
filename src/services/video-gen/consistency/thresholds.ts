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

export const SHOT_THRESHOLDS: Record<ShotType, Thresholds> = {
  "product-closeup": { pass: 0.78, productMin: 0.78, productPixelMin: 0.55, castMin: 0.6, weights: { product: 0.85, cast: 0.15 }, pixelBlend: 0.45 },
  product: { pass: 0.72, productMin: 0.72, productPixelMin: 0.45, castMin: 0.65, weights: { product: 0.7, cast: 0.3 }, pixelBlend: 0.35 },
  "people-product": { pass: 0.7, productMin: 0.65, productPixelMin: 0.35, castMin: 0.72, weights: { product: 0.5, cast: 0.5 }, pixelBlend: 0.3 },
  "people-wide": { pass: 0.68, productMin: 0.55, productPixelMin: 0.25, castMin: 0.75, weights: { product: 0.3, cast: 0.7 }, pixelBlend: 0.2 },
  people: { pass: 0.7, productMin: 0.5, productPixelMin: 0.2, castMin: 0.75, weights: { product: 0.2, cast: 0.8 }, pixelBlend: 0.15 },
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
