// Fixed 2-second storyboard grid.
//
// A storyboard renders ONE action frame per 2 seconds of the video, so a 15s ad
// becomes 8 frames (0–2 … 14–15) and a 30s ad becomes 15. Every frame carries
// a HOOK | BODY | CTA segment derived deterministically from the script
// template's beat split, so hook and call-to-action are never ambiguous.

import { DEFAULT_BEATS, type BeatSplit } from "@/services/ai/prompts/script-templates";

export const FRAME_SECONDS = 2;
export const MAX_FRAMES = 45; // 90s ceiling at 2s/frame

export type FrameSegment = "HOOK" | "BODY" | "CTA";

export interface GridWindow {
  frameNumber: number; // 1-based
  startSec: number;
  endSec: number;
  duration: string; // "0s-2s"
  segment: FrameSegment;
}

/** Snap a second value to the nearest frame boundary (even second). */
function snapToGrid(sec: number): number {
  return Math.round(sec / FRAME_SECONDS) * FRAME_SECONDS;
}

export interface SegmentBounds {
  hookEndSec: number;
  ctaStartSec: number;
}

/**
 * Where HOOK ends and CTA starts for a duration + beat split, snapped to the
 * grid so segment boundaries always coincide with frame boundaries. Both the
 * hook and the CTA are guaranteed at least one frame.
 */
export function segmentBounds(totalDurationSec: number, beats: BeatSplit = DEFAULT_BEATS): SegmentBounds {
  const total = Math.max(FRAME_SECONDS * 2, Math.round(totalDurationSec) || 30);
  let hookEnd = snapToGrid((total * beats.hookPct) / 100);
  let ctaStart = total - snapToGrid((total * beats.ctaPct) / 100);
  if (hookEnd < FRAME_SECONDS) hookEnd = FRAME_SECONDS;
  if (total - ctaStart < FRAME_SECONDS) ctaStart = total - FRAME_SECONDS;
  ctaStart = snapToGrid(ctaStart);
  if (ctaStart <= hookEnd) ctaStart = Math.min(total - FRAME_SECONDS, hookEnd + FRAME_SECONDS);
  return { hookEndSec: hookEnd, ctaStartSec: ctaStart };
}

export function segmentForTime(startSec: number, bounds: SegmentBounds): FrameSegment {
  if (startSec < bounds.hookEndSec) return "HOOK";
  if (startSec >= bounds.ctaStartSec) return "CTA";
  return "BODY";
}

/**
 * Build the 2-second window grid for a given total duration. The final window
 * may be shorter than 2s (e.g. 14s–15s).
 */
export function computeWindows(totalDurationSec: number, beats: BeatSplit = DEFAULT_BEATS): GridWindow[] {
  const total = Math.max(FRAME_SECONDS, Math.round(totalDurationSec) || 30);
  const count = Math.min(MAX_FRAMES, Math.ceil(total / FRAME_SECONDS));
  const bounds = segmentBounds(total, beats);
  const windows: GridWindow[] = [];
  for (let i = 0; i < count; i++) {
    const startSec = i * FRAME_SECONDS;
    const endSec = Math.min(total, startSec + FRAME_SECONDS);
    windows.push({
      frameNumber: i + 1,
      startSec,
      endSec,
      duration: `${startSec}s-${endSec}s`,
      segment: segmentForTime(startSec, bounds),
    });
  }
  return windows;
}

export interface SceneLike {
  startSec?: number;
  endSec?: number;
  segmentLabel?: string;
  shotType?: string;
  focalLength?: string;
  cameraMovement?: string;
  aperture?: string;
  location?: string;
  lighting?: string;
  actorAction?: string;
  productAction?: string;
  voiceover?: string;
  textOverlay?: string;
  transition?: string;
  /** Which selling point this beat expresses (structured scripts only). */
  sellingPoint?: string;
  /** How the selling point is expressed: demonstration, on-screen proof, VO claim + evidence… */
  howExpressed?: string;
}

// ─── Structured script → scenes ──────────────────────────────────────────────

