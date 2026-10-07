/**
 * Edit engine v2 — turns finished clips into a paced, beat-cut, sound-designed
 * ad on the server:
 *
 *   1. plan      edit-plan.ts: shots on a 120 BPM grid, transitions, text cards
 *   2. shots     each shot rendered frame-exact (reframe / punch-in; stills move)
 *   3. concat    hard cuts exactly on beat frames
 *   4. final     one encode: beat accents (light + scale pop on every beat),
 *                flash / whip / zoom envelopes on the boundaries, hook headline,
 *                claim chips, offer card, CTA button and word-by-word captions;
 *                voiceover + synthesised music (ducked under the voice) + SFX,
 *                normalised to −14 LUFS / −1.5 dBTP
 *   5. QC        measured on the file (qc.ts), plus a 720p preview and a contact sheet
 *
 * Every step is deterministic given the clips, so a re-assembly is identical.
 */
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { pMap } from "@/lib/parallel";
import { FPS, fitTempo, round3 } from "./beat-grid";
import { CTA_BUTTON_SEC, planEdit, type EditPlan, type HookStyle, type PlanInputSegment, type Shot } from "./edit-plan";
import { fitLayerPng, layoutBox, separateCaptions, textCanvas } from "./safe-layout";
import type { PlatformId } from "@/services/creative/types";
import { synthesizeMusic, toWav } from "./music-synth";
import { isMoodId, MOOD_ENERGY, MOOD_MIX_DB, MOOD_TEMPO, SEASONAL_COPY, type MoodId } from "./music-moods";
import { bestWindow, motionScores, reframeTrack } from "./motion";
import { composeCtaHero, ctaHeroDecision } from "./cta-hero";
import { detectBeats, trackWindowStart } from "./beat-detect";
import { measureCuts, measureMaster, scoreQc, type QcReport } from "./qc";
import { renderSfxBed } from "./sfx";
import { applyScreenPlates } from "./screen-plate";
import { claimChipPng, comparisonLabelPng, ctaButtonPng, domainPng, finePrintPng, hookHeadlinePng, kineticCaptionPng, logoPng, nativeCaptionPng, offerCardPng } from "./text-layers";
import { audioMixGraph, nativeAudioWindows, talkCaptionWords, ttsFrames, type NativeWindow } from "./native-audio";
import { nativeCaptionAt, nativeCaptionBounds, type CaptionStyle } from "./caption-style";
import { parseSilences, speechSpan } from "../talk-frame";
import { endCardLayers, endCardSlots, layerFilter, layerInputArgs, RENDERABLE_END_CARDS, type EndCardTemplate, type LayerAnim } from "./endcard-render";
import { DEFAULT_STYLE, type BrandStyle } from "./brand-style";
import { kineticGroups, shownForm, timedWords, toSrt, subtitleCues, type SubtitleCue, type TimedWord } from "../voiceover";
import { speakVoiceover, type AssembleFrame, type Segment } from "../glm-assemble";

const run = promisify(execFile);

type Canvas = { w: number; h: number };

/**
 * Corrections the pre-flight auto-fix loop (autofix.ts) re-renders with — re-edit only, nothing is
 * generated. Every field is optional; none set = the normal edit.
 */
export interface EditFixes {
  /** Tighten the platform safe box by this share of the width on every side. */
  layoutInset?: number;
  /** A dark opener: measure the first clip and start 0.1–0.3 s in, on its first bright frame. */
  brightOpen?: boolean;
  /** loudnorm integrated target (default −14 LUFS) — offsets a mix that measured off target. */
  loudnessTarget?: number;
  /** Caption every spoken group, even one repeating an on-screen card (captions coverage). */
  allCaptions?: boolean;
  /** Always hold the CTA button over the last second (no CTA frame, or an end card that hides it). */
  forceCta?: boolean;
}

export interface EditV2Result {
  masterFile: string;
  previewFile: string;
  contactSheetFile: string;
  voiceoverFile: string | null;
  srt: string | null;
  qc: QcReport;
  plan: EditPlan;
  /** Local cover files (9:16 / 1:1 / 4:5) from the best frame; null when cover making failed. */
  covers: (import("./covers").CoversResult & { headline: string | null }) | null;
}

const f3 = (n: number) => n.toFixed(3);

/** Per-shot video filter: reframe a clip, or fit a still and give it a camera move. */
export const FILM_FINISH = [
  "gblur=sigma=0.45",
  "curves=master='0/0.035 0.25/0.245 0.75/0.735 1/0.94'",
  "eq=saturation=0.88",
  "colorbalance=rs=0.025:gs=0.005:bs=-0.02:rh=-0.01:bh=0.01",
  "noise=c0s=8:c0f=t",
  "gblur=sigma=0.35",
  "vignette=angle=PI/7",
].join(",");

/**
 * Zoom hit: the camera pushes in toward a highlight (1 → 1.6× in 0.35 s, eased), holds 0.3 s and pulls
 * back to the full frame in 0.35 s, with a light blur while it moves. Starts just after the cut.
 */
export const ZOOM_HIT = { start: 0.15, ramp: 0.35, hold: 0.3, peak: 0.6 };

export function zoomHitFilter(input: string, target: { x: number; y: number }, canvas: Canvas): string {
  const { w, h } = canvas;
  const { start: a, ramp: r, hold: hd, peak } = ZOOM_HIT;
  // zoompan, not scale(eval=frame)+crop: crop evaluates iw/ih once at configure time, so the old
  // graph cropped at x=y=0 on every frame and each zoom hit pushed into the top-left corner,
  // whatever the target (first live run: the product slid out of frame at 12.5 s).
  const t = `(on/${FPS})`;
  const p1 = `clip((${t}-${f3(a)})/${f3(r)},0,1)`;
  const p2 = `clip((${t}-${f3(a + r + hd)})/${f3(r)},0,1)`;
  const env = `(${p1}*${p1}*(3-2*${p1})-${p2}*${p2}*(3-2*${p2}))`;
  const z = `(1+${peak}*${env})`;
  const x = Math.min(1, Math.max(0, target.x));
  const y = Math.min(1, Math.max(0, target.y));
  const moving = `between(t,${f3(a)},${f3(a + r)})+between(t,${f3(a + r + hd)},${f3(a + 2 * r + hd)})`;
  return [
    `${input}zoompan=z='${z}':x='min(max(${x}*iw-iw/zoom/2,0),iw-iw/zoom)':y='min(max(${y}*ih-ih/zoom/2,0),ih-ih/zoom)':d=1:s=${w}x${h}:fps=${FPS}`,
    `gblur=sigma=2.2:enable='${moving}'`,
    `setsar=1,format=yuv420p[v]`,
  ].join(",");
}

/** The product reframe of a clip shot (motion.ts reframeTrack), when its keyframes carry a product box. */
export function shotReframe(shot: Shot, canvas: Canvas): ReturnType<typeof reframeTrack> {
  if (shot.kind !== "clip" || canvas.w > canvas.h || !shot.productBox) return null;
  return reframeTrack(shot.productBox, { canvasAspect: canvas.w / canvas.h, baseZoom: shot.zoom });
}

