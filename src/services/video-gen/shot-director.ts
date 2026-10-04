/**
 * Shot director — turns each storyboard beat into what an image-to-video model
 * actually needs: a photographic first frame and a motion script.
 *
 * Why it exists: the storyboard's `imagePrompt` / `videoPrompt` are previews
 * ("cinematic storyboard concept art"), so clips made from them were thin and
 * contradictory ("Beat 1 close-up … Beat 2 wide shot" inside one 4 s clip),
 * moved barely at all, and looked plastic. A directed shot has ONE continuous
 * action, a named shot size / lens / camera move, a timed action script,
 * concrete light and surface detail, and a shared look across the whole ad.
 *
 * Measured on identical first frames (Veo 3.1 Lite): the old prompt produced an
 * in-clip scene change; the directed prompt a single continuous shot with the
 * actor acting.
 */
import { z } from "zod";
import type { GridFrame } from "@/lib/storyboard-grid";
import type { CompiledJobDraft } from "./libtv-compile";

/** Surface realism that stops the waxy, airbrushed AI look. Appended to every directed still. */
export const REALISM_STILL =
  "Photographed on a full-frame cinema camera in natural available light: lifelike skin with visible pores, fine lines and slight unevenness, flyaway hairs, real fabric weave and creases, micro-scratches and dust on surfaces, shallow depth of field with real lens falloff, subtle film grain, true-to-life colour, no retouching, no beauty filter.";

/** Motion realism + the failure modes to avoid. Appended to every directed clip. */
export const REALISM_MOTION =
  "Live-action footage at natural speed (not slow motion): handheld micro-movement, real-world physics, motion blur on fast moves, consistent lighting, matte natural skin. Avoid: plastic or waxy skin, airbrushed faces, CGI or 3D-render look, over-sharpening, oversaturated HDR, morphing faces or hands, floating objects, text or logos.";

