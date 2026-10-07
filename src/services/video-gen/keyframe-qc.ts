/**
 * AI keyframe QC: a vision model checks every generated keyframe for the
 * defects that make an ad look fake — melted faces, mangled hands, extra
 * limbs, garbled text or logos, a warped product — before a clip is made from
 * it. A failed keyframe is regenerated (once by default); the verdict is kept
 * on the job. KEYFRAME_QC=off disables it.
 */
import { z } from "zod";

export const MAX_KEYFRAME_REROLLS = Number(process.env.KEYFRAME_QC_REROLLS ?? 1);

const verdictSchema = z.object({
  ok: z.boolean(),
  issues: z.array(z.string()).default([]),
});

export type KeyframeVerdict = z.infer<typeof verdictSchema>;

export function keyframeQcEnabled(): boolean {
  if (process.env.KEYFRAME_QC === "on") return true;
  return process.env.KEYFRAME_QC !== "off" && !process.env.VITEST;
}

/**
 * Keyframes edited from references (cast sheet, product photo, start frame) go
 * through the numeric consistency gate (consistency/): vision rubric + local
 * pixel metrics, defects fed back as corrections, best-of after the re-rolls.
 * CONSISTENCY_QC=off falls back to the yes/no identity review below.
 */
export function consistencyGateEnabled(): boolean {
  return keyframeQcEnabled() && process.env.CONSISTENCY_QC !== "off";
}

/**
 * Clip drift check after a clip downloads: "on" (vision + pixels on 3 sampled
 * frames), "pixel" (free local checks only) or "off". CLIP_DRIFT_QC overrides;
 * by default it follows the keyframe QC switch.
 */
export function clipDriftMode(): "on" | "pixel" | "off" {
  const v = process.env.CLIP_DRIFT_QC;
  if (v === "on" || v === "pixel" || v === "off") return v;
  return keyframeQcEnabled() ? "on" : "off";
}

export const KEYFRAME_QC_SYSTEM = `You are the quality-control reviewer for AI-generated video-ad keyframes. Reject an image ONLY for clear production defects a viewer would notice on a phone:
- a deformed, melted or asymmetric face; wrong eyes or teeth
- hands with missing, extra or fused fingers; extra or missing limbs
- garbled, misspelled or nonsense text, letters or logos
- a visibly warped, bent or broken product (screens, devices, packaging)
- obvious AI artefacts: duplicated objects, smeared areas, broken geometry
- a collage, split screen, diptych or stacked panels instead of ONE continuous photograph
- any readable or pseudo text on screens, walls or captions (the edit adds real text later) — EXCEPT the product's own real logo and model name printed on the device itself, which are correct and expected
Stylisation, soft focus, motion blur and creative lighting are fine. If unsure, approve.
Return JSON only: {"ok": boolean, "issues": ["short defect description", ...]}.`;

/** Review one keyframe. Never throws: a failed review approves (QC must not block a render). */
/** A 512 px JPEG data URL: vision tokens scale with pixels, and defects show at this size. */
export async function smallImage(url: string, maxSide = 512): Promise<string> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return url;
    const sharp = (await import("sharp")).default;
    const jpg = await sharp(Buffer.from(await res.arrayBuffer())).resize({ width: maxSide, height: maxSide, fit: "inside" }).jpeg({ quality: 78 }).toBuffer();
    return `data:image/jpeg;base64,${jpg.toString("base64")}`;
  } catch {
    return url;
  }
}

/** Identity rules added when the keyframe was edited from references (cast sheet, product photo, start frame). */
export const IDENTITY_QC = `
IDENTITY (reference images follow the keyframe): reject when
- a person who should be from the casting sheet has a different face, hair, skin tone, age or build
- the product differs from the product reference in shape, bezel/frame thickness, ports, camera module, colour or logo placement
- for an END frame (reference = the start frame): the room, lighting, framing distance or wardrobe changed.
Name the mismatch in issues, e.g. "lead's face differs from casting sheet", "tablet bezel thicker than reference".`;

export interface KeyframeRefs {
  /** Labelled reference images, in the order the editor received them. */
  images: { label: string; url: string }[];
}

export async function reviewKeyframe(imageUrl: string, shot: string, refs?: KeyframeRefs): Promise<KeyframeVerdict | null> {
  try {
    const { analyzeWithClaude } = await import("@/services/ai/claude-client");
    const refParts = await Promise.all(
      (refs?.images ?? []).slice(0, 3).map(async (r, i) => [
        { type: "text" as const, text: `Reference ${i + 1} — ${r.label}:` },
        { type: "image_url" as const, url: await smallImage(r.url, 384) },
      ])
    );
    return await analyzeWithClaude({
      systemPrompt: refParts.length ? KEYFRAME_QC_SYSTEM + IDENTITY_QC : KEYFRAME_QC_SYSTEM,
      userPrompt: [
        { type: "text", text: `Intended shot: ${shot.replace(/\s+/g, " ").slice(0, 400)}\nReview this keyframe:` },
        { type: "image_url", url: await smallImage(imageUrl) },
        ...refParts.flat(),
      ],
      responseSchema: verdictSchema,
      maxTokens: 300,
    });
  } catch (err) {
    console.warn("[keyframe-qc] review failed, approving:", err instanceof Error ? err.message.slice(0, 160) : err);
    return null;
  }
}

/** Should this verdict send the keyframe back for another try? */
export function shouldReroll(verdict: KeyframeVerdict | null, attempts: number, max = MAX_KEYFRAME_REROLLS): boolean {
  return !!verdict && !verdict.ok && verdict.issues.length > 0 && attempts < max;
}