export function shotFilter(shot: Shot, canvas: Canvas, beatSec = 0.5): string {
  const raw = shotBaseFilter(shot, canvas);
  // A zoom hit on a reframed shot lands on the product where the reframe put it.
  const track = shot.zoomHit ? shotReframe(shot, canvas) : null;
  const target = track ? track.from.out : shot.zoomHit;
  const base = target ? `${raw.replace(/\[v\]$/, "[zh]")};${zoomHitFilter("[zh]", target, canvas)}` : raw;
  if (!shot.contrast) return base;
  // Contrast hook: the picture sits small in a dimmed, blurred frame for the
  // first beat, then fills the screen — the size jump is the claim.
  const pre = base.replace(/\[v\]$/, "[pre]");
  return `${pre};[pre]split=2[c1][c2];[c1]boxblur=30:2,eq=brightness=-0.18[cb];[c2]scale=w='2*trunc(iw*if(lt(t,${f3(beatSec)}),0.56,1)/2)':h='2*trunc(ih*if(lt(t,${f3(beatSec)}),0.56,1)/2)':eval=frame[cf];[cb][cf]overlay=(W-w)/2:(H-h)/2:eval=frame,format=yuv420p[v]`;
}

/**
 * Comparison composite: ours (the shot as rendered) and the other side (input 1,
 * a desaturated still) share the frame — stacked top/bottom on vertical
 * canvases, side by side on landscape — split by a white rule, each labelled
 * (inputs 2 = ours, 3 = other). Ours is always the second half the eye lands on.
 */
/**
 * Label tops (fractions of the canvas height) on a vertical canvas: each label inside its own half and inside
 * the strict 9:16 safe box (y 288–1220 of 1920 = 0.15–0.635 — the old centred 0.16 put the top label's pill
 * above 0.15). Landscape: both labels at the top of their halves.
 */
export function compareLabelSlots(canvas: Canvas): { otherTop: number; oursTop: number } {
  return canvas.h >= canvas.w ? { otherTop: 0.165, oursTop: 0.52 } : { otherTop: 0.08, oursTop: 0.08 };
}

export function compareFilter(shotGraph: string, canvas: Canvas): string {
  const { w, h } = canvas;
  const vertical = h >= w;
  const hw = vertical ? w : Math.round(w / 4) * 2;
  const hh = vertical ? Math.round(h / 4) * 2 : h;
  const pre = shotGraph.replace(/\[v\]$/, "[ours0]");
  const stack = vertical ? "vstack" : "hstack";
  const slot = compareLabelSlots(canvas);
  return [
    pre,
    `[ours0]scale=${hw}:${hh}:force_original_aspect_ratio=increase,crop=${hw}:${hh},setsar=1[ours]`,
    `[1:v]fps=${FPS},scale=${hw}:${hh}:force_original_aspect_ratio=increase,crop=${hw}:${hh},hue=s=0.35,eq=brightness=-0.06:contrast=0.9,setsar=1[other]`,
    `[other][ours]${stack}=inputs=2,format=yuv420p[st]`,
    vertical
      ? `[st]drawbox=x=0:y=${hh - 3}:w=${w}:h=6:color=white@0.95:t=fill[ruled]`
      : `[st]drawbox=x=${hw - 3}:y=0:w=6:h=${h}:color=white@0.95:t=fill[ruled]`,
    vertical
      ? `[ruled][3:v]overlay=x=(W-w)/2:y=H*${slot.otherTop}[l1];[l1][2:v]overlay=x=(W-w)/2:y=H*${slot.oursTop},format=yuv420p[v]`
      : `[ruled][3:v]overlay=x=W*0.25-w/2:y=H*${slot.otherTop}[l1];[l1][2:v]overlay=x=W*0.75-w/2:y=H*${slot.oursTop},format=yuv420p[v]`,
  ].join(";");
}

function shotBaseFilter(shot: Shot, canvas: Canvas): string {
  const { w, h } = canvas;
  const dur = Math.max(0.1, shot.frames / FPS);
  if (shot.kind === "clip" && w > h) {
    // Vertical footage in a landscape export: fit the height over a blurred fill
    // (cover-cropping 9:16 into 16:9 would leave a face fragment).
    const z = Math.min(shot.zoom, 1.08);
    return [
      `[0:v]fps=${FPS},tpad=stop_mode=clone:stop_duration=5,split=2[bg][fg]`,
      `[bg]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=40:2,eq=brightness=-0.08[bgb]`,
      `[fg]scale=-2:${Math.round((h * z) / 2) * 2}[fgs]`,
      `[bgb][fgs]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p[v]`,
    ].join(";");
  }
  if (shot.kind === "clip") {
    // Product reframe: zoom so the product is centred and ≥ 35 % of the frame height, the crop
    // following it from the start keyframe's box to the end keyframe's across the frame's source window.
    const track = shotReframe(shot, canvas);
    const z = track ? track.zoom : shot.zoom;
    let crop = `crop=${w}:${h}:(iw-${w})/2:(ih-${h})*${shot.anchorY}`;
    if (track) {
      const fs = shot.frameSrc;
      const p = fs ? `clip((${f3(shot.srcFrom - fs.from)}+t*${f3(shot.speed ?? 1)})/${f3(fs.span)},0,1)` : "0";
      const c = (a: number, b: number) => (Math.abs(b - a) < 1e-3 ? f3(a) : `(${f3(a)}+${f3(b - a)}*${p})`);
      crop = `crop=${w}:${h}:x='min(max(${c(track.from.cx, track.to.cx)}*iw-${w}/2,0),iw-${w})':y='min(max(${c(track.from.cy, track.to.cy)}*ih-${h}/2,0),ih-${h})'`;
    }
    // Time-remap (the 1-second install): speed the source up and blend frames into motion blur.
    // Frame blending only for real speed ramps (≥ 2×); a gentle fit (an end-anchored clip at 1.3×) stays crisp.
    const remap = (shot.speed ?? 1) > 1 ? `setpts=(PTS-STARTPTS)/${f3(shot.speed!)},${shot.speed! >= 2 ? `tmix=frames=${Math.min(5, Math.ceil(shot.speed!))},` : ""}` : "";
    return [
      `[0:v]${remap}scale=${Math.round((w * z) / 2) * 2}:${Math.round((h * z) / 2) * 2}:force_original_aspect_ratio=increase`,
      crop,
      // Film finish for generated footage (the "clean plastic render" look is crushed blacks, clipped
      // highlights, over-saturation and razor edges): soften the digital crunch, lift blacks and roll
      // highlights off, pull saturation ~12 %, warm the shadows, then luma-only temporal grain that is
      // softened to film-like size. No contrast boost, no colour noise, no halation or bloom.
      FILM_FINISH,
      `fps=${FPS},tpad=stop_mode=clone:stop_duration=5,setsar=1,format=yuv420p[v]`,
    ].join(",");
  }
  // Stills: fit inside the canvas over a blurred fill, then move.
  // Smooth 2.5D motion: zoompan on a 2x upscale, so the move is sub-pixel (integer-step resizes jittered).
  const z0 = Math.max(1, shot.zoom);
  const p = `min(on/${FPS}/${f3(dur)},1)`;
  const zoomExpr = shot.motion === "pull" ? `${z0 + 0.07}-0.07*${p}` : shot.motion === "drift" ? `${z0 + 0.05}` : `${z0}+0.07*${p}`;
  const xExpr = shot.motion === "drift" ? `(iw-iw/zoom)/2+(iw-iw/zoom)/2*0.8*(${p}-0.5)` : `(iw-iw/zoom)/2`;
  return [
    `[0:v]split=2[bg][fg]`,
    `[bg]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=40:2[bgb]`,
    `[fg]scale=${w}:${h}:force_original_aspect_ratio=decrease[fgs]`,
    `[bgb][fgs]overlay=(W-w)/2:(H-h)/2,fps=${FPS},setsar=1,scale=${w * 2}:${h * 2}:flags=bicubic[fit]`,
    `[fit]zoompan=z='${zoomExpr}':x='${xExpr}':y='(ih-ih/zoom)*${shot.anchorY}':d=1:s=${w}x${h}:fps=${FPS},setsar=1,format=yuv420p[v]`,
  ].join(";");
}

