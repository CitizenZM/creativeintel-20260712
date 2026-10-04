/**
 * Shot director — the ad's cinematographer and copy editor in one LLM pass.
 *
 * From the storyboard it plans, for the whole ad at once (one call, compact
 * JSON both ways to keep tokens down):
 *   1. selling points — what the product claims and HOW a camera proves each
 *   2. per shot: a camera move (push / pull / orbit / arc / track / crane / whip /
 *      rack focus — never locked off), a photographic first frame, a timed motion
 *      script, whether it is an action shot (rendered on Kling), the voiceover
 *      line (fitted to the shot's length) and a ≤ 4-word on-screen keyword
 *
 * Realism (from practice notes on AI footage): name the imperfections, light
 * with one hard raking key, ask for 35 mm documentary handheld; never ask for
 * "photorealistic / cinematic / 8K" (that's where the plastic comes from), and
 * keep negatives to 3–5 terms in the model's own negative-prompt field.
 */
import { z } from "zod";
import type { GridFrame } from "@/lib/storyboard-grid";
import type { CompiledJobDraft } from "./libtv-compile";
import { isComparisonPrompt } from "./comparison";

/** Surface realism for every directed still. */
export const REALISM_STILL =
  "35mm film photograph, handheld, documentary, observational framing. One hard warm key light raking from the side. Unretouched skin: visible pores, fine vellus hair, colour variation across cheeks and nose, slight asymmetry, small blemishes; real fabric weave and creases; dust, fingerprints and wear on surfaces.";

/** Motion realism for every directed clip (negatives go in the model's negative-prompt field). */
export const REALISM_MOTION = "Shot on 35mm film, handheld, documentary, observational. Real-world physics at natural speed, motion blur on fast moves.";

/** 3–5 negatives per model family (more over-constrains). */
export const NEGATIVE_PROMPTS: Record<"kling" | "veo" | "other", string> = {
  kling: "waxy skin, plastic texture, rubbery motion, floating hair, doll-like features",
  veo: "over-smoothed, detail loss, watercolor effect, painterly artifacts, pristine condition",
  other: "waxy skin, plastic texture, over-smoothed, CGI render",
};

export function negativePromptFor(model: string): string {
  return /kling/i.test(model) ? NEGATIVE_PROMPTS.kling : /veo/i.test(model) ? NEGATIVE_PROMPTS.veo : NEGATIVE_PROMPTS.other;
}

/** Words that pull models toward the glossy render look. */
const PLASTIC_WORDS = /\b(?:hyper-?realistic|photo-?realistic|ultra[- ]realistic|cinematic|8k|4k uhd|masterpiece|award[- ]winning|perfect skin|flawless|studio[- ]perfect|octane|unreal engine|3d render)\b/gi;

