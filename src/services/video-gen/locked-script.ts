/**
 * Locked scripts — a hand-directed (or approved) ad renders exactly as written.
 *
 * A storyboard with style "locked-script" carries, per frame, the final keyframe
 * prompt (imagePrompt), motion prompt (videoPrompt) and a `locked` block:
 *   engine   kling | veo | veo1080 | local   which model renders the clip (local = a prepared still)
 *   refs     cast | product | cast+product | none   what the keyframe is edited from (installers and
 *            extras use "none", so they never inherit the lead's face)
 *   speed    time-remap factor for the edit (1-second install = 4)
 *   zoomHit  {x, y} push-in → hold → pull-back target for the edit (0–1 of the frame)
 *   compare  {other, labelOurs, labelOther} split-screen: the other side is generated from `other`
 *   localImageUrl  the still for engine "local" (end cards, screen close-ups)
 *   refImageUrl    a per-shot product reference used instead of the kit packshot (e.g. a front render
 *            whose real bezel must show, or the TV with this shot's picture already on screen)
 *   castLock (first frame) the lead's description for the casting reference image
 * No director rewrite, no comparison LLM split, no cast-lock heuristics.
 */
import type { CompiledJobDraft } from "./libtv-compile";
import { REALISM_STILL } from "./shot-director";

export type LockedEngine = "kling" | "veo" | "veo1080" | "local";
export type LockedRefs = "cast" | "product" | "cast+product" | "none";

export interface LockedBlock {
  engine: LockedEngine;
  refs?: LockedRefs;
  speed?: number;
  zoomHit?: { x: number; y: number };
  compare?: { other: string; labelOurs: string; labelOther: string };
  localImageUrl?: string;
  refImageUrl?: string;
  castLock?: string;
  fine?: string;
}

export interface LockedFrame {
  frameNumber: number;
  startSec: number;
  endSec: number;
  segment: string;
  imagePrompt?: string;
  videoPrompt?: string;
  locked: LockedBlock;
}

export const LOCKED_STYLE = "locked-script";

export function isLockedStoryboard(style: string | null | undefined): boolean {
  return style === LOCKED_STYLE;
}

export interface LockedVideoChoice {
  modelName: string;
  settings: Record<string, unknown>;
  credits: number;
}