/** Drop flashes: a short light pop on the hook → body cut (the only brightness envelope). */
function flashes(plan: EditPlan): number[] {
  return plan.boundaries.filter((b) => b.transition === "flash").map((b) => b.atSec);
}

/**
 * The brightness offset fxFilter applies at time t (same envelope, evaluated). Never negative: no fade
 * up from black (frame 1 is the thumbnail and must be full brightness — pre-flight measured luma 0.03
 * on the faded-in masters) and no fade-out over the CTA's last second.
 */
export function brightnessAt(plan: EditPlan, t: number): number {
  return flashes(plan).reduce((n, at) => n + (t >= at - 0.004 ? 0.35 * Math.exp(-(t - at) * 28) : 0), 0);
}

/**
 * Beat accents and boundary transitions as light / blur envelopes over the already-cut picture (a
 * transition never swaps content — the cut does).
 */
export function fxFilter(plan: EditPlan, canvas: Canvas): string {
  // No scale envelopes at all: per-beat zoom pulses, zoom-transition punches and the zoom-through
  // opener made the whole picture shake (Barron, 2026-10-04). No fade up from dark either: the first
  // frame opens at full brightness. What stays: the drop flash and a three-frame motion blur into each whip cut.
  void canvas;
  const flash = flashes(plan).map((at) => `0.35*gte(t,${f3(at - 0.004)})*exp(-(t-${f3(at)})*28)`);
  const parts = flash.length ? [`eq=brightness='${flash.join("+")}':eval=frame`] : [];
  const fr = 1 / FPS;
  for (const b of plan.boundaries) {
    if (b.transition === "whip") {
      [8, 18, 32].forEach((size, k) => {
        const t0 = b.atSec - (3 - k) * fr;
        parts.push(`avgblur=sizeX=${size}:sizeY=1:enable='between(t,${f3(t0 - 0.004)},${f3(t0 + fr - 0.01)})'`);
      });
    }
  }
  parts.push("setsar=1");
  return parts.join(",");
}

/** Overlay x: centred on the frame, or on the platform safe box's centre `cx` (px). */
export function overlayX(cx: number | undefined): string {
  return cx === undefined ? "(W-w)/2" : `${Math.round(cx)}-w/2`;
}

/** Luma a frame needs to read as a lit thumbnail (pre-flight passes ≥ 0.30). */
export const BRIGHT_LUMA = 0.3;

/**
 * Where to start a dark opener: 0 when frame 1 is bright enough, else the first offset in 0.1–0.3 s
 * that is, else the brightest of those when it beats frame 1 by a visible margin. Pure.
 */
export function openerTrim(samples: { offset: number; luma: number }[]): number {
  const at0 = samples.find((x) => x.offset === 0)?.luma ?? 0;
  if (at0 >= BRIGHT_LUMA) return 0;
  const later = samples.filter((x) => x.offset >= 0.1 - 1e-9 && x.offset <= 0.3 + 1e-9).sort((a, b) => a.offset - b.offset);
  const bright = later.find((x) => x.luma >= BRIGHT_LUMA);
  if (bright) return bright.offset;
  const best = later.reduce<{ offset: number; luma: number } | null>((b, x) => (!b || x.luma > b.luma ? x : b), null);
  return best && best.luma >= at0 + 0.03 ? best.offset : 0;
}

/** Mean luma (0–1) of one frame of a clip at `sec` (a 32 px grey decode). */
export async function frameLuma(file: string, sec: number): Promise<number | null> {
  if (!ffmpegPath) return null;
  const out = await run(ffmpegPath, ["-v", "error", "-ss", f3(sec), "-i", file, "-frames:v", "1", "-vf", "scale=32:32,format=gray", "-f", "rawvideo", "pipe:1"], { encoding: "buffer", timeout: 30_000, maxBuffer: 1 << 20 })
    .then((r) => r.stdout as Buffer)
    .catch(() => null);
  if (!out?.length) return null;
  let n = 0;
  for (const v of out) n += v;
  return n / out.length / 255;
}

interface Overlay {
  file: string;
  startSec: number;
  endSec: number;
  /** Vertical centre as a share of the frame height. */
  y: number;
  /** Drops in from above and bounces to rest (CTA button). */
  bounce?: boolean;
  /** End-card template animation (pop / slam / pulse / bob / wipe / fade / rise / drift). */
  anim?: LayerAnim;
  /** Horizontal centre (px) inside the platform safe box; default the frame's centre. */
  cx?: number;
  /** Layer role for the safe-zone fit and the pre-flight layer list ("backdrop" / "decor" are not text). */
  role?: string;
  /** Absolute top-left in pixels (native captions sit in the safe box, not on the centre line). */
  at?: { x: number; y: number };
}

/** Holiday / gift copy picks the seasonal music bed. */
export function musicMood(frames: { voiceover?: string | null; text?: string | null }[]): "pop" | "holiday" {
  const text = frames.map((f) => `${f.voiceover ?? ""} ${f.text ?? ""}`).join(" ");
  return SEASONAL_COPY.test(text) ? "holiday" : "pop";
}

/** Caption windows: each word state is shown until the next word starts (short gaps are held). */
export function captionWindows(groups: TimedWord[][], totalSec: number): { group: number; word: number; startSec: number; endSec: number }[] {
  const out: { group: number; word: number; startSec: number; endSec: number }[] = [];
  groups.forEach((g, gi) => {
    const nextStart = groups[gi + 1]?.[0]?.startSec ?? Infinity;
    const groupEnd = g[g.length - 1].endSec;
    const hold = nextStart - groupEnd < 0.6 ? nextStart : groupEnd + 0.15;
    g.forEach((wd, wi) => {
      const end = wi + 1 < g.length ? g[wi + 1].startSec : hold;
      const s = Math.max(0, wd.startSec);
      const e = Math.min(totalSec, end);
      if (e - s > 0.02) out.push({ group: gi, word: wi, startSec: s, endSec: e });
    });
  });
  return out;
}

/** The file has an audio stream (a talk clip the model rendered silent has none). */
async function hasAudioStream(file: string): Promise<boolean> {
  const { stderr } = await run(ffmpegPath!, ["-hide_banner", "-i", file]).catch((e) => e as { stderr: string });
  return /Stream #\S+.*Audio:/.test(String(stderr));
}

/**
 * Talking-head frames keep their clip's own audio — when it has any. A talk clip that came back without an
 * audio track (another engine, a refused audio flag) falls back to the TTS voice speaking its line.
 */
