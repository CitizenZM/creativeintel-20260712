/**
 * Optional face embeddings (identity as a number, not a judgement).
 *
 * Nothing in node_modules provides one (checked 2026-10-06: no face-api,
 * @vladmandic/human, onnxruntime or tfjs), and heavy native deps don't belong
 * on Vercel — so the default embedder is a no-op and identity comes from the
 * vision rubric alone.
 *
 * ADAPTER POINT: set FACE_EMBED_URL to a local worker (e.g. a small Node or
 * Python service running face-api.js / an ArcFace ONNX model with a commercial
 * licence — InsightFace's pretrained weights are non-commercial). Contract:
 *   POST <FACE_EMBED_URL>  body: image/jpeg (one face crop)
 *   200 {"embedding": number[]}   (L2-normalised or not; cosine is used)
 *   200 {"embedding": null}       (no face found)
 * Or inject any `FaceEmbedder` into scoreFrame.
 */
export interface FaceEmbedder {
  readonly name: string;
  /** Embedding of the most prominent face in the crop, or null when none is found / unavailable. */
  embed(faceCrop: Buffer): Promise<number[] | null>;
}

export const noopFaceEmbedder: FaceEmbedder = {
  name: "none",
  async embed() {
    return null;
  },
};

export function httpFaceEmbedder(url: string, timeoutMs = 10_000): FaceEmbedder {
  return {
    name: `http:${url}`,
    async embed(faceCrop) {
      try {
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: new Uint8Array(faceCrop), signal: AbortSignal.timeout(timeoutMs) });
        if (!res.ok) return null;
        const j = (await res.json()) as { embedding?: unknown };
        return Array.isArray(j.embedding) && j.embedding.every((n) => typeof n === "number") ? (j.embedding as number[]) : null;
      } catch {
        return null;
      }
    },
  };
}

/** The configured embedder: FACE_EMBED_URL → the local worker, else the no-op. */
export function defaultFaceEmbedder(): FaceEmbedder {
  const url = process.env.FACE_EMBED_URL;
  return url ? httpFaceEmbedder(url) : noopFaceEmbedder;
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/**
 * ArcFace-style cosine → 0–1 identity score: research starting points are
 * pass ≥ 0.55, fail < 0.45 (calibrate on our own accepted/rejected frames).
 */
export function faceCosineScore(cos: number): number {
  return Math.max(0, Math.min(1, (cos - 0.25) / (0.65 - 0.25)));
}