function tidy(prompt: string): string {
  return prompt.replace(/#[0-9a-f]{6}\b/gi, "").replace(PLASTIC_WORDS, "").replace(/\s+([.,;])/g, "$1").replace(/\s{2,}/g, " ").trim();
}

export function finishDirectedStill(prompt: string): string {
  const p = tidy(prompt);
  return p.includes("35mm film photograph") ? p : `${p} ${REALISM_STILL}`;
}

export function finishDirectedMotion(prompt: string): string {
  const p = tidy(prompt);
  return p.includes("Shot on 35mm film") ? p : `${p} ${REALISM_MOTION}`;
}

export const CAMERA_MOVES = ["push_in", "pull_out", "orbit", "arc", "track", "crane", "whip", "rack_focus", "handheld_follow"] as const;

export interface DirectedShot {
  frameNumber: number;
  keyframe: string;
  motion: string;
  camera: string;
  /** Strong human/body motion — rendered on the action model (Kling). */
  action: boolean;
  voiceover: string | null;
  onScreen: string | null;
  sellingPoint: number | null;
}

export interface SellingPoint {
  claim: string;
  proof: string;
}

export interface DirectedAd {
  shots: Map<number, DirectedShot>;
  cast: string | null;
  sellingPoints: SellingPoint[];
  source: "llm" | "fallback";
}

const outSchema = z.object({
  sp: z.array(z.object({ claim: z.string(), proof: z.string() })).optional(),
  cast: z.string().nullable().optional(),
  shots: z
    .array(
      z.object({
        f: z.coerce.number(),
        sp: z.coerce.number().nullable().optional(),
        cam: z.string().optional(),
        act: z.coerce.boolean().optional(),
        vo: z.string().nullable().optional(),
        txt: z.string().nullable().optional(),
        kf: z.string().min(30),
        mo: z.string().min(30),
      })
    )
    .min(1),
});

export const DIRECTOR_SYSTEM = `You direct a short vertical performance ad: think like a creative director, shoot like a commercial DP. Output JSON only:
{"sp":[{"claim":"selling point","proof":"what the camera shows that proves it"}],
 "cast":"on-camera talent as one paragraph: age, ethnicity, build, hair, skin, face, wardrobe fabric/colour (null if nobody appears)",
 "shots":[{"f":frameNumber,"sp":index into sp or null,"cam":"push_in|pull_out|orbit|arc|track|crane|whip|rack_focus|handheld_follow","act":true if a person makes a big body movement,"vo":"voiceover line","txt":"on-screen keyword","kf":"first frame","mo":"motion"}]}

1 SELLING POINTS: pick 2–4 from productFacts. Each gets a VISUAL proof (brightness: a sunlit room and the picture still punches; contrast: a night scene with true black beside a bright moon; colour: a macaw's feathers). Every BODY shot proves one selling point.
2 CAMERA — every shot moves, nothing is locked off or held: push_in / pull_out / orbit / arc (30–60°) / track / crane / whip / rack_focus / handheld_follow. Never repeat a move on consecutive shots. The product hero shot is an orbit while the product (or the room around it) turns, reading as a 360° reveal. The first shot opens on a fast move (whip or fast push_in); the last non-CTA shot pulls out or cranes up to reveal.
3 CONTINUITY — each clip is ONE continuous take in one place (no cuts, no shot-size change, no "Beat 1/Beat 2"). Movement direction carries across cuts (a push into shot n continues as forward motion in n+1). Same talent, wardrobe, location and light family throughout.
4 kf (55–85 words): shot size, angle, lens (e.g. "Medium close-up, low angle, 35mm"). Subject mid-action, never posed. Location + 2 concrete lived-in props. One hard key light: source, side, colour temperature. Name small imperfections (pores, creases, dust, fingerprints). Screens show a specific vivid image (macaw, football match, sunset lake) — never text or UI. Dark scenes are lit by the screen glow plus a practical lamp: faces and furniture readable on a phone, never underexposed. Never write photorealistic, cinematic, 8K, flawless or perfect.
5 mo (45–75 words): start with the camera move and speed, then "0–1s: … 1–3s: …" physical actions with strong verbs; movement in the very first second; secondary motion (hair, fabric, steam, reflections); end MID-movement, never frozen or holding.
6 vo: rewrite the storyboard voiceover so it sells — name the selling point with a concrete number or benefit. The whole ad speaks about 2.5 words per second, so most lines cover 2 shots: write the line on the first shot and set vo null on the shot(s) it covers. A line has at most the "words" of its shot plus those of the shots it covers. Lines read as one script in order. CTA line = the offer + action.
7 txt: 1–4 punchy words for the screen (e.g. "3,000 NITS", "TRUE BLACK"). HOOK = the hook question/claim ≤ 6 words. CTA = the offer. Never a full sentence.
8 cmp:1 marks a comparison frame: its kf MUST start "Split screen:" and describe both sides; mo covers only the brand side.
Every input frame gets exactly one shot with its f. No brand lettering, logos, prices or UI inside images.`;

const cut = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** The director's view of one frame — short keys, empty fields dropped (token budget). */
export function frameView(f: GridFrame): Record<string, unknown> {
  const len = Math.max(0.5, (f.endSec ?? 0) - (f.startSec ?? 0));
  const scene = [f.scene, f.visualDirection, f.imagePrompt].map((x) => cut(x, 200)).filter(Boolean).join(" | ");
  const v: Record<string, unknown> = {
    f: f.frameNumber,
    seg: cut(f.segment, 8),
    words: Math.max(3, Math.floor(len * 2.6)),
    vo: cut(f.voiceover, 160),
    txt: cut(f.textOverlay, 60),
    scene: scene.slice(0, 380),
    act: cut(f.productAction || f.subject, 140),
    sp: cut(f.sellingPoint, 90),
  };
  if (isComparisonPrompt(`${f.imagePrompt ?? ""} ${f.visualDirection ?? ""} ${f.scene ?? ""}`)) v.cmp = 1;
  for (const k of Object.keys(v)) if (v[k] === "" || v[k] == null) delete v[k];
  return v;
}

const STORYBOARD_STYLE = /\b(?:cinematic )?storyboard concept art\b|\bconcept art\b|\btvc video ad\b|\byoutube video ad\b/gi;
const FALLBACK_MOVES = ["fast push-in", "slow pull-out", "30° arc to the left", "tracking move to the right", "crane up", "orbit around the subject"];

/** No model available: a single-action shot with a moving camera, from the storyboard's own fields. */
export function fallbackShot(f: GridFrame, i = 0): DirectedShot {
  const base = tidy(cut(f.imagePrompt || f.visualDirection || f.scene, 420).replace(STORYBOARD_STYLE, ""));
  const size = cut(f.shotType, 40) || "Medium shot";
  const action = cut(f.productAction || f.subject || f.scene, 200) || "the action unfolds";
  const move = cut(f.cameraMove, 80) || FALLBACK_MOVES[i % FALLBACK_MOVES.length];
  return {
    frameNumber: f.frameNumber,
    keyframe: `${size}, eye level, 35mm lens. ${base} One hard window light from the side, lived-in details, caught mid-action.`,
    motion: `${move.charAt(0).toUpperCase()}${move.slice(1)}, one continuous take with no cut. 0–1s: ${action}, movement from the very first frame. 1s to the end: the action carries through and ends mid-movement; hair, fabric and light move naturally.`,
    camera: move,
    action: false,
    voiceover: null,
    onScreen: null,
    sellingPoint: null,
  };
}

/** Make sure a comparison frame still triggers the comparison split. */
function keepComparison(kf: string, isCmp: boolean): string {
  return isCmp && !isComparisonPrompt(kf) ? `Split screen: ${kf}` : kf;
}

export const WORDS_PER_SEC = 2.6;

const wordCount = (t: string | null) => (t ? t.split(/\s+/).filter(Boolean).length : 0);

/** Cut a line to `max` words at the last clause boundary that keeps most of it. */
export function trimLine(line: string, max: number): string {
  const w = line.split(/\s+/).filter(Boolean);
  if (w.length <= max) return line;
  const kept = w.slice(0, max).join(" ");
  const b = Math.max(kept.lastIndexOf(","), kept.lastIndexOf(";"), kept.lastIndexOf(" — "), kept.lastIndexOf("."));
  const clause = b > kept.length * 0.5 ? kept.slice(0, b) : kept;
  return `${clause.replace(/[\s,;:—-]+$/, "")}.`;
}

/**
 * Fit the voiceover to the ad's length. A line too long for its shot first takes
 * over the following shots (their lines are dropped — never across into the CTA),
 * and is trimmed at a clause boundary if it still doesn't fit. Without this the
 * TTS is sped up and pushes every later line off its shot. Pure.
 */
export function fitVoiceover(frames: GridFrame[], shots: Map<number, DirectedShot>): void {
  const order = [...frames].sort((a, b) => a.frameNumber - b.frameNumber);
  const budget = (f: GridFrame) => Math.max(3, Math.floor(Math.max(0.5, f.endSec - f.startSec) * WORDS_PER_SEC));
  for (let i = 0; i < order.length; i++) {
    const shot = shots.get(order[i].frameNumber);
    if (!shot?.voiceover) continue;
    const isCta = (f: GridFrame) => String(f.segment).toUpperCase() === "CTA";
    let allow = budget(order[i]);
    let j = i + 1;
    while (wordCount(shot.voiceover) > allow * 1.15 && j < order.length && isCta(order[j]) === isCta(order[i])) {
      allow += budget(order[j]);
      const next = shots.get(order[j].frameNumber);
      if (next) next.voiceover = null;
      j++;
    }
    if (wordCount(shot.voiceover) > Math.ceil(allow * 1.15)) shot.voiceover = trimLine(shot.voiceover, allow);
  }
}

/** Complete the model's answer: every frame gets a shot (fallback for any it skipped). Pure. */
export function completeShots(frames: GridFrame[], raw: z.infer<typeof outSchema> | null): DirectedAd {
  const byNumber = new Map((raw?.shots ?? []).map((s) => [s.f, s]));
  const shots = new Map<number, DirectedShot>();
  let usedLlm = false;
  frames.forEach((f, i) => {
    const s = byNumber.get(f.frameNumber);
    const isCmp = frameView(f).cmp === 1;
    if (!s) {
      const fb = fallbackShot(f, i);
      shots.set(f.frameNumber, { ...fb, keyframe: keepComparison(fb.keyframe, isCmp) });
      return;
    }
    usedLlm = true;
    const txt = cut(s.txt, 48);
    shots.set(f.frameNumber, {
      frameNumber: f.frameNumber,
      keyframe: keepComparison(s.kf.trim(), isCmp),
      motion: s.mo.trim(),
      camera: cut(s.cam, 24) || "push_in",
      action: !!s.act,
      voiceover: cut(s.vo, 220) || null,
      onScreen: txt && txt.split(/\s+/).length <= 6 ? txt : null,
      sellingPoint: typeof s.sp === "number" ? s.sp : null,
    });
  });
  fitVoiceover(frames, shots);
  return {
    shots,
    cast: raw?.cast?.trim() || null,
    sellingPoints: (raw?.sp ?? []).slice(0, 5).map((p) => ({ claim: cut(p.claim, 80), proof: cut(p.proof, 160) })),
    source: usedLlm ? "llm" : "fallback",
  };
}

export interface DirectInput {
  frames: GridFrame[];
  brand: string;
  product: string;
  productFacts?: string;
  scale?: string;
  aspectRatio: string;
  clipSeconds: number;
}

/** Direct the whole ad in one call; never throws. */
export async function directAd(input: DirectInput): Promise<DirectedAd> {
  if (process.env.SHOT_DIRECTOR === "off" || process.env.MOCK_AI === "true") return completeShots(input.frames, null);
  try {
    const { analyzeWithClaude } = await import("@/services/ai/claude-client");
    const user = JSON.stringify({
      brand: input.brand,
      product: input.product,
      productFacts: cut(input.productFacts, 450),
      scale: cut(input.scale, 160),
      ratio: input.aspectRatio,
      clipSec: input.clipSeconds,
      frames: input.frames.map(frameView),
    });
    const raw = await analyzeWithClaude({ systemPrompt: DIRECTOR_SYSTEM, userPrompt: user, responseSchema: outSchema, maxTokens: 5000, tier: "deep" });
    return completeShots(input.frames, raw);
  } catch (err) {
    console.warn("[director] shot design failed, using the fallback:", err instanceof Error ? err.message.slice(0, 200) : err);
    return completeShots(input.frames, null);
  }
}

/** What the edit needs from the plan, stored on the run (LibtvRun.directorPlan). */
export interface StoredDirectorPlan {
  sellingPoints: SellingPoint[];
  frames: Record<string, { vo: string | null; txt: string | null; cam: string; act: boolean }>;
}

export function storedPlan(ad: DirectedAd): StoredDirectorPlan | null {
  if (ad.source !== "llm") return null;
  const frames: StoredDirectorPlan["frames"] = {};
  for (const [n, s] of ad.shots) frames[String(n)] = { vo: s.voiceover, txt: s.onScreen, cam: s.camera, act: s.action };
  return { sellingPoints: ad.sellingPoints, frames };
}

/**
 * Replace the storyboard-preview prompts of the compiled keyframe (K<n>) and
 * clip (V<n>) jobs with the directed ones, and mark them `directed`.
 * `actionVideo` re-routes action shots to the action model (Kling).
 */
export function applyDirectedShots(
  drafts: CompiledJobDraft[],
  ad: DirectedAd,
  opts: {
    castLocked: boolean;
    videoDirected: boolean;
    brandTruth?: string;
    actionVideo?: { modelName: string; settings: Record<string, unknown>; credits: number } | null;
  }
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
      d.settings = { ...settings, directed: 1, camera: shot.camera };
      if (shot.action && opts.actionVideo) {
        d.modelName = opts.actionVideo.modelName;
        d.settings = { ...(d.settings as Record<string, unknown>), ...opts.actionVideo.settings, actionShot: 1 };
        d.creditsEstimated = opts.actionVideo.credits;
      }
      n++;
    }
  }
  return n;
}