export async function routeNativeAudio(frames: AssembleFrame[], segments: Segment[], sources: Map<string, string>): Promise<{ frames: AssembleFrame[]; segments: Segment[] }> {
  const silent = new Set<number>();
  for (const s of segments) {
    if (s.kind !== "clip" || !s.nativeAudio) continue;
    const file = sources.get(s.url);
    if (!file || !(await hasAudioStream(file).catch(() => false))) silent.add(s.frameNumber);
  }
  const talkSeg = new Set(segments.filter((s) => s.kind === "clip" && s.nativeAudio && !silent.has(s.frameNumber)).map((s) => s.frameNumber));
  if (silent.size) console.warn(`[edit-v2] talk clip(s) without audio for frame(s) ${[...silent].join(", ")} — the TTS voice speaks their lines`);
  return {
    frames: frames.map((f) => (f.nativeAudio && !talkSeg.has(f.frameNumber) ? { ...f, nativeAudio: false } : f)),
    segments: segments.map((s) => (s.kind === "clip" && s.nativeAudio && !talkSeg.has(s.frameNumber) ? { ...s, nativeAudio: false } : s)),
  };
}

/** Each talk frame's speech span (relative to its first window), measured with silencedetect; null = estimate. */
async function measureSpeechSpans(windows: NativeWindow[], sources: Map<string, string>): Promise<Map<number, { startSec: number; endSec: number } | null>> {
  const out = new Map<number, { startSec: number; endSec: number } | null>();
  for (const n of new Set(windows.map((w) => w.frameNumber))) {
    const w = windows.filter((x) => x.frameNumber === n);
    const file = sources.get(w[0].url);
    const visible = w[w.length - 1].endSec - w[0].startSec;
    if (!file) continue;
    const { stderr } = await run(ffmpegPath!, ["-hide_banner", "-ss", f3(w[0].srcFrom), "-t", f3(visible), "-i", file, "-vn", "-af", "silencedetect=noise=-32dB:d=0.25", "-f", "null", "-"], { timeout: 30_000 }).catch((e) => e as { stderr: string });
    out.set(n, speechSpan(parseSilences(String(stderr ?? "")), visible));
  }
  return out;
}

/** The talk clips' own audio, cut at exactly the source time each shot shows, on the edit's timeline. */
async function renderNativeTrack(dir: string, windows: NativeWindow[], sources: Map<string, string>, totalSec: number): Promise<string | null> {
  const usable = windows.filter((w) => sources.get(w.url) && w.endSec - w.startSec > 0.05);
  if (!usable.length) return null;
  const inputs = usable.flatMap((w) => ["-ss", f3(w.srcFrom), "-t", f3(w.endSec - w.startSec), "-i", sources.get(w.url)!]);
  const chains = usable.map((w, k) => {
    const d = w.endSec - w.startSec;
    const ms = Math.round(w.startSec * 1000);
    // 12 ms fades: a window edge never clicks.
    return `[${k}:a]aresample=44100,aformat=channel_layouts=stereo,atrim=0:${f3(d)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.012,afade=t=out:st=${f3(Math.max(0, d - 0.012))}:d=0.012,adelay=${ms}|${ms}[n${k}]`;
  });
  const mix = `${chains.join(";")};${usable.map((_, k) => `[n${k}]`).join("")}amix=inputs=${usable.length}:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11,apad,atrim=0:${f3(totalSec)}[nat]`;
  const file = path.join(dir, "v2native.wav");
  await run(ffmpegPath!, ["-y", "-v", "error", ...inputs, "-filter_complex", mix, "-map", "[nat]", "-ac", "2", "-ar", "44100", file], { timeout: 90_000 });
  return file;
}