export interface StructuredHook {
  text?: string;
  visual?: string;
  shot?: string;
  durationSec?: number;
  hookFormula?: string;
}
export interface StructuredBeat {
  beat?: string;
  sellingPoint?: string;
  howExpressed?: string;
  shot?: string;
  startSec?: number;
  endSec?: number;
  voiceover?: string;
  textOverlay?: string;
  proof?: string;
  cameraMovement?: string;
  productAction?: string;
  actorAction?: string;
}
export interface StructuredCta {
  text?: string;
  offer?: string;
  urgency?: string;
  visual?: string;
  shot?: string;
  durationSec?: number;
}

/**
 * Flatten a structured script (hook{} / bodyBeats[] / cta{}) into time-coded
 * SceneLike[] so the grid can ground every frame. Falls back to the legacy
 * `scenes` array when the structured fields are absent.
 */
export function scenesFromScript(script: {
  scenes?: unknown;
  hook?: unknown;
  bodyBeats?: unknown;
  cta?: unknown;
  totalDurationSec?: number | null;
}): SceneLike[] {
  const hook = (script.hook ?? null) as StructuredHook | null;
  const beats = (Array.isArray(script.bodyBeats) ? script.bodyBeats : []) as StructuredBeat[];
  const cta = (script.cta ?? null) as StructuredCta | null;
  const total = script.totalDurationSec || 30;

  if (!hook && !beats.length && !cta) {
    return (Array.isArray(script.scenes) ? script.scenes : []) as SceneLike[];
  }

  const out: SceneLike[] = [];
  let cursor = 0;
  if (hook) {
    const d = Math.max(1, Math.round(hook.durationSec ?? Math.max(2, total * 0.2)));
    out.push({
      startSec: 0,
      endSec: d,
      segmentLabel: "HOOK",
      shotType: hook.shot,
      actorAction: hook.visual,
      voiceover: hook.text,
      textOverlay: hook.text,
    });
    cursor = d;
  }
  const ctaDur = cta ? Math.max(1, Math.round(cta.durationSec ?? Math.max(2, total * 0.2))) : 0;
  const bodyEnd = Math.max(cursor, total - ctaDur);
  const bodySpan = bodyEnd - cursor;
  beats.forEach((b, i) => {
    const s = typeof b.startSec === "number" ? b.startSec : cursor + (bodySpan * i) / Math.max(1, beats.length);
    const e =
      typeof b.endSec === "number" ? b.endSec : cursor + (bodySpan * (i + 1)) / Math.max(1, beats.length);
    out.push({
      startSec: Math.round(s),
      endSec: Math.round(e),
      segmentLabel: "BODY",
      shotType: b.shot,
      cameraMovement: b.cameraMovement,
      actorAction: b.actorAction ?? b.beat,
      productAction: b.productAction,
      voiceover: b.voiceover,
      textOverlay: b.textOverlay,
      sellingPoint: b.sellingPoint,
      howExpressed: [b.howExpressed, b.proof].filter(Boolean).join(" — ") || undefined,
    });
  });
  if (cta) {
    out.push({
      startSec: bodyEnd,
      endSec: total,
      segmentLabel: "CTA",
      shotType: cta.shot,
      actorAction: cta.visual,
      voiceover: cta.text,
      textOverlay: [cta.text, cta.offer, cta.urgency].filter(Boolean).join(" · "),
    });
  }
  return out;
}

/**
 * Find the script scene that best overlaps a window — the scene covering the
 * window's midpoint, falling back to the nearest by start time.
 */
export function sceneForWindow(scenes: SceneLike[], win: GridWindow): SceneLike | null {
  if (!scenes.length) return null;
  const mid = (win.startSec + win.endSec) / 2;
  const overlapping = scenes.find(
    (s) =>
      typeof s.startSec === "number" &&
      typeof s.endSec === "number" &&
      mid >= s.startSec &&
      mid < s.endSec
  );
  if (overlapping) return overlapping;
  let best: SceneLike | null = null;
  let bestDist = Infinity;
  for (const s of scenes) {
    const start = typeof s.startSec === "number" ? s.startSec : 0;
    const dist = Math.abs(start - win.startSec);
    if (dist < bestDist) {
      bestDist = dist;
      best = s;
    }
  }
  return best;
}

/**
 * Render the cinematography of a scene as a compact, prompt-ready digest used
 * to ground each frame's image prompt in the script's actual plan.
 */
