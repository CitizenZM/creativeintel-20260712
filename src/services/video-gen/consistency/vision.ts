/**
 * Vision-model structured consistency scoring. The model gets the frame and the
 * labelled references (cast sheet, official product photo, the shot's start
 * frame) and returns per-subject presence, a normalised bounding box, a 0–1
 * identity score and named defects — comparing specific details, not a vibe.
 *
 * Runtime uses the app's existing vision route (analyzeWithClaude: the free
 * GLM vision model in strict free mode). Tests inject a `VisionScorer`.
 */
import { z } from "zod";
import sharp from "sharp";
import type { BBox, ImageSource } from "./pixel-metrics";

export type RefRole = "cast" | "product" | "start";

export interface LabeledRef {
  role: RefRole;
  /** e.g. "casting sheet", "official product photo (front)". */
  label: string;
  image: ImageSource;
}

const MATCH = z.enum(["match", "mismatch", "not_visible"]).catch("not_visible");
const score01 = z.preprocess((v) => (typeof v === "string" ? Number(v) : v), z.number().catch(0)).transform((v) => (v > 1 && v <= 100 ? v / 100 : Math.max(0, Math.min(1, v))));

/**
 * Boxes as [x0, y0, x1, y1] 0–1. Some vision models (GLM-4V) answer in 0–1000
 * coordinates: those are scaled down. Anything malformed becomes null.
 */
