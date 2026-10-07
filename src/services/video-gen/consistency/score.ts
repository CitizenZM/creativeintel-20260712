/**
 * scoreFrame — one numeric consistency verdict per frame, combining
 *   a. the vision model's structured comparison (presence, boxes, identity
 *      scores, named defects) — injectable,
 *   b. free local pixel metrics on the product's box vs the product photo,
 *   c. an optional face embedding (no-op unless configured),
 * with thresholds per shot type: a product close-up is strict on the product;
 * a wide family shot is looser on the (small) product and stricter on faces.
 */
import { cosine, defaultFaceEmbedder, faceCosineScore, type FaceEmbedder } from "./face";
import { cropBox, loadImage, productPixelScore, type BBox, type ImageSource, type PixelMetrics, type PixelWeights } from "./pixel-metrics";
import { defaultVisionScorer, type LabeledRef, type VisionReport, type VisionScorer } from "./vision";
import { inferShotType, SHOT_THRESHOLDS, type ShotType, type Thresholds } from "./thresholds";

export { inferShotType, isShotType, SHOT_THRESHOLDS, summarizeScore, type ShotType, type Thresholds } from "./thresholds";

export interface ConsistencyRefs {
  /** Casting sheet(s). */
  cast?: { image: ImageSource; label?: string }[];
  /** Official product photo(s) — a golden set of views; the best-matching one counts. */
  product?: { image: ImageSource; bbox?: BBox | null; label?: string }[];
  /** The segment's start frame (for END frames and clip samples). */
  start?: ImageSource;
}

export interface ScoreDeps {
  vision?: VisionScorer;
  faceEmbedder?: FaceEmbedder;
  /** Run the local pixel metrics (default true). */
  pixels?: boolean;
}

export interface ScoreOptions {
  shot: string;
  kind?: "start" | "end" | "clip";
  shotType?: ShotType;
  thresholds?: Partial<Thresholds>;
  /** Facts the product must show, e.g. "6.6 mm thick side profile, USB-C on the short edge". */
  productSpec?: string;
  /** Known product box in the frame — skips the vision model's box (pixel-only checks, calibration). */
  productBbox?: BBox;
  pixelWeights?: PixelWeights;
  deps?: ScoreDeps;
}

export interface ProductResult {
  expected: boolean;
  present: boolean;
  bbox: BBox | null;
  view: string | null;
  visionScore: number | null;
  pixel: (PixelMetrics & { refIndex: number }) | null;
  score: number;
}

export interface CastResult {
  ref: string;
  present: boolean;
  visionScore: number;
  embeddingCos: number | null;
  score: number;
}