/** Hex codes become literal text in images. */
function stripHex(prompt: string): string {
  return prompt.replace(/#[0-9a-f]{6}\b/gi, "").replace(/\s{2,}/g, " ").trim();
}

export function finishDirectedStill(prompt: string): string {
  const p = stripHex(prompt);
  return /film grain/i.test(p) ? p : `${p} ${REALISM_STILL}`;
}

export function finishDirectedMotion(prompt: string): string {
  const p = stripHex(prompt);
  return /avoid:/i.test(p) ? p : `${p} ${REALISM_MOTION}`;
}

export interface DirectedShot {
  frameNumber: number;
  keyframe: string;
  motion: string;
}

export interface DirectedAd {
  shots: Map<number, DirectedShot>;
  /** A standalone description of the on-camera talent for the casting reference photo. */
  cast: string | null;
  source: "llm" | "fallback";
}

const outSchema = z.object({
  cast: z.string().optional(),
  shots: z
    .array(
      z.object({
        frameNumber: z.coerce.number(),
        keyframe: z.string().min(30),
        motion: z.string().min(30),
      })
    )
    .min(1),
});

export const DIRECTOR_SYSTEM = `You are the cinematographer and director of a 15–30 s vertical performance ad. You write prompts for photoreal image models (the FIRST FRAME of each shot) and image-to-video models (Veo, Kling, Wan: the MOTION of each shot). Return JSON only:
{"cast": "the on-camera talent as one standalone paragraph (age, ethnicity, build, hair, skin, face details, wardrobe fabrics and colours) — omit if no person appears", "shots": [{"frameNumber": n, "keyframe": "...", "motion": "..."}]}

KEYFRAME (70–110 words, plain sentences, no lists, no brand lettering):
- Start with shot size, angle, lens and aperture (e.g. "Medium close-up, eye level, 35mm f/2.8").
- Subject: age, features, hair, wardrobe fabric and colour, expression — caught MID-ACTION, never posed, never looking at camera unless the beat needs it.
- Environment: location plus three concrete lived-in props. Light: the source, its direction, colour temperature and quality (window light, practical lamp, overcast), plus one atmosphere detail (dust motes, steam, haze).
- Surface truth: skin pores and fine lines, fabric weave and creases, specular highlights on glass or metal, small imperfections. It should look photographed candidly, not rendered or studio-perfect.

MOTION (60–100 words) — ONE continuous shot, one setting, one shot size:
- Open with the camera move and its speed (handheld push-in, gimbal tracking, slow dolly out, 20° orbit, rack focus, whip pan). Never describe a cut, a second shot, a change of shot size, "Beat 1 / Beat 2", or a scene change inside the clip.
- Then a timed action script ("0–1.5 s: …  1.5–4 s: …") with strong physical verbs and body mechanics. Something visibly moves in the FIRST second — the clip never opens on a held pose. Include at least one large motion (a turn, a reach, an object entering frame) and secondary motion (hair, fabric, steam, dust, reflections, light shifting).
- The camera is NEVER locked off: no tripod, "static" or "locked-off" shots. Even a close-up or insert has handheld drift, a slow 4–6 % push, a slight orbit or parallax past a foreground object.
- The main motion is physical action by a person or the product (hands, body, an object entering or moving), not only light or glare changing. Give speed words ("quickly", "in one smooth sweep").
- Never freeze: no "frozen", "holds", "final static frame". End mid-movement, on a move that can be cut on.

RULES
- Continuity: the same talent, wardrobe, location family, colour grade and lens language in every shot (write "the same <short description>"). Vary shot size and camera move from shot to shot (wide, medium, close, insert; push, track, orbit, static-handheld) so the edit has contrast.
- Products are described by what they are and do. A screen shows a specific vivid image (a sunset over a mountain lake, a football match, a colourful nature documentary) — never text or UI. Show the product being used: a hand, a remote, a light changing in the room.
- If a frame's own imagePrompt asks for a comparison (split screen, versus, before/after), keep the words "split screen" in its keyframe and describe both sides, but write the motion for the brand's side only.
- Never put text, logos, captions, prices or UI in a frame. No celebrities.
- Every frame in the input gets exactly one shot, using its frameNumber.`;

interface DirectorFrameView {
  frameNumber: number;
  segment: string;
  seconds: string;
  voiceover: string;
  scene: string;
  visualDirection: string;
  shotType: string;
  cameraMove: string;
  subject: string;
  productAction: string;
  sellingPoint: string;
  imagePrompt: string;
}

const cut = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

export function frameView(f: GridFrame): DirectorFrameView {
  return {
    frameNumber: f.frameNumber,
    segment: cut(f.segment, 12),
    seconds: `${f.startSec}–${f.endSec}s`,
    voiceover: cut(f.voiceover, 160),
    scene: cut(f.scene, 220),
    visualDirection: cut(f.visualDirection, 220),
    shotType: cut(f.shotType, 60),
    cameraMove: cut(f.cameraMove, 80),
    subject: cut(f.subject, 120),
    productAction: cut(f.productAction, 160),
    sellingPoint: cut(f.sellingPoint, 100),
    imagePrompt: cut(f.imagePrompt, 320),
  };
}

const STORYBOARD_STYLE = /\b(?:cinematic )?storyboard concept art\b|\bconcept art\b|\btvc video ad\b|\byoutube video ad\b|\bphotorealistic\b/gi;

/**
 * No model available: a single-action shot from the storyboard's own fields —
 * still better than the old "Beat 1 / Beat 2" prompt (one move, one action,
 * movement from the first frame).
 */
export function fallbackShot(f: GridFrame): DirectedShot {
  const base = cut(f.imagePrompt || f.visualDirection || f.scene, 420).replace(STORYBOARD_STYLE, "").replace(/\s{2,}/g, " ").trim();
  const size = cut(f.shotType, 40) || "Medium shot";
  const action = cut(f.productAction || f.subject || f.scene, 200) || "the action unfolds";
  const move = cut(f.cameraMove, 80) || "slow handheld push-in";
  return {
    frameNumber: f.frameNumber,
    keyframe: `${size}, eye level, 35mm lens at f/2.8, candid documentary photograph. ${base} Natural window light, lived-in details, caught mid-action.`,
    motion: `${move.charAt(0).toUpperCase()}${move.slice(1)}, one continuous shot with no cut. 0–1.5 s: ${action}, visible movement from the very first frame. 1.5 s to the end: the action carries through and ends mid-movement; hair, fabric and light move naturally.`,
  };
}

/** Parse + complete the model's answer: every frame gets a shot (fallback for any it skipped). Pure. */
export function completeShots(frames: GridFrame[], raw: z.infer<typeof outSchema> | null): DirectedAd {
  const byNumber = new Map<number, DirectedShot>();
  for (const s of raw?.shots ?? []) {
    byNumber.set(s.frameNumber, { frameNumber: s.frameNumber, keyframe: s.keyframe.trim(), motion: s.motion.trim() });
  }
  const shots = new Map<number, DirectedShot>();
  let usedLlm = false;
  for (const f of frames) {
    const s = byNumber.get(f.frameNumber);
    if (s) usedLlm = true;
    shots.set(f.frameNumber, s ?? fallbackShot(f));
  }
  return { shots, cast: raw?.cast?.trim() || null, source: usedLlm ? "llm" : "fallback" };
}

export interface DirectInput {
  frames: GridFrame[];
  brand: string;
  product: string;
  /** What the product is and looks like (kit facts). */
  productFacts?: string;
  /** Real-world size line, so props and people are scaled right. */
  scale?: string;
  aspectRatio: string;
  clipSeconds: number;
  /** The ad's voiceover/script hook — what the viewer hears while each shot plays. */
  script?: string;
}

/** Direct the whole ad in one call so the look stays consistent; never throws. */
export async function directAd(input: DirectInput): Promise<DirectedAd> {
  if (process.env.SHOT_DIRECTOR === "off" || process.env.MOCK_AI === "true") return completeShots(input.frames, null);
  try {
    const { analyzeWithClaude } = await import("@/services/ai/claude-client");
    const user = JSON.stringify({
      brand: input.brand,
      product: input.product,
      productFacts: cut(input.productFacts, 500),
      scale: cut(input.scale, 240),
      aspectRatio: input.aspectRatio,
      clipSeconds: input.clipSeconds,
      script: cut(input.script, 500),
      frames: input.frames.map(frameView),
    });
    const raw = await analyzeWithClaude({
      systemPrompt: DIRECTOR_SYSTEM,
      userPrompt: user,
      responseSchema: outSchema,
      maxTokens: 6000,
      tier: "deep",
    });
    return completeShots(input.frames, raw);
  } catch (err) {
    console.warn("[director] shot design failed, using the fallback:", err instanceof Error ? err.message.slice(0, 200) : err);
    return completeShots(input.frames, null);
  }
}

/**
 * Replace the storyboard-preview prompts of the compiled keyframe (K<n>) and
 * clip (V<n>) jobs with the directed ones, and mark them `directed` so the
 * executor adds the realism block instead of the old "cinematic film still"
 * wrapper. `directedKeyframe` is the uncut text the cast-lock edit uses.
 */
export function applyDirectedShots(
  drafts: CompiledJobDraft[],
  ad: DirectedAd,
  opts: { castLocked: boolean; videoDirected: boolean; brandTruth?: string }
): number {
  let n = 0;
  for (const d of drafts) {
    const num = Number(/^[KV](\d+)$/.exec(d.nodeName)?.[1]);
    const shot = Number.isFinite(num) ? ad.shots.get(num) : undefined;
    if (!shot) continue;
    const settings = d.settings as Record<string, unknown>;
    if (d.kind === "image" && /^K/.test(d.nodeName) && !settings.compositeLocally) {
      d.prompt = opts.castLocked || !opts.brandTruth ? shot.keyframe : `${shot.keyframe}\n\n${opts.brandTruth.slice(0, 350)}`;
      d.settings = { ...settings, directed: 1, directedKeyframe: shot.keyframe };
      n++;
    } else if (d.kind === "video" && /^V/.test(d.nodeName) && opts.videoDirected) {
      d.prompt = `${shot.motion}\n\nThe product keeps its exact size, shape and colour throughout.`;
      d.settings = { ...settings, directed: 1 };
      n++;
    }
  }
  return n;
}