export function sceneDigest(scene: SceneLike | null): string {
  if (!scene) return "(no matching script scene — infer from narrative)";
  const parts: string[] = [];
  if (scene.sellingPoint) parts.push(`Selling point: ${scene.sellingPoint}`);
  if (scene.howExpressed) parts.push(`Expressed by: ${scene.howExpressed}`);
  if (scene.shotType) parts.push(`Shot: ${scene.shotType}`);
  if (scene.focalLength) parts.push(`Lens: ${scene.focalLength}`);
  if (scene.aperture) parts.push(`Aperture: ${scene.aperture}`);
  if (scene.cameraMovement) parts.push(`Move: ${scene.cameraMovement}`);
  if (scene.location) parts.push(`Location: ${scene.location}`);
  if (scene.lighting) parts.push(`Lighting: ${scene.lighting}`);
  if (scene.actorAction) parts.push(`Actor: ${scene.actorAction}`);
  if (scene.productAction) parts.push(`Product: ${scene.productAction}`);
  if (scene.voiceover) parts.push(`VO: "${scene.voiceover}"`);
  if (scene.textOverlay) parts.push(`Text: "${scene.textOverlay}"`);
  return parts.length ? parts.join(" · ") : "(scene has no detail)";
}

export interface RawFrame {
  frameNumber?: number;
  duration?: string;
  segment?: string;
  scene?: string;
  visualDirection?: string;
  voiceover?: string;
  textOverlay?: string;
  cameraNotes?: string;
  imagePrompt?: string;
  videoPrompt?: string;
  shotType?: string;
  cameraMove?: string;
  subject?: string;
  productAction?: string;
  sfx?: string;
  sellingPoint?: string;
  howExpressed?: string;
  startSec?: number;
  endSec?: number;
  [k: string]: unknown;
}

export interface GridFrame {
  frameNumber: number;
  startSec: number;
  endSec: number;
  duration: string;
  segment: FrameSegment;
  scene: string;
  visualDirection: string;
  voiceover: string;
  textOverlay: string;
  cameraNotes: string;
  imagePrompt: string;
  videoPrompt: string;
  shotType: string;
  cameraMove: string;
  subject: string;
  productAction: string;
  sfx: string;
  sellingPoint: string;
  howExpressed: string;
}

/**
 * Stamp LLM output onto the exact grid: re-number frames, force exact
 * start/end/duration/segment per window, and guarantee a frame exists for
 * every window (padding from the matching scene if the model returned too
 * few). Extra frames beyond the grid are dropped. The segment always comes
 * from the grid, never from the model.
 */
export function repairFrames(raw: RawFrame[], windows: GridWindow[], scenes: SceneLike[]): GridFrame[] {
  const byNumber = new Map<number, RawFrame>();
  const unnumbered: RawFrame[] = [];
  for (const f of raw) {
    const n = typeof f.frameNumber === "number" ? f.frameNumber : NaN;
    if (Number.isFinite(n) && !byNumber.has(n)) byNumber.set(n, f);
    else unnumbered.push(f);
  }

  return windows.map((win, i) => {
    const src = byNumber.get(win.frameNumber) ?? unnumbered[i] ?? {};
    const scene = sceneForWindow(scenes, win);
    const fallbackScene =
      scene?.actorAction || scene?.productAction || scene?.segmentLabel || `Beat ${win.frameNumber}`;
    const str = (v: unknown, fb = "") => (v == null ? fb : String(v));
    return {
      frameNumber: win.frameNumber,
      startSec: win.startSec,
      endSec: win.endSec,
      duration: win.duration,
      segment: win.segment,
      scene: str(src.scene, fallbackScene),
      visualDirection: str(src.visualDirection),
      voiceover: str(src.voiceover, scene?.voiceover ?? ""),
      textOverlay: str(src.textOverlay, scene?.textOverlay ?? ""),
      cameraNotes: str(src.cameraNotes, scene?.cameraMovement ?? ""),
      imagePrompt: str(src.imagePrompt),
      videoPrompt: str(src.videoPrompt),
      shotType: str(src.shotType, scene?.shotType ?? ""),
      cameraMove: str(src.cameraMove, scene?.cameraMovement ?? ""),
      subject: str(src.subject),
      productAction: str(src.productAction, scene?.productAction ?? ""),
      sfx: str(src.sfx),
      sellingPoint: str(src.sellingPoint, scene?.sellingPoint ?? ""),
      howExpressed: str(src.howExpressed, scene?.howExpressed ?? ""),
    };
  });
}
