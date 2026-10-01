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

export const KEYFRAME_QC_SYSTEM = `You are the quality-control reviewer for AI-generated video-ad keyframes. Reject an image ONLY for clear production defects a viewer would notice on a phone:
- a deformed, melted or asymmetric face; wrong eyes or teeth
- hands with missing, extra or fused fingers; extra or missing limbs
- garbled, misspelled or nonsense text, letters or logos
- a visibly warped, bent or broken product (screens, devices, packaging)
- obvious AI artefacts: duplicated objects, smeared areas, broken geometry
- a collage, split screen, diptych or stacked panels instead of ONE continuous photograph
- any readable or pseudo text on screens, walls or captions (the edit adds real text later)
Stylisation, soft focus, motion blur and creative lighting are fine. If unsure, approve.
Return JSON only: {"ok": boolean, "issues": ["short defect description", ...]}.`;

/** Review one keyframe. Never throws: a failed review approves (QC must not block a render). */
export async function reviewKeyframe(imageUrl: string, shot: string): Promise<KeyframeVerdict | null> {
  try {
    const { analyzeWithClaude } = await import("@/services/ai/claude-client");
    return await analyzeWithClaude({
      systemPrompt: KEYFRAME_QC_SYSTEM,
      userPrompt: [
        { type: "text", text: `Intended shot: ${shot.replace(/\s+/g, " ").slice(0, 400)}\nReview this keyframe:` },
        { type: "image_url", url: imageUrl },
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