export interface ConsistencyScore {
  /** 0–1 overall. */
  score: number;
  pass: boolean;
  /** False when neither the vision model nor a known box was available: not gated. */
  reviewed: boolean;
  shotType: ShotType;
  product: ProductResult | null;
  cast: CastResult[];
  /** Named defects ("bezel thicker: …"), the feedback for a re-roll. */
  defects: string[];
  /** Why it failed (or notes), human-readable. */
  reasons: string[];
  majorDefects: number;
  sceneConsistent: boolean | null;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

/**
 * Defects the pixel metrics can name on their own (geometry the vision model
 * may shrug off). Calibrated on real TCL photos: an official 25°-yaw view
 * deviates 0.21 in aspect from the front photo, a 30 % squash 0.36; the
 * official tablet bezel measures 4.4 % and a doubled one ~10 %.
 * `view` (from the vision model) relaxes the aspect check for angled/side views.
 */
export function pixelDefects(m: PixelMetrics, view?: string | null): { issue: string; major: boolean }[] {
  const out: { issue: string; major: boolean }[] = [];
  const frontish = !view || view === "front" || view === "none";
  const dev = m.aspect.deviation;
  if (dev > (frontish ? 0.25 : 0.6)) {
    const elongated = m.aspect.frame > m.aspect.ref;
    out.push({
      issue: `${elongated && dev > 0.6 ? "body too thin (stick-like)" : "aspect ratio wrong"}: proportions ${m.aspect.frame}:1 vs ${m.aspect.ref}:1 in the product photo`,
      major: dev > (frontish ? 0.3 : 0.9),
    });
  }
  const s = m.structure;
  if (s.bezelFrame !== null && s.bezelRef !== null) {
    // Ratio of widths in % of the short side, +1 % so two hair-thin edges never look far apart.
    const r = (s.bezelFrame * 100 + 1) / (s.bezelRef * 100 + 1);
    if (r > 1.35 || r < 1 / 1.6) {
      out.push({
        issue: `${r > 1 ? "bezel thicker" : "bezel thinner"}: ${pct(s.bezelFrame)} of the short side vs ${pct(s.bezelRef)} in the product photo`,
        major: r > 1.6,
      });
    }
  }
  if (s.score < 0.15 && m.aspect.score < 0.5) out.push({ issue: `product warped: shape and edge layout differ from the product photo (structure ${s.score})`, major: false });
  return out;
}

/**
 * Score one frame against the references. Never throws on a failed review: a
 * frame that could not be reviewed passes unreviewed (QC must not block a render).
 */
export async function scoreFrame(frame: ImageSource, refs: ConsistencyRefs, opts: ScoreOptions): Promise<ConsistencyScore> {
  const deps = opts.deps ?? {};
  const hasCast = !!refs.cast?.length;
  const hasProduct = !!refs.product?.length;
  const shotType = opts.shotType ?? inferShotType(opts.shot, { cast: hasCast, product: hasProduct });
  const t: Thresholds = { ...SHOT_THRESHOLDS[shotType], ...opts.thresholds };
  const frameBuf = await loadImage(frame).catch(() => null);
  const reasons: string[] = [];
  if (!frameBuf) {
    return { score: 0.5, pass: true, reviewed: false, shotType, product: null, cast: [], defects: [], reasons: ["frame could not be loaded — not gated"], majorDefects: 0, sceneConsistent: null };
  }

  const labeled: LabeledRef[] = [
    ...(opts.kind !== "start" && refs.start ? [{ role: "start" as const, label: "start frame of this shot", image: refs.start }] : []),
    ...(refs.cast ?? []).map((c) => ({ role: "cast" as const, label: c.label ?? "casting sheet", image: c.image })),
    ...(refs.product ?? []).slice(0, 2).map((p) => ({ role: "product" as const, label: p.label ?? "official product photo", image: p.image })),
  ];
  const report: VisionReport | null = await (deps.vision ?? defaultVisionScorer)({
    frame: frameBuf,
    refs: labeled,
    shot: opts.shot,
    kind: opts.kind ?? "start",
    productSpec: opts.productSpec,
  }).catch(() => null);

  if (!report && !opts.productBbox) {
    return { score: 0.5, pass: true, reviewed: false, shotType, product: null, cast: [], defects: [], reasons: ["vision review unavailable — not gated"], majorDefects: 0, sceneConsistent: null };
  }

  const defects: { issue: string; major: boolean }[] = (report?.defects ?? []).map((d) => ({ issue: d.issue.trim(), major: d.severity === "major" }));

  // Product: vision score blended with the pixel score on its box.
  let product: ProductResult | null = null;
  if (hasProduct) {
    const vp = report?.product ?? null;
    const bbox = opts.productBbox ?? vp?.bbox ?? null;
    const present = opts.productBbox ? true : !!vp?.present;
    let pixel: ProductResult["pixel"] = null;
    if (present && bbox && deps.pixels !== false) {
      pixel = await productPixelScore(frameBuf, bbox, refs.product!.map((p) => ({ image: p.image, bbox: p.bbox ?? null })), opts.pixelWeights).catch((err) => {
        reasons.push(`pixel metrics failed: ${err instanceof Error ? err.message.slice(0, 80) : err}`);
        return null;
      });
      if (pixel) defects.push(...pixelDefects(pixel, vp?.view));
    }
    const visionScore = vp && report ? vp.score : null;
    let score: number;
    if (!present) {
      score = 0;
      defects.push({ issue: "product missing from the frame", major: true });
    } else if (visionScore !== null && pixel) score = (1 - t.pixelBlend) * visionScore + t.pixelBlend * pixel.score;
    else score = visionScore ?? pixel?.score ?? 0.5;
    product = { expected: true, present, bbox, view: vp?.view ?? null, visionScore, pixel, score: r3(score) };
    if (product.score < t.productMin) reasons.push(`product ${product.score} < ${t.productMin} (${shotType})`);
    if (pixel && pixel.score < t.productPixelMin) reasons.push(`product pixels ${pixel.score} < ${t.productPixelMin} (aspect ${pixel.aspect.score}, structure ${pixel.structure.score}, colour ${pixel.histogram.score})`);
  }

  // Cast: vision identity, blended with a face embedding when one is configured.
  const cast: CastResult[] = [];
  if (hasCast && report) {
    const embedder = deps.faceEmbedder ?? defaultFaceEmbedder();
    const refEmb = embedder.name === "none" ? null : await loadImage(refs.cast![0].image).then((b) => embedder.embed(b)).catch(() => null);
    for (const c of report.cast) {
      let embeddingCos: number | null = null;
      if (refEmb && c.present && c.bbox) {
        const emb = await cropBox(frameBuf, c.bbox).then((b) => embedder.embed(b)).catch(() => null);
        if (emb) embeddingCos = r3(cosine(emb, refEmb));
      }
      const v = c.present ? c.identityScore : 0;
      const score = embeddingCos === null ? v : 0.5 * v + 0.5 * faceCosineScore(embeddingCos);
      cast.push({ ref: c.ref, present: c.present, visionScore: r3(v), embeddingCos, score: r3(score) });
      if (embeddingCos !== null && embeddingCos < 0.45) defects.push({ issue: `face differs: embedding cosine ${embeddingCos} vs the casting sheet`, major: true });
      if (c.present && score < t.castMin) reasons.push(`${c.ref} identity ${r3(score)} < ${t.castMin} (${shotType})`);
    }
    if (!report.cast.some((c) => c.present)) {
      defects.push({ issue: "cast missing: the person from the casting sheet is not in the frame", major: true });
      reasons.push("cast member missing");
    }
  }

  if (report?.sceneConsistent === false) defects.push({ issue: "scene changed from the start frame (room, light, framing or wardrobe)", major: false });

  // Overall: weighted product + worst cast member, minus minor defects, scaled down by major ones.
  const parts: [number, number][] = [];
  if (product) parts.push([product.score, t.weights.product]);
  const presentCast = cast.filter((c) => c.present);
  if (presentCast.length) parts.push([Math.min(...presentCast.map((c) => c.score)), t.weights.cast]);
  else if (hasCast && report) parts.push([0, t.weights.cast]);
  let score = parts.length ? parts.reduce((s, [v, w]) => s + v * w, 0) / parts.reduce((s, [, w]) => s + w, 0) : 1;
  const minor = defects.filter((d) => !d.major).length;
  const major = defects.filter((d) => d.major).length;
  score -= Math.min(0.15, 0.03 * minor);
  // A major defect fails the frame; the penalty keeps failing attempts ranked for best-of.
  if (major) score *= Math.max(0.4, 0.75 - 0.1 * (major - 1));
  score = r3(Math.max(0, score));

  const castOk = cast.every((c) => !c.present || c.score >= t.castMin) && (!hasCast || !report || cast.some((c) => c.present));
  const pass =
    score >= t.pass &&
    major === 0 &&
    (!product || (product.score >= t.productMin && (!product.pixel || product.pixel.score >= t.productPixelMin))) &&
    castOk;
  if (score < t.pass) reasons.unshift(`score ${score} < ${t.pass} (${shotType})`);
  if (major) reasons.push(`${major} major defect(s): ${defects.filter((d) => d.major).map((d) => d.issue).join("; ").slice(0, 300)}`);

  return {
    score,
    pass,
    reviewed: true,
    shotType,
    product,
    cast,
    defects: [...new Set(defects.map((d) => d.issue))].slice(0, 10),
    reasons,
    majorDefects: major,
    sceneConsistent: report?.sceneConsistent ?? null,
  };
}