/** Build the keyframe / clip / still jobs of a locked script. Pure. */
export function lockedDrafts(
  frames: LockedFrame[],
  opts: {
    imageModel: string;
    imgSettings: Record<string, unknown>;
    imageCredits: number;
    holdVideos?: boolean;
    video: (engine: Exclude<LockedEngine, "local">) => LockedVideoChoice;
  }
): { drafts: CompiledJobDraft[]; castDescription: string | null } {
  const drafts: CompiledJobDraft[] = [];
  const cast = frames.map((f) => f.locked?.castLock).find((c) => !!c?.trim()) ?? null;
  const usesCast = frames.some((f) => (f.locked?.refs ?? "none").includes("cast"));
  if (cast && usesCast) {
    drafts.push({
      shotIndex: -1,
      kind: "image",
      nodeName: "CAST",
      leftRefs: [],
      prompt: `Casting reference photo of the ad's on-camera talent: ${cast.trim()} Three-quarter body, facing the camera, relaxed expression, plain light-grey background, soft window light, 85mm lens. ${REALISM_STILL}`,
      modelName: opts.imageModel,
      settings: { ...opts.imgSettings, castSheet: 1, coversFrames: [], frameNumber: null, directed: 1 },
      sourceUrl: null,
      creditsEstimated: opts.imageCredits,
    });
  }
  const refsFor = (r: LockedRefs | undefined): { leftRefs: string[]; editFrom?: string } => {
    if (r === "cast" && cast) return { leftRefs: ["CAST"], editFrom: "cast" };
    if (r === "cast+product" && cast) return { leftRefs: ["CAST", "PROD-1"], editFrom: "cast+product" };
    if (r === "product" || ((r === "cast" || r === "cast+product") && !cast)) return { leftRefs: ["PROD-1"], editFrom: "product" };
    return { leftRefs: [] };
  };

  frames.forEach((f, index) => {
    const n = f.frameNumber;
    const L = f.locked ?? { engine: "local" as const };
    const len = Math.max(0.2, f.endSec - f.startSec);
    const base = { frameNumber: n, segment: f.segment, coversFrames: [n] };

    if (L.engine === "local") {
      const up = `LOC-${n}`;
      if (L.localImageUrl) {
        drafts.push({ shotIndex: -1, kind: "upload", nodeName: up, leftRefs: [], prompt: `Local still for frame ${n}`, modelName: null, settings: {}, sourceUrl: L.localImageUrl, creditsEstimated: 0 });
      }
      drafts.push({
        shotIndex: index,
        kind: "image",
        nodeName: `K${n}`,
        leftRefs: [L.localImageUrl ? up : "PROD-1"],
        prompt: `Local still — frame ${n}`,
        modelName: null,
        settings: { ...base, compositeLocally: true, zoomHit: L.zoomHit ?? null, speed: 1 },
        sourceUrl: null,
        creditsEstimated: 0,
      });
    } else {
      const r = refsFor(L.refs);
      if (L.refImageUrl) {
        // The shot's own reference replaces the kit packshot (a shot with no product ref gains one).
        const ref = `REF-${n}`;
        drafts.push({ shotIndex: -1, kind: "upload", nodeName: ref, leftRefs: [], prompt: `Product reference for frame ${n}`, modelName: null, settings: {}, sourceUrl: L.refImageUrl, creditsEstimated: 0 });
        if (!r.leftRefs.includes("PROD-1")) {
          r.leftRefs = r.editFrom === "cast" ? ["CAST", "PROD-1"] : ["PROD-1"];
          r.editFrom = r.editFrom === "cast" ? "cast+product" : "product";
        }
        r.leftRefs = r.leftRefs.map((x) => (x === "PROD-1" ? ref : x));
      }
      drafts.push({
        shotIndex: index,
        kind: "image",
        nodeName: `K${n}`,
        leftRefs: r.leftRefs,
        prompt: f.imagePrompt ?? "",
        modelName: opts.imageModel,
        settings: { ...opts.imgSettings, ...base, directed: 1, directedKeyframe: f.imagePrompt ?? "", ...(r.editFrom ? { editFrom: r.editFrom } : {}) },
        sourceUrl: null,
        creditsEstimated: opts.imageCredits,
      });
      const v = opts.video(L.engine);
      const clipSec = Number(v.settings.duration) || 4;
      const speed = Math.max(1, L.speed ?? 1);
      drafts.push({
        shotIndex: index,
        kind: "video",
        nodeName: `V${n}`,
        leftRefs: [`K${n}`],
        prompt: f.videoPrompt ?? "",
        modelName: v.modelName,
        settings: {
          ...v.settings,
          ...base,
          directed: 1,
          budgetMode: "full",
          frameSeconds: len,
          frameOffsetsSec: [{ frameNumber: n, clipStartSec: 0, clipEndSec: Math.min(clipSec, len * speed) }],
          speed,
          zoomHit: L.zoomHit ?? null,
          ...(opts.holdVideos ? { hold: 1 } : {}),
        },
        sourceUrl: null,
        creditsEstimated: v.credits,
      });
    }

    if (L.compare) {
      const k = drafts.find((d) => d.nodeName === `K${n}`)!;
      k.settings = { ...(k.settings as Record<string, unknown>), comparison: { otherNode: `K${n}X`, labelOurs: L.compare.labelOurs, labelOther: L.compare.labelOther } };
      drafts.push({
        shotIndex: index,
        kind: "image",
        nodeName: `K${n}X`,
        leftRefs: [],
        prompt: L.compare.other,
        modelName: opts.imageModel,
        settings: { ...opts.imgSettings, directed: 1, directedKeyframe: L.compare.other, comparisonOf: n, frameNumber: null, coversFrames: [] },
        sourceUrl: null,
        creditsEstimated: opts.imageCredits,
      });
    }
  });
  return { drafts, castDescription: cast };
}