export async function renderEditV2(input: {
  dir: string;
  runId: string;
  /** The run's project (spend guard scope for paid calls inside the edit). */
  projectId?: string | null;
  aspectRatio: string;
  canvas: Canvas;
  frames: AssembleFrame[];
  segments: Segment[];
  /** Local files already downloaded for each segment URL. */
  sources: Map<string, string>;
  voice?: string;
  /** A/B hook variant (only the opening shot and headline change). */
  hookStyle?: HookStyle;
  hookText?: string | null;
  /** Brand Kit packaging (colours, fonts, logo, CTA, domain). */
  brand?: BrandStyle;
  /** Music bed override (Batch Mode); default: the storyboard's mood (frames[].musicMood), else picked from the copy. */
  musicMood?: MoodId;
  /**
   * Target platform: every readable layer fits its safe zone (TikTok's right rail, Reels' bottom UI).
   * Default (none): today's frame-centred layout.
   */
  platform?: PlatformId | null;
  /** Pre-flight auto-fix corrections (autofix.ts). */
  fixes?: EditFixes;
  /** Voiceover override (tests / offline validation); default: Edge TTS via speakVoiceover. */
  speak?: typeof speakVoiceover;
  /** Caption look; default: the frames' (locked captionStyle), else kinetic. */
  captionStyle?: CaptionStyle;
}): Promise<EditV2Result> {
  const look = input.brand ?? DEFAULT_STYLE;
  const fixes = input.fixes ?? {};
  const fitToBox = !!input.platform || (fixes.layoutInset ?? 0) > 0;
  const box = layoutBox(input.canvas, input.platform ?? null, fixes.layoutInset ?? 0);
  // Text renderers wrap to the safe box width (absent on the full-frame default).
  const tc = textCanvas(input.canvas, box);
  if (!ffmpegPath) throw new Error("ffmpeg is not available on this server");
  const ff = ffmpegPath;
  const { dir, canvas } = input;
  // 0. Talking heads: keep the original clip files for their audio (screen plates re-encode video only),
  // and drop native audio from any talk clip that came back silent (TTS speaks it instead).
  const audioSources = new Map(input.sources);
  const { frames, segments } = await routeNativeAudio(input.frames, input.segments, audioSources);
  const captionStyle: CaptionStyle = input.captionStyle ?? frames.find((f) => f.captionStyle)?.captionStyle ?? "kinetic";
  const bySeg = new Map(frames.map((f) => [f.frameNumber, f]));
  const planInput: PlanInputSegment[] = segments.map((s) => ({
    kind: s.kind,
    url: s.url,
    from: s.kind === "clip" ? s.from : 0,
    length: s.length,
    frameNumber: s.frameNumber,
    segment: bySeg.get(s.frameNumber)?.segment ?? null,
    text: s.text ?? null,
    compare: s.compare ?? null,
    speed: s.kind === "clip" ? (s.speed ?? 1) : 1,
    zoomHit: s.zoomHit ?? null,
    fine: bySeg.get(s.frameNumber)?.fine ?? null,
    nativeAudio: s.kind === "clip" && !!s.nativeAudio,
    productBox: s.productBox ?? null,
  }));
  // CTA hero: a CTA clip whose keyframe shows the product off-centre, small or not at all becomes the
  // official packshot over the blurred last shot (a still: it gets the slow push-in).
  await applyCtaHero({ dir, canvas, frames, planInput, sources: input.sources, runId: input.runId });
  // Comparison frames: fetch the other side's image (stacked against ours in the shot).
  for (const s of segments) {
    const u = s.compare?.otherUrl;
    if (!u || input.sources.has(u)) continue;
    const file = path.join(dir, `cmp${input.sources.size}.img`);
    const res = await fetch(u, { signal: AbortSignal.timeout(60_000) }).catch(() => null);
    if (res?.ok) {
      await writeFile(file, Buffer.from(await res.arrayBuffer()));
      input.sources.set(u, file);
    }
  }
  // A licensed brand track: detect its beats and drop, start it so the drop
  // lands on the hook → body cut, and cut the edit on its real beats.
  let track: { file: string; startSec: number; beats: number[] } | null = null;
  if (look.musicUrl) {
    try {
      const file = path.join(dir, "v2track.audio");
      const res = await fetch(look.musicUrl, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`music download ${res.status}`);
      await writeFile(file, Buffer.from(await res.arrayBuffer()));
      const a = await detectBeats(file);
      const editSec = planInput.reduce((n, s) => n + s.length, 0);
      const hookSec = planInput.filter((s) => (s.segment ?? "").toUpperCase() === "HOOK").reduce((n, s) => n + s.length, 0) || 2;
      const startSec = trackWindowStart(a, hookSec, editSec);
      track = { file, startSec, beats: a.beats.map((b) => Math.round((b - startSec) * 1000) / 1000).filter((b) => b >= 0) };
    } catch (err) {
      console.warn(`[edit-v2] brand music unusable for ${input.runId}, using the generated bed:`, err instanceof Error ? err.message.slice(0, 160) : err);
      track = null;
    }
  }
  // The bed: Batch override, else the storyboard's mood, else from the copy. Its tempo is fitted inside
  // the mood's range so the most frame boundaries fall within ±120 ms of a beat.
  const storyMood = frames.map((f) => f.musicMood).find((m) => isMoodId(m));
  const mood: MoodId = input.musicMood ?? (isMoodId(storyMood) ? storyMood : musicMood(frames));
  let at = 0;
  const frameCuts = planInput.slice(0, -1).map((s) => round3((at += s.length)));
  const bpm = fitTempo(frameCuts, MOOD_TEMPO[mood]);
  const plan = planEdit(planInput, {
    bpm,
    voiceovers: new Map(frames.map((f) => [f.frameNumber, f.voiceover ? shownForm(f.voiceover) : null])),
    hookStyle: input.hookStyle,
    hookText: input.hookText,
    beats: track?.beats,
  });
  const total = plan.durationSec;

  // 1a. Screen plates: real screen content composited onto the device screen of the source clips
  // first, so reframing, speed ramps, text and the end card all sit on top of it.
  // The vision corner detection is paid: under the run's spend guard, and cached per clip on its job.
  if (frames.some((f) => f.screenPlate)) {
    const { guardedScreenVision, jobTrackCache } = await import("./screen-plate-store");
    await applyScreenPlates({ dir, frames: frames, segments: segments, sources: input.sources, vision: guardedScreenVision({ projectId: input.projectId, runId: input.runId }), trackCache: jobTrackCache(input.runId) });
  }

  // 1b. Smart segments: each hook shot from a clip takes that clip's most dynamic window.
  const motionCache = new Map<string, Awaited<ReturnType<typeof motionScores>>>();
  let prevHook: { url: string; from: number; to: number } | null = null;
  for (const shot of plan.shots) {
    // A talking head keeps its own timing: re-picking its window would cut the line mid-word.
    if (shot.segment !== "HOOK" || shot.kind !== "clip" || (shot.speed ?? 1) > 1 || shot.nativeAudio) {
      prevHook = null;
      continue;
    }
    const src = input.sources.get(shot.url);
    if (!src) continue;
    if (!motionCache.has(src)) motionCache.set(src, await motionScores(src).catch(() => ({ fps: 15, scores: [] })));
    const m = motionCache.get(src)!;
    const clipSec = m.scores.length / m.fps;
    const len = shot.frames / FPS;
    if (clipSec < len + 0.2) continue;
    if (prevHook && prevHook.url === shot.url) {
      // The punch-in continues the action instead of replaying it.
      shot.srcFrom = prevHook.to + len <= clipSec ? prevHook.to : Math.max(0, prevHook.from - len);
    } else {
      shot.srcFrom = bestWindow(m.scores, m.fps, len, clipSec, shot.srcFrom);
    }
    prevHook = { url: shot.url, from: shot.srcFrom, to: shot.srcFrom + len };
  }

  // 1c. A dark opener (auto-fix): start 0.1–0.3 s into the first clip, on its first bright frame.
  const opener = plan.shots[0];
  if (fixes.brightOpen && opener?.kind === "clip") {
    const src = input.sources.get(opener.url);
    if (src) {
      const samples: { offset: number; luma: number }[] = [];
      for (const offset of [0, 0.1, 0.2, 0.3]) {
        const luma = await frameLuma(src, opener.srcFrom + offset);
        if (luma !== null) samples.push({ offset, luma });
      }
      const trim = openerTrim(samples);
      if (trim > 0) opener.srcFrom = Math.round((opener.srcFrom + trim) * 1000) / 1000;
    }
  }

  // 2. Shots, a few at a time.
  const shotFiles = await pMap(
    plan.shots,
    async (shot) => {
      const out = path.join(dir, `v2shot${String(shot.index).padStart(3, "0")}.mp4`);
      const src = input.sources.get(shot.url);
      if (!src) throw new Error(`Missing source for shot ${shot.index}`);
      const inArgs = shot.kind === "clip" ? ["-ss", f3(shot.srcFrom), "-i", src] : ["-loop", "1", "-t", f3(shot.frames / FPS + 0.5), "-i", src];
      let filter = shotFilter(shot, canvas, plan.grid.period);
      const otherFile = shot.compare ? input.sources.get(shot.compare.otherUrl) : undefined;
      if (shot.compare && otherFile) {
        // Stack the other side against ours, with labels (no generated collage).
        const labels = [
          path.join(dir, `cmpl${shot.index}o.png`),
          path.join(dir, `cmpl${shot.index}t.png`),
        ];
        await writeFile(labels[0], await comparisonLabelPng(shot.compare.labelOurs, canvas, look, true));
        await writeFile(labels[1], await comparisonLabelPng(shot.compare.labelOther, canvas, look, false));
        inArgs.push("-loop", "1", "-t", f3(shot.frames / FPS + 0.5), "-i", otherFile, "-i", labels[0], "-i", labels[1]);
        filter = compareFilter(filter, canvas);
      }
      await run(
        ff,
        ["-y", "-v", "error", ...inArgs, "-filter_complex", filter, "-map", "[v]", "-frames:v", String(shot.frames), "-an", "-r", String(FPS), "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-pix_fmt", "yuv420p", out],
        { timeout: 90_000 }
      );
      return out;
    },
    { concurrency: 3 }
  );

  // 3. Frame-exact concat — every cut on its beat frame.
  const list = path.join(dir, "v2list.txt");
  await writeFile(list, shotFiles.map((p) => `file '${p}'`).join("\n"));
  const body = path.join(dir, "v2body.mp4");
  await run(ff, ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", body], { timeout: 90_000 });

  // 4a. Voice, captions, music, SFX. Talking heads: the clip's own voice plays its window, the TTS voice
  // skips those lines and finishes before each talk frame starts, captions come from the known line.
  const nativeWindows = nativeAudioWindows(plan.shots);
  const talkFrames = frames.filter((f) => f.nativeAudio && nativeWindows.some((w) => w.frameNumber === f.frameNumber));
  const nativeFile = nativeWindows.length
    ? await renderNativeTrack(dir, nativeWindows, audioSources, total).catch((err) => {
        console.warn(`[edit-v2] native talk audio failed for ${input.runId}:`, err instanceof Error ? err.message.slice(0, 200) : err);
        return null;
      })
    : null;
  const talkSpans = nativeFile ? await measureSpeechSpans(nativeWindows, audioSources).catch(() => new Map()) : new Map();
  const talkWordsByFrame = nativeFile ? talkFrames.map((f) => talkCaptionWords([{ frameNumber: f.frameNumber, talkLine: f.talkLine ?? f.voiceover }], nativeWindows, talkSpans)) : [];
  const vo = await (input.speak ?? speakVoiceover)({
    dir,
    // Without the native track (render failure) the TTS voice speaks every line, talk lines included.
    // A talk frame whose shots were all swapped out (hook variant "p") has no window: TTS speaks it too.
    frames: nativeFile ? ttsFrames(frames.map((f) => (f.nativeAudio && !talkFrames.includes(f) ? { ...f, nativeAudio: false } : f))) : frames,
    totalSec: total,
    voice: input.voice,
    stops: nativeFile ? [...new Set(nativeWindows.map((w) => w.startSec))] : [],
  }).catch((err) => {
    console.warn(`[edit-v2] voiceover failed for ${input.runId}:`, err instanceof Error ? err.message.slice(0, 200) : err);
    return null;
  });
  // Caption words carry their line (TTS line index; talk lines 1000+frame) so fragments never merge across lines.
  const words: TimedWord[] = [
    ...(vo ? vo.words.flatMap((w, i) => timedWords(w, vo.placements[i], vo.lines[i].text).map((x) => ({ ...x, line: i }))) : []),
    ...talkWordsByFrame.flatMap((ws, k) => ws.map((x) => ({ ...x, line: 1000 + k }))),
  ].sort((a, b) => a.startSec - b.startSec);
  // On the end card the offer and the button carry the message; captions stop there.
  const captionEnd = plan.ctaSec ?? total;
  // Native captions show a longer phrase (≤ 2 lines); kinetic ones 2–3 words.
  const groups = captionStyle === "native" ? kineticGroups(words.filter((w) => w.startSec < captionEnd), 5, 26) : kineticGroups(words.filter((w) => w.startSec < captionEnd));
  const windows = captionWindows(groups, captionEnd);
  const overlays: Overlay[] = [];
  // Layout slots: every readable layer inside the strict safe box on 9:16 (y 288–1220).
  const slots = endCardSlots(canvas);
  const vertical = canvas.h / canvas.w > 1.5;
  // A caption that only repeats the headline or claim already on screen is dropped (no "NEW YEAR GIFT?" twice).
  const bare = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}%]+/gu, " ").trim();
  const repeatsCard = (win: (typeof windows)[number]) => {
    const said = bare(groups[win.group].map((x) => x.text).join(" "));
    return !!said && plan.cards.some((c) => (c.role === "hook" || c.role === "claim") && c.startSec < win.endSec && c.endSec > win.startSec && bare(c.text).includes(said));
  };
  for (const [i, win] of windows.entries()) {
    if (!fixes.allCaptions && repeatsCard(win)) continue;
    const file = path.join(dir, `v2cap${String(i).padStart(3, "0")}.png`);
    if (captionStyle === "native") {
      const png = await nativeCaptionPng(groups[win.group].map((x) => x.text), win.word, canvas, look);
      await writeFile(file, png);
      const sharp = (await import("sharp")).default;
      const m = await sharp(png).metadata();
      // Placed by its top-left, inside the native box ∩ the platform safe box; `y` is its real centre line.
      const at = nativeCaptionAt(canvas, m.width ?? 1, m.height ?? 1, { box: fitToBox ? box : null });
      overlays.push({ file, startSec: win.startSec, endSec: win.endSec, y: Math.round(((at.y + (m.height ?? 1) / 2) / canvas.h) * 10000) / 10000, at, role: "caption" });
      continue;
    }
    await writeFile(file, await kineticCaptionPng(groups[win.group].map((x) => x.text), win.word, tc, look));
    overlays.push({ file, startSec: win.startSec, endSec: win.endSec, y: slots.caption, role: "caption" });
  }
  // End-card template (creative library E01–E12) from the CTA frame; facts missing → the default close.
  const ecFrame = frames.find((f) => f.endCard?.id);
  const template = ecFrame?.endCard && plan.ctaSec !== null && (RENDERABLE_END_CARDS as string[]).includes(ecFrame.endCard.id)
    ? await endCardLayers(ecFrame.endCard.id as EndCardTemplate, { headline: plan.cards.find((c) => c.role === "offer")?.text ?? null, ...ecFrame.endCard.data }, tc, look, { durationSec: total - (plan.ctaSec ?? total) }).catch((err) => {
        console.warn(`[edit-v2] end card ${ecFrame.endCard?.id} failed, using the default close:`, err instanceof Error ? err.message.slice(0, 160) : err);
        return null;
      })
    : null;
  if (template && plan.ctaSec !== null) {
    for (const [i, l] of template.layers.entries()) {
      const file = path.join(dir, `v2end${i}.png`);
      await writeFile(file, l.png);
      // Frame sequences (star fill, carousel, shine) end on their own; everything else holds to the end.
      const endSec = l.durSec !== undefined ? Math.min(total, plan.ctaSec + l.delaySec + l.durSec) : total;
      overlays.push({ file, startSec: plan.ctaSec + l.delaySec, endSec, y: l.y, anim: l.anim === "bounce" ? undefined : l.anim, bounce: l.anim === "bounce", role: l.role === "backdrop" || l.role === "decor" ? l.role : "endcard" });
    }
  }
  for (const [i, card] of plan.cards.entries()) {
    if (template && card.role === "offer") continue; // the template carries the offer as its headline
    const file = path.join(dir, `v2card${i}.png`);
    const png =
      card.role === "hook"
        ? await hookHeadlinePng(card.text, tc, look)
        : card.role === "offer"
          ? await offerCardPng(card.text, tc, look)
          : card.role === "fine"
            ? await finePrintPng(card.text, tc, look)
            : await claimChipPng(card.text, tc, look);
    await writeFile(file, png);
    // A hook over a person sits in the lower half, off the face (AI director finding).
    const hookOverPerson = card.role === "hook" && frames.some((f) => (f.segment ?? "").toUpperCase() === "HOOK" && f.hasPerson);
    // During a comparison shot a claim belongs to our half (under its label), not over the other side.
    const overCompare = card.role === "claim" && plan.shots.some((s) => s.compare && s.startSec < card.endSec && s.endSec > card.startSec);
    const y = card.role === "fine" ? (template?.fineY ?? slots.fine) : card.role === "offer" ? slots.headline : card.role === "claim" ? (overCompare ? Math.min(0.6, 0.63) : 0.3) : hookOverPerson ? 0.52 : 0.22;
    overlays.push({ file, startSec: card.startSec, endSec: card.endSec, y, role: card.role });
  }
  // Auto-fix: a CTA must hold the last second even without a CTA frame or when the end card hides the button.
  if (!plan.ctaButton && fixes.forceCta) plan.ctaButton = { text: "Shop now", startSec: Math.round(Math.max(0, total - CTA_BUTTON_SEC) * 1000) / 1000 };
  if (plan.ctaButton && (!template?.hideButton || fixes.forceCta)) {
    const file = path.join(dir, "v2cta.png");
    await writeFile(file, await ctaButtonPng(input.brand ? look.ctaText : plan.ctaButton.text, tc, template?.look ?? look));
    overlays.push({ file, startSec: plan.ctaButton.startSec, endSec: total, y: slots.button, bounce: true, role: "cta" });
  }
  // End card branding: the logo lands with the CTA, the domain under the button.
  if (plan.ctaSec !== null) {
    const logo = look.logoUrl ? await logoPng(look.logoUrl, canvas) : null;
    if (logo) {
      const file = path.join(dir, "v2logo.png");
      await writeFile(file, logo);
      overlays.push({ file, startSec: plan.ctaSec, endSec: total, y: slots.logo, role: "logo" });
    }
    // On 9:16 the domain would fall under the platform UI; the offer line / button carry it there.
    if (look.domain && !vertical) {
      const file = path.join(dir, "v2domain.png");
      await writeFile(file, await domainPng(look.domain, tc, look));
      overlays.push({ file, startSec: plan.ctaButton?.startSec ?? plan.ctaSec, endSec: total, y: 0.8, role: "domain" });
    }
  }

  // Platform safe box: every readable layer shrinks to fit and centres in the box (TikTok: x 64–940).
  if (fitToBox) {
    const sizes = new Map<Overlay, { w: number; h: number }>();
    // A native caption fits the native box inside the platform box; every other layer the platform box.
    const nb = nativeCaptionBounds(canvas, box);
    const nativeBox = { left: nb.x0, right: nb.x1, top: nb.y0, bottom: nb.y1 };
    for (const o of overlays) {
      if (o.role === "backdrop" || o.role === "decor") continue;
      const png = await readFile(o.file);
      const fit = await fitLayerPng(png, o.y, o.at ? nativeBox : box, canvas);
      if (fit.png !== png) await writeFile(o.file, fit.png);
      o.cx = fit.cx;
      o.y = fit.y;
      const m = await (await import("sharp")).default(fit.png).metadata();
      sizes.set(o, { w: m.width ?? 0, h: m.height ?? 0 });
    }
    // A caption never lands on a hook headline / claim on screen at the same time.
    const placed = [...sizes.keys()];
    separateCaptions(placed.map((o) => ({ role: o.role, y: o.y, h: sizes.get(o)!.h, startSec: o.startSec, endSec: o.endSec })), canvas, box).forEach((y, i) => (placed[i].y = y));
    // Native captions are placed by their top-left: recompute it from the final (possibly downscaled) size
    // and centre line, so the caption stays centred, inside the box and off the hook headline.
    for (const o of placed) if (o.at) o.at = nativeCaptionAt(canvas, sizes.get(o)!.w, sizes.get(o)!.h, { box, yCenter: o.y });
  }

  const musicFile = path.join(dir, "v2music.wav");
  if (track) {
    await run(ff, ["-y", "-v", "error", "-ss", f3(track.startSec), "-t", f3(total), "-i", track.file, "-af", `afade=t=out:st=${f3(Math.max(0, total - 0.4))}:d=0.4,aresample=44100`, "-ac", "2", musicFile], { timeout: 60_000 });
  } else {
    const music = synthesizeMusic({ durationSec: total, bpm: plan.grid.bpm, dropSec: plan.dropSec, breakdownSec: plan.breakdownSec, ctaSec: plan.ctaSec, energy: MOOD_ENERGY[mood], seed: input.runId.length, mood });
    await writeFile(musicFile, toWav(music.left, music.right));
  }
  // Every bed is −14 LUFS before ducking; the mood's mix offset sets how far under the voice it sits.
  const bedGain = (track ? 1 : Math.pow(10, MOOD_MIX_DB[mood] / 20)) * MUSIC_BED_GAIN;
  const sfx = renderSfxBed(plan.sfx, total);
  const sfxFile = path.join(dir, "v2sfx.wav");
  await writeFile(sfxFile, toWav(sfx.left, sfx.right));

  // 4b. The final encode.
  const inputs = ["-i", body, ...(vo ? ["-i", vo.voiceoverFile] : []), ...(nativeFile ? ["-i", nativeFile] : []), "-i", musicFile, "-i", sfxFile, ...overlays.flatMap((o) => layerInputArgs(o.file, o.anim, total))];
  const voIdx = vo ? 1 : -1;
  const nativeIdx = nativeFile ? (vo ? 2 : 1) : -1;
  const musicIdx = 1 + (vo ? 1 : 0) + (nativeFile ? 1 : 0);
  const sfxIdx = musicIdx + 1;
  const firstOverlay = sfxIdx + 1;
  const video = [`[0:v]${fxFilter(plan, canvas)}[fx]`];
  overlays.forEach((o, i) => {
    const from = i === 0 ? "[fx]" : `[o${i - 1}]`;
    if (o.anim && o.anim !== "none" && o.anim !== "bounce") {
      video.push(...layerFilter(firstOverlay + i, o.anim, o.y, o.startSec, o.endSec, from, `[o${i}]`, o.cx));
      return;
    }
    // A bouncing overlay falls from 9% of the height and bounces to rest (decaying |cos|).
    const y = o.at ? String(o.at.y) : o.bounce ? `'H*${o.y}-h/2-H*0.09*abs(cos(2*PI*1.6*(t-${f3(o.startSec)})))*exp(-3.2*(t-${f3(o.startSec)}))'` : `H*${o.y}-h/2`;
    const x = o.at ? String(o.at.x) : overlayX(o.cx);
    video.push(`${from}[${firstOverlay + i}:v]overlay=x=${x}:y=${y}:eval=${o.bounce ? "frame" : "init"}:enable='between(t,${f3(o.startSec)},${f3(o.endSec)})'[o${i}]`);
  });
  const lastV = overlays.length ? `[o${overlays.length - 1}]` : "[fx]";
  video.push(`${lastV}format=yuv420p[v]`);
  // The loudness target (auto-fix nudges it when the measured mix landed off −14 LUFS).
  const lufs = Math.min(-9, Math.max(-20, fixes.loudnessTarget ?? -14));
  // Voice bus (TTS + the talk clips' own audio) → the music ducks under all of it (edit/native-audio.ts).
  const audio = audioMixGraph({ ttsIdx: voIdx, nativeIdx, musicIdx, sfxIdx, totalSec: total, lufs, musicGain: bedGain, musicSoloGain: (bedGain / MUSIC_BED_GAIN) * 0.6 });
  const master = path.join(dir, "v2master.mp4");
  await run(
    ff,
    ["-y", "-v", "error", ...inputs, "-filter_complex", [...video, ...audio].join(";"), "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-t", f3(total), "-movflags", "+faststart", master],
    { timeout: 180_000, maxBuffer: 16 * 1024 * 1024 }
  );

  // 5. QC, preview, contact sheet.
  const measured = await measureMaster(master, dir);
  // Cut timing is measured on the hard-cut layer (before light/blur envelopes),
  // where the content actually changes.
  measured.cutsSec = await measureCuts(body, dir).catch(() => measured.cutsSec);
  const spokenBeforeCta = words.filter((w) => w.startSec < captionEnd);
  const wordSpan = spokenBeforeCta.length ? spokenBeforeCta.reduce((n, w) => n + Math.max(0, Math.min(total, w.endSec) - w.startSec), 0) : 0;
  const covered = spokenBeforeCta.length
    ? spokenBeforeCta.reduce((n, w) => {
        const inWin = windows.some((x) => x.startSec <= w.startSec + 0.05 && x.endSec >= Math.min(total, w.endSec) - 0.05);
        return n + (inWin ? Math.max(0, Math.min(total, w.endSec) - w.startSec) : 0);
      }, 0)
    : 0;
  const qc = scoreQc({
    durationSec: total,
    ...measured,
    beats: plan.grid.beats,
    plannedCuts: plan.boundaries.map((b) => b.atSec),
    offBeatCuts: plan.offBeatCuts,
    hookHeadline: plan.cards.some((c) => c.role === "hook" && c.startSec < 2),
    // A script with a voiceover but no spoken words means the voice failed: fail the check, never ship it silent.
    captionCoverage: spokenBeforeCta.length ? covered / Math.max(0.01, wordSpan) : frames.some((f) => f.voiceover?.trim()) ? 0 : null,
    ctaSec: plan.ctaSec,
  });
  qc.layout = { platform: input.platform ?? null, inset: fixes.layoutInset ?? 0 };
  if (Object.keys(fixes).length) qc.fixes = fixes;
  // Pre-flight creative score as an extra QC section (preflight/); never blocks the render.
  const cov = qc.checks.find((c) => c.key === "caption_coverage")?.value;
  qc.preflight = await import("../preflight")
    .then((m) => m.preflightForEdit({ master, dir, aspectRatio: input.aspectRatio, platform: input.platform ?? null, canvas, plan, frames: input.frames, overlays, captions: windows.map((w) => ({ text: groups[w.group].map((x) => x.text).join(" "), startSec: w.startSec, endSec: w.endSec })), captionCoverage: typeof cov === "number" ? cov / 100 : null, known: measured }))
    .catch((err) => (console.warn(`[edit-v2] preflight skipped for ${input.runId}:`, err instanceof Error ? err.message.slice(0, 160) : err), undefined));

  const previewFile = path.join(dir, "v2preview.mp4");
  await run(ff, ["-y", "-v", "error", "-i", master, "-vf", "scale=-2:1280", "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", previewFile], { timeout: 90_000 });
  const contactSheetFile = path.join(dir, "v2sheet.jpg");
  await run(ff, ["-y", "-v", "error", "-i", master, "-vf", `fps=6/${f3(total)},scale=270:-2,tile=6x1`, "-frames:v", "1", "-q:v", "4", contactSheetFile], { timeout: 60_000 });

  // Subtitles: the TTS lines from their word timings, the talk lines from their estimated timings.
  const ttsCues: SubtitleCue[] = vo ? vo.words.flatMap((w, i) => subtitleCues(w, vo.placements[i], 32, vo.lines[i].text)) : [];
  const talkCues: SubtitleCue[] = talkWordsByFrame.flatMap((ws) => subtitleCues(ws.map((x) => ({ text: x.text, startSec: x.startSec, durSec: x.endSec - x.startSec })), { startSec: 0, tempo: 1 }, 32));
  const cues = [...ttsCues, ...talkCues].sort((a, b) => a.startSec - b.startSec).map((c) => ({ ...c, endSec: Math.min(c.endSec, total) })).filter((c) => c.endSec - c.startSec > 0.2);
  const srt = cues.length ? toSrt(cues) : null;
  // Cover frames: the best-scoring frame of the clean cut (no captions / cards burned in yet) with the hook
  // headline, for feed and Reels covers (local, never blocks).
  const headline = plan.cards.find((c) => c.role === "hook")?.text ?? null;
  const covers = await import("./covers")
    .then(async (m) => ({ ...(await m.makeCovers({ file: body, dir, headline, plan: { durationSec: total, ctaSec: plan.ctaSec, cutsSec: plan.boundaries.map((b) => b.atSec), shots: m.coverShots(plan, input.frames) }, look })), headline }))
    .catch((err) => (console.warn(`[edit-v2] covers skipped for ${input.runId}:`, err instanceof Error ? err.message.slice(0, 160) : err), null));
  return { masterFile: master, previewFile, contactSheetFile, voiceoverFile: vo?.voiceoverFile ?? null, srt, qc, plan, covers };
}