export const bboxSchema = z
  .unknown()
  .transform((v): BBox | null => {
    if (!Array.isArray(v) || v.length !== 4 || !v.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
    const scale = v.some((n) => n > 1.5) ? 1000 : 1;
    const b = v.map((n) => Math.max(0, Math.min(1, n / scale))) as BBox;
    return b[2] - b[0] > 0.005 && b[3] - b[1] > 0.005 ? b : null;
  });

export const visionReportSchema = z.object({
  product: z
    .object({
      expected: z.boolean().catch(true),
      present: z.boolean().catch(false),
      bbox: bboxSchema.optional().default(null),
      refBbox: bboxSchema.optional().default(null),
      view: z.enum(["front", "angled", "side", "back", "detail", "none"]).catch("none"),
      score: score01,
      checks: z
        .object({ bezel: MATCH, thickness: MATCH, aspect: MATCH, ports: MATCH, stand: MATCH, logo: MATCH, colour: MATCH })
        .partial()
        .catch({}),
    })
    .nullable()
    .catch(null),
  cast: z
    .array(
      z.object({
        ref: z.string().catch("cast"),
        present: z.boolean().catch(false),
        bbox: bboxSchema.optional().default(null),
        identityScore: score01,
        checks: z.object({ face: MATCH, hair: MATCH, skinTone: MATCH, age: MATCH, clothing: MATCH }).partial().catch({}),
      })
    )
    .catch([]),
  /** END frames: does the room, light, lens and wardrobe still match the start frame? */
  sceneConsistent: z.boolean().nullable().catch(null),
  defects: z
    .array(
      z.object({
        subject: z.enum(["product", "cast", "scene"]).catch("scene"),
        issue: z.string(),
        severity: z.enum(["minor", "major"]).catch("minor"),
      })
    )
    .catch([]),
});

export type VisionReport = z.infer<typeof visionReportSchema>;

export const CONSISTENCY_RUBRIC = `You are a strict product- and character-consistency inspector for AI-generated video-ad frames.
You get ONE frame, then labelled reference images. Compare the frame against each reference DETAIL BY DETAIL — never by overall vibe.

PRODUCT vs the official product photo — check each, answer match | mismatch | not_visible:
- bezel: width of the border around the screen relative to the screen, and that it is equally thin on all four sides
- thickness: body depth vs height in side or angled views (a tablet/TV side is a slim slab with real depth and ports, never a featureless stick, never chunky)
- aspect: the body's width:height proportion (no stretching or squashing)
- ports: port and button positions and count; camera module shape and position
- stand: stand/feet shape, position and finish
- logo: logo spelling and placement (a missing logo is fine; an invented or misspelled one is not)
- colour: body colour and finish
Product score: 1.0 indistinguishable from the reference · 0.8 same product, minor rendering differences · 0.6 one clear spec mismatch · 0.4 several mismatches · 0.2 a different product · 0 expected but absent.

PEOPLE vs the casting sheet — for each person on the sheet: face shape (jaw, eyes, nose, mouth), hair (colour, length, style), skin tone, apparent age, build, clothing.
Identity score: 1.0 clearly the same person · 0.8 same person, small drift · 0.6 resembles but one feature differs · 0.4 a different-looking person · 0 absent.
People who are NOT from the casting sheet (extras, installers) are ignored for identity.

For an END frame (a reference labelled "start frame"): set sceneConsistent=false when the room, lighting, lens/framing distance or wardrobe changed.

DEFECTS — list every concrete problem. Start each issue with one of these tags when it applies:
"bezel thicker", "bezel uneven", "body too thin (stick-like)", "body too thick", "aspect ratio wrong", "ports moved", "camera module wrong", "stand wrong", "logo misspelled", "logo misplaced", "colour wrong", "product warped", "looks like a framed painting",
"face differs", "hair differs", "skin tone differs", "age differs", "clothing differs", "extra limb", "hand deformed", "face deformed", "garbled text", "collage", "scene changed".
severity "major" = a viewer would notice on a phone (wrong product shape or bezel, a different person, anatomy errors, garbled text); otherwise "minor".

Boxes: [x0, y0, x1, y1] as fractions 0–1 of the image width/height. product.bbox = the product in the FRAME; product.refBbox = the product in the product reference image.
Return JSON only, exactly this shape:
{"product": {"expected": true, "present": true, "bbox": [0,0,1,1], "refBbox": [0,0,1,1], "view": "front|angled|side|back|detail|none", "score": 0.0,
  "checks": {"bezel": "match", "thickness": "match", "aspect": "match", "ports": "not_visible", "stand": "not_visible", "logo": "match", "colour": "match"}},
 "cast": [{"ref": "casting sheet", "present": true, "bbox": [0,0,1,1], "identityScore": 0.0, "checks": {"face": "match", "hair": "match", "skinTone": "match", "age": "match", "clothing": "match"}}],
 "sceneConsistent": null,
 "defects": [{"subject": "product|cast|scene", "issue": "bezel thicker: ...", "severity": "minor|major"}]}
Use "product": null when no product reference is given, and "cast": [] when no casting sheet is given.`;

export interface VisionInput {
  frame: ImageSource;
  refs: LabeledRef[];
  /** The intended shot (keyframe prompt). */
  shot: string;
  /** Which frame of the segment this is. */
  kind: "start" | "end" | "clip";
  productSpec?: string;
}

export type VisionScorer = (input: VisionInput) => Promise<VisionReport | null>;

/** A small JPEG data URL for the vision model (tokens scale with pixels). */
export async function visionImage(src: ImageSource, maxSide: number): Promise<string> {
  if (typeof src === "string" && /^https?:\/\//.test(src)) {
    const { smallImage } = await import("../keyframe-qc");
    return smallImage(src, maxSide);
  }
  const { loadImage } = await import("./pixel-metrics");
  const jpg = await sharp(await loadImage(src), { failOn: "none" })
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({ width: maxSide, height: maxSide, fit: "inside" })
    .jpeg({ quality: 80 })
    .toBuffer();
  return `data:image/jpeg;base64,${jpg.toString("base64")}`;
}

/** The runtime scorer: one structured vision call. Never throws (null = review unavailable). */
export const defaultVisionScorer: VisionScorer = async (input) => {
  try {
    const { analyzeWithClaude } = await import("@/services/ai/claude-client");
    const refParts = await Promise.all(
      input.refs.slice(0, 4).map(async (r, i) => [
        { type: "text" as const, text: `Reference ${i + 1} — ${r.label}:` },
        { type: "image_url" as const, url: await visionImage(r.image, r.role === "product" ? 512 : 384) },
      ])
    );
    const intro = [
      `Intended shot: ${input.shot.replace(/\s+/g, " ").slice(0, 500)}`,
      input.kind === "end" ? "This is the END frame of the segment." : input.kind === "clip" ? "This frame was sampled from the generated clip." : "This is the START frame of the segment.",
      input.productSpec ? `Product spec facts: ${input.productSpec}` : "",
      "Frame to inspect:",
    ]
      .filter(Boolean)
      .join("\n");
    return await analyzeWithClaude({
      systemPrompt: CONSISTENCY_RUBRIC,
      userPrompt: [{ type: "text", text: intro }, { type: "image_url", url: await visionImage(input.frame, 768) }, ...refParts.flat()],
      responseSchema: visionReportSchema,
      maxTokens: 900,
    });
  } catch (err) {
    console.warn("[consistency] vision scoring failed:", err instanceof Error ? err.message.slice(0, 160) : err);
    return null;
  }
};
