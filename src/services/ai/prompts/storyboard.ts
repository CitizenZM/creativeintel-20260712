import {
  computeWindows,
  sceneForWindow,
  sceneDigest,
  FRAME_SECONDS,
  type SceneLike,
} from "@/lib/storyboard-grid";
import { DEFAULT_BEATS, type BeatSplit } from "./script-templates";

export interface StoryboardInput {
  brandName: string;
  productName?: string;
  scriptTitle: string;
  scriptBody: string;
  /** All hook variants — the board may draw alternates for the HOOK frames. */
  hooks: string[];
  /** All CTA variants — the approved one is hooks/ctas[0] unless ctaText overrides. */
  ctas: string[];
  /** The approved CTA copy that CTA frames must display verbatim. */
  approvedCtaText?: string;
  approvedOffer?: string;
  style?: string;
  platform?: string;
  totalDurationSec?: number;
  templateName?: string;
  videoType?: string;
  /** Beat split from the script template — drives HOOK/BODY/CTA window tagging. */
  beats?: BeatSplit;
  /** Per-window cinematography plan flattened from the structured script. */
  scenes?: SceneLike[];
  brandTruth?: string;
}

export function buildStoryboardPrompt(input: StoryboardInput) {
  const dur = input.totalDurationSec || 30;
  const platform = input.platform || "TikTok";
  const scenes = input.scenes ?? [];
  const beats = input.beats ?? DEFAULT_BEATS;

  // The grid is authoritative — the model fills each pre-assigned window and
  // never decides how many frames exist or which segment a frame belongs to.
  const windows = computeWindows(dur, beats);
  const frameCount = windows.length;
  const productLabel = input.productName || input.brandName;
  const minProductFrames = Math.ceil(frameCount / 2);

  const windowPlan = windows
    .map((w) => `Frame ${w.frameNumber} — ${w.duration} — ${w.segment}\n  Script plan: ${sceneDigest(sceneForWindow(scenes, w))}`)
    .join("\n");

  const ctaFrames = windows.filter((w) => w.segment === "CTA").map((w) => w.frameNumber);
  const hookFrames = windows.filter((w) => w.segment === "HOOK").map((w) => w.frameNumber);

  const system = `You are a senior creative director and cinematographer building a shot-by-shot storyboard for a ${platform} video ad${
    input.templateName ? ` using the ${input.templateName} template` : ""
  }${input.videoType ? ` (${input.videoType})` : ""}.

FIXED ${FRAME_SECONDS}-SECOND GRID: output EXACTLY ${frameCount} frames, one per ${FRAME_SECONDS}-second window of the ${dur}s video. Do not merge, split, add or skip frames. Each frame's segment (HOOK / BODY / CTA) is already assigned — honour it, do not reassign it.

EVERY FRAME MUST CONTAIN A COMPLETE ACTION. A frame is ${FRAME_SECONDS} seconds of continuous motion, not a still pose:
- The keyframe you describe in imagePrompt is captured MID-MOTION — the hand is already closing on the product, the liquid is already falling, the door is already half open. Never describe a person standing still waiting for something to happen.
- videoPrompt is a TWO-BEAT MOTION PHRASE for image-to-video: where the motion starts, what changes in the middle, where it lands. ≤60 words, present tense, one continuous take, no cuts.

STYLE BIBLE — lock it once, restate it in every imagePrompt (each image is generated independently with no memory of the others):
- the same single human actor (exact age, ethnicity, hair, wardrobe) wherever they appear
- one consistent location and set dressing
- one consistent lighting setup and colour palette
- the product's exact appearance, materials and label

PER-FRAME FIELDS:
1. imagePrompt — 80–150 words, the most important field. Restate the style bible every time. Include camera (lens + aperture + angle), subject position/expression/action mid-motion (subject NOT looking at camera), environment surfaces and props, named lighting source + colour temperature in Kelvin, colour/mood palette. End with: "cinematic storyboard concept art, ${platform} video ad, photorealistic". Never depict on-screen text, UI or logos inside the image.
2. videoPrompt — ≤60 words, start → mid → end motion for image-to-video generation from this exact keyframe. Name the camera move and the subject/product motion. No dialogue, no cuts, no text.
3. shotType — shot size (extreme close-up / close-up / medium / wide / over-the-shoulder / macro / top-down).
4. cameraMove — the physical move (static / slow push-in / pull-out / handheld drift / whip-pan / orbit / tilt-up / rack focus).
5. subject — who or what is on screen and what they are doing in this window.
6. productAction — what the product is physically doing. "${productLabel}" must be clearly present in at least ${minProductFrames} of the ${frameCount} frames.
7. sfx — the sound design for this window (foley, impact, whoosh, silence, music cue).
8. textOverlay — ONLY copy that exists in the script. If the script has no on-screen text for this window, return an empty string. Never invent overlay copy.
9. voiceover — the exact VO for this window from the script, or an empty string.
10. cameraNotes — camera action + the transition INTO the next frame. Format: "[camera action]. Transition: [type] — [why]". Types: cut / cut-on-motion / cross-dissolve / whip-pan / match-cut / speed-ramp / dip-to-black / j-cut / l-cut / smash-cut.
11. sellingPoint / howExpressed — for BODY frames, the selling point this window carries and how it is expressed. Empty for HOOK/CTA frames unless the script plan supplies one.
${ctaFrames.length ? `\nCTA FRAMES (${ctaFrames.join(", ")}) must display the approved CTA copy in textOverlay${input.approvedOffer ? " together with the approved offer" : ""} — verbatim, no paraphrase.` : ""}
${hookFrames.length ? `HOOK FRAMES (${hookFrames.join(", ")}) must land the hook's opening visual inside frame ${hookFrames[0]}.` : ""}

Respond with ONLY valid JSON:
{
  "title": "string",
  "style": "string — the locked style bible in one line (actor, wardrobe, location, lighting, palette)",
  "totalDuration": "${dur}s",
  "frames": [
    {
      "frameNumber": 1,
      "duration": "0s-${FRAME_SECONDS}s",
      "segment": "HOOK",
      "scene": "string — one sentence of the complete action in this ${FRAME_SECONDS}s",
      "visualDirection": "string — composition, depth of field, colour, mood",
      "shotType": "string",
      "cameraMove": "string",
      "subject": "string",
      "productAction": "string",
      "sfx": "string",
      "voiceover": "string — exact VO or empty",
      "textOverlay": "string — script copy only, or empty",
      "cameraNotes": "string — camera action + 'Transition: [type] — [why]'",
      "imagePrompt": "string — 80–150 words, restates the style bible",
      "videoPrompt": "string — ≤60 words, start → mid → end motion",
      "sellingPoint": "string or empty",
      "howExpressed": "string or empty"
    }
    // ... EXACTLY ${frameCount} frames, in order
  ]
}`;

  const brandTruthBlock = input.brandTruth?.trim()
    ? `\nBRAND TRUTH (product appearance, colours, do-not-show list — the style bible must obey this):\n${input.brandTruth.trim().slice(0, 2000)}`
    : "";

  const user = `Create the ${frameCount}-frame, ${FRAME_SECONDS}-second-grid ${platform} storyboard for "${input.brandName}"${
    input.productName ? ` — product: ${input.productName}` : ""
  }:

Script Title: ${input.scriptTitle}
Total Duration: ${dur}s → ${frameCount} frames at ${FRAME_SECONDS}s each
Visual Style: ${input.style || "Cinematic, warm, authentic — NOT polished studio aesthetic"}
${brandTruthBlock}

HOOK VARIANTS (variant 1 is the one being boarded; the others are alternates you may borrow visual ideas from):
${input.hooks.length ? input.hooks.map((h, i) => `${i + 1}. ${h}`).join("\n") : "(none — take the hook from the script body)"}

CTA VARIANTS:
${input.ctas.length ? input.ctas.map((c, i) => `${i + 1}. ${c}`).join("\n") : "(none — take the CTA from the script body)"}
${input.approvedCtaText ? `\nAPPROVED CTA COPY (must appear verbatim in the CTA frames' textOverlay): "${input.approvedCtaText}"` : ""}${
    input.approvedOffer ? `\nAPPROVED OFFER: ${input.approvedOffer}` : ""
  }

SCRIPT:
${input.scriptBody}

PER-FRAME PLAN (segment is fixed — ground each frame's imagePrompt in its plan):
${windowPlan}

RULES:
- EXACTLY ${frameCount} frames, frameNumber 1..${frameCount}, durations and segments exactly as listed above.
- Every frame is a complete action captured mid-motion; every videoPrompt is a two-beat motion phrase of ≤60 words.
- Every imagePrompt (80–150 words) restates the same actor / wardrobe / location / lighting / product so all ${frameCount} images read as one shoot, and names lens + aperture + a lighting source with a Kelvin value.
- "${productLabel}" visibly present in at least ${minProductFrames} frames.
- textOverlay only ever contains copy that is in the script${input.approvedCtaText ? ", and the CTA frames carry the approved CTA copy verbatim" : ""}.
- Never render on-screen text inside the image itself.
- End every cameraNotes with "Transition: [type] — [reason]".`;

  return { system, user };
}