/**
 * Music bed level under the voice (before the side-chain duck). The beds are normalised to −14 LUFS;
 * 0.28 keeps the original pop bed (−13.3 LUFS at 0.26) where it sat in the mix.
 */
export const MUSIC_BED_GAIN = 0.28;

export const CTA_HERO_URL = "local://cta-hero";

/** Swap the CTA clip for the packshot hero still when its keyframe check says the product is not a hero. */
async function applyCtaHero(input: { dir: string; canvas: Canvas; frames: AssembleFrame[]; planInput: PlanInputSegment[]; sources: Map<string, string>; runId: string }): Promise<void> {
  const seg = input.planInput.find((s) => (s.segment ?? "").toUpperCase() === "CTA");
  const frame = seg ? input.frames.find((f) => f.frameNumber === seg.frameNumber) : undefined;
  // A talking-head CTA keeps its clip (its audio is the presenter's line).
  if (!seg || !frame?.packshotUrl || seg.nativeAudio) return;
  const decision = ctaHeroDecision(frame.productBox);
  if (!decision.use) return;
  try {
    let packFile = input.sources.get(frame.packshotUrl);
    if (!packFile) {
      const res = await fetch(frame.packshotUrl, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`packshot download ${res.status}`);
      packFile = path.join(input.dir, "ctapack.img");
      await writeFile(packFile, Buffer.from(await res.arrayBuffer()));
      input.sources.set(frame.packshotUrl, packFile);
    }
    const src = input.sources.get(seg.url);
    if (!src) throw new Error("CTA source missing");
    let bgFile = src;
    if (seg.kind === "clip") {
      bgFile = path.join(input.dir, "ctabg.jpg");
      await run(ffmpegPath!, ["-y", "-v", "error", "-ss", f3(seg.from), "-i", src, "-frames:v", "1", "-q:v", "3", bgFile], { timeout: 60_000 });
    }
    const hero = await composeCtaHero({ packshot: await readFile(packFile), background: await readFile(bgFile), canvas: input.canvas });
    const heroFile = path.join(input.dir, "ctahero.jpg");
    await writeFile(heroFile, hero);
    input.sources.set(CTA_HERO_URL, heroFile);
    // Every CTA frame on that source becomes the hero still.
    for (const s of input.planInput) {
      if ((s.segment ?? "").toUpperCase() !== "CTA" || s.url !== seg.url) continue;
      Object.assign(s, { kind: "still", url: CTA_HERO_URL, from: 0, speed: 1, zoomHit: null, productBox: null });
    }
    console.info(`[edit-v2] CTA hero from the packshot for ${input.runId} (${decision.reason})`);
  } catch (err) {
    console.warn(`[edit-v2] CTA hero skipped for ${input.runId}:`, err instanceof Error ? err.message.slice(0, 160) : err);
  }
}
