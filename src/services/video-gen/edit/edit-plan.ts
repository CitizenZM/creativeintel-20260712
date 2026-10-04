/**
 * The edit decision list for a server-rendered ad — pure, so every rule is
 * unit-tested. It turns the storyboard's 2-second segments into the shots of a
 * paced, beat-cut edit:
 *
 *   HOOK  1-beat-pair shots (≈1 s) alternating wide / punch-in — the densest
 *         part of the ad, because the first 3 s decide whether anyone stays
 *   BODY  one shot per 2 s frame; a still is split in two with different motion
 *         (nothing is drawn twice), a clip that continues from the previous
 *         shot gets a punch-in reframe so the eye still sees a cut
 *   CTA   one continuous end card with motion
 *
 * Every boundary sits on a beat frame. Boundaries where the picture changes
 * source get a transition from the grammar in the libtv-video-ad skill:
 *   hook → body   flash + impact (the music's drop)
 *   body → body   whip / zoom punch, rotated so it never reads as a template
 *   into the CTA  whip + whoosh, and the CTA button lands with a click
 * Transitions add light, blur or scale only — the content switch is the cut.
 */
import { beatGrid, beatGridFromTimes, FPS, snapToFrame, round3, type BeatGrid } from "./beat-grid";
import type { SfxEvent } from "./sfx";

export type Transition = "cut" | "flash" | "whip" | "zoom";

export interface PlanInputSegment {
  kind: "clip" | "still";
  url: string;
  /** For clips: where this frame's window starts inside the clip. */
  from: number;
  length: number;
  frameNumber: number;
  /** HOOK | BODY | CTA (storyboard grid segment). */
  segment?: string | null;
  text?: string | null;
  /** Comparison frame: the other side's image + labels, stacked by the renderer. */
  compare?: { otherUrl: string; labelOurs: string; labelOther: string } | null;
  /** Time-remap factor (clips): `speed` × length of source plays in `length`. */
  speed?: number;
  /** Push-in → hold → pull-back target (0–1 of the frame). */
  zoomHit?: { x: number; y: number } | null;
  /** Legal fine print shown while this frame plays. */
  fine?: string | null;
}

export interface Shot {
  index: number;
  kind: "clip" | "still";
  url: string;
  /** Source offset (clips). */
  srcFrom: number;
  startSec: number;
  endSec: number;
  /** Exact frame count, so the concat never drifts off the beat grid. */
  frames: number;
  /** Reframe: 1 = full frame, >1 = punch-in. */
  zoom: number;
  /** Vertical anchor of the punch-in (0 top … 1 bottom). */
  anchorY: number;
  /** Synthetic camera move for stills. */
  motion: "push" | "pull" | "drift" | "none";
  frameNumber: number;
  segment: "HOOK" | "BODY" | "CTA";
  /** Hook variant "c": the shot opens small and boxed, then fills the frame on beat 2. */
  contrast?: boolean;
  /** Comparison: the other side (a still) stacked against ours, with labels. */
  compare?: { otherUrl: string; labelOurs: string; labelOther: string } | null;
  /** Time-remap factor (1 = natural speed). */
  speed?: number;
  /** Push-in → hold → pull-back target (0–1 of the frame), rendered as a camera move. */
  zoomHit?: { x: number; y: number } | null;
}

/**
 * Hook variants for A/B tests on the same edit (libtv-video-ad hook grammar):
 *   q  question — the hook headline over live footage (default)
 *   c  contrast — the first shot starts small and boxed, explodes full-bleed on beat 2
 *   p  product blast — frame one is the real product, pushed at the lens
 */
export type HookStyle = "q" | "c" | "p";

export interface Boundary {
  atSec: number;
  transition: Transition;
}

export interface TextCard {
  text: string;
  startSec: number;
  endSec: number;
  role: "hook" | "claim" | "offer" | "fine";
}

export interface EditPlan {
  durationSec: number;
  grid: BeatGrid;
  dropSec: number;
  ctaSec: number | null;
  breakdownSec: number | null;
  shots: Shot[];
  boundaries: Boundary[];
  sfx: SfxEvent[];
  cards: TextCard[];
  ctaButton: { text: string; startSec: number } | null;
}

const BODY_ROTATION: Transition[] = ["whip", "zoom", "whip", "flash"];

/** No single framing holds longer than this — a longer shot reads as static. */
/** The bouncing CTA button holds the last this-many seconds. */
export const CTA_BUTTON_SEC = 1;
export const MAX_SHOT_SEC = 2;
/** The opening seconds and the last cuts always get a transition, never a plain cut. */
const STRONG_OPEN_SEC = 3;

function seg(s: PlanInputSegment): "HOOK" | "BODY" | "CTA" {
  const v = (s.segment ?? "").toUpperCase();
  return v === "HOOK" || v === "CTA" ? v : "BODY";
}

const words = (t: string) => t.trim().split(/\s+/).filter(Boolean);
const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * Body text overlays become short claim cards only when they add something the
 * voiceover doesn't already say — a headline that repeats the subtitle is noise.
 */
export function isClaimWorthShowing(text: string, voiceover: string | null | undefined): boolean {
  const w = words(text);
  if (!w.length || w.length > 6) return false;
  // A 1–4 word keyword ("3,000 NITS") punches the selling point even when the voiceover says it.
  if (w.length <= 4) return true;
  const vo = norm(voiceover ?? "");
  return !vo || !vo.includes(norm(text));
}

/**
 * The hook headline must read in under a second: the quoted question, else the
 * last sentence, at most 7 words — otherwise none (the captions carry it).
 */
export function hookHeadline(text: string): string | null {
  const t = text.replace(/\s+/g, " ").trim();
  // A quote opens after a space (not the apostrophe in "You're").
  const quoted = /(?:^|\s)['"“‘]([^'"”’]{4,}?)['"”’](?=\s|$|[.,!?])/.exec(t)?.[1]?.trim();
  if (quoted && words(quoted).length <= 9) return quoted;
  const sentences = t.split(/(?<=[.!?…])\s+/).filter(Boolean);
  for (const cand of [sentences[sentences.length - 1], t]) {
    // A question is the classic hook: allow it up to 9 words (three short lines).
    const limit = /\?['"’”]*$/.test(cand ?? "") ? 9 : 7;
    if (cand && words(cand).length <= limit) return cand.replace(/^[.…\s]+/, "");
  }
  return null;
}

/** An offer line that is itself a call to action needs no separate button. */
export function isCtaLine(text: string): boolean {
  return /\b(shop|buy|order|get|grab|claim|sign up|start|try|download|book|learn more)\b/i.test(text);
}

export function planEdit(
  input: PlanInputSegment[],
  opts: {
    bpm?: number;
    /** Beat times of a real track (seconds, already in the edit's timeline). */
    beats?: number[];
    voiceovers?: Map<number, string | null>;
    hookStyle?: HookStyle;
    hookText?: string | null;
  } = {}
): EditPlan {
  if (!input.length) throw new Error("Nothing to edit");
  // Lay the storyboard segments end to end on frame-exact times.
  let t = 0;
  const laid = input.map((s) => {
    const start = snapToFrame(t);
    t += s.length;
    return { ...s, startSec: start, endSec: snapToFrame(t), segment: seg(s) };
  });
  const durationSec = laid[laid.length - 1].endSec;
  const grid = opts.beats?.length ? beatGridFromTimes(opts.beats, durationSec) : beatGrid(durationSec, opts.bpm ?? 120);
  const onBeat = (x: number) => snapToFrame(grid.beats.reduce((b, c) => (Math.abs(c - x) < Math.abs(b - x) ? c : b), grid.beats[0]));

  const firstBody = laid.find((s) => s.segment !== "HOOK");
  const dropSec = firstBody ? onBeat(firstBody.startSec) : onBeat(Math.min(2, durationSec / 4));
  const firstCta = laid.find((s) => s.segment === "CTA");
  const ctaSec = firstCta ? onBeat(firstCta.startSec) : null;
  // A one-bar breakdown before the CTA, when the body is long enough to earn it.
  const bar = 4 * grid.period;
  const breakdownSec = ctaSec !== null && ctaSec - dropSec >= 4 * bar ? round3(ctaSec - bar) : null;

  const shots: Shot[] = [];
  const push = (s: (typeof laid)[number], start: number, end: number, extra: Partial<Shot>) => {
    const a = onBeat(start);
    // The last shot always runs to the end of the ad (its audio does).
    const b = end >= durationSec - 1e-6 ? durationSec : Math.min(durationSec, onBeat(end));
    if (b - a < 1 / FPS) return;
    shots.push({
      index: shots.length,
      kind: s.kind,
      url: s.url,
      srcFrom: s.kind === "clip" ? round3(s.from + (start - s.startSec) * (s.speed ?? 1)) : 0,
      startSec: a,
      endSec: b,
      frames: Math.round((b - a) * FPS),
      zoom: 1,
      anchorY: 0.45,
      motion: s.kind === "still" ? "push" : "none",
      frameNumber: s.frameNumber,
      segment: s.segment,
      compare: s.compare ?? null,
      speed: s.speed ?? 1,
      zoomHit: s.zoomHit ?? null,
      ...extra,
    });
  };

  // CTA frames merge into one end card.
  const ctaFrames = laid.filter((s) => s.segment === "CTA");
  const main = laid.filter((s) => s.segment !== "CTA");
  let bodyFrame = 0;
  for (const s of main) {
    const len = s.endSec - s.startSec;
    // Split at the beat nearest the frame's middle (any tempo), never at its edges.
    const midBeat = grid.beats.reduce((b, x) => (Math.abs(x - (s.startSec + len / 2)) < Math.abs(b - (s.startSec + len / 2)) ? x : b), s.startSec + len / 2);
    const half = midBeat > s.startSec + 0.4 && midBeat < s.endSec - 0.4 ? midBeat : s.startSec + len / 2;
    const splittable = len >= 1.6;
    const prev = shots[shots.length - 1];
    const sameSource = prev && prev.url === s.url;
    if (s.segment === "HOOK" && splittable) {
      // Hook: two shots per 2 s frame — wide, then a punch-in on the beat.
      push(s, s.startSec, half, { zoom: 1, motion: s.kind === "still" ? "push" : "none" });
      push(s, half, s.endSec, { zoom: 1.22, anchorY: 0.4, motion: s.kind === "still" ? "drift" : "none" });
    } else if (s.kind === "still" && splittable) {
      // A still never holds for a whole frame: push, then pull from a tighter frame.
      push(s, s.startSec, half, { motion: "push" });
      push(s, half, s.endSec, { zoom: 1.15, motion: "pull", anchorY: 0.5 });
    } else if (splittable && bodyFrame++ % 2 === 0) {
      // Every other body frame is cut in two (wide → punch-in) — about 1.3 s per
      // shot on average, the pace of the benchmark TV ads.
      push(s, s.startSec, half, { zoom: sameSource && prev.zoom === 1 ? 1.12 : 1, anchorY: 0.42 });
      push(s, half, s.endSec, { zoom: 1.2, anchorY: 0.4 });
    } else {
      // A clip continuing from the previous shot gets a reframe so the cut still reads.
      push(s, s.startSec, s.endSec, { zoom: sameSource && prev.zoom === 1 ? 1.14 : 1, anchorY: 0.42 });
    }
  }
  // Consecutive CTA frames on the same still merge into one end card; a different still
  // (e.g. a side view with a measurement) is its own framing.
  for (let i = 0; i < ctaFrames.length; ) {
    let j = i;
    while (j + 1 < ctaFrames.length && ctaFrames[j + 1].url === ctaFrames[i].url) j++;
    push({ ...ctaFrames[i], endSec: ctaFrames[j].endSec }, ctaFrames[i].startSec, ctaFrames[j].endSec, { motion: i === 0 ? "push" : "pull" });
    i = j + 1;
  }
  // Nothing holds one framing for more than MAX_SHOT_SEC: a long shot is cut on
  // a beat into parts that alternate framing; a clip continues its action across the cut.
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i];
    const len = s.endSec - s.startSec;
    if (len <= MAX_SHOT_SEC + 1e-6 || (s.speed ?? 1) > 1 || s.zoomHit) continue;
    const parts = Math.ceil(len / MAX_SHOT_SEC - 1e-6);
    const cuts: number[] = [];
    for (let k = 1; k < parts; k++) {
      const ideal = s.startSec + (k * len) / parts;
      const beat = onBeat(ideal);
      const at = beat - s.startSec > 0.4 && s.endSec - beat > 0.4 && Math.abs(beat - ideal) < 0.5 ? beat : snapToFrame(ideal);
      if (at > (cuts[cuts.length - 1] ?? s.startSec) + 0.3) cuts.push(at);
    }
    const edges = [s.startSec, ...cuts, s.endSec];
    const pieces: Shot[] = edges.slice(0, -1).map((a, k) => {
      const b = edges[k + 1];
      const tight = k % 2 === 1;
      return {
        ...s,
        startSec: a,
        endSec: b,
        frames: Math.round((b - a) * FPS),
        srcFrom: s.kind === "clip" ? round3(s.srcFrom + (a - s.startSec)) : 0,
        zoom: tight ? Math.min(1.3, Math.max(1, s.zoom) * 1.14) : s.zoom,
        anchorY: tight ? 0.42 : s.anchorY,
        motion: s.kind === "still" ? (tight ? "pull" : "push") : s.motion,
      };
    });
    shots.splice(i, 1, ...pieces);
    i += pieces.length - 1;
  }
  // Hook variants rewrite only the opening shot; body and CTA stay identical.
  const opener = shots[0];
  if (opener && opener.segment === "HOOK" && opts.hookStyle === "c") opener.contrast = true;
  if (opener && opener.segment === "HOOK" && opts.hookStyle === "p") {
    const product = laid.find((s) => s.segment === "CTA" && s.kind === "still");
    if (product) Object.assign(opener, { kind: "still", url: product.url, srcFrom: 0, zoom: 1.1, motion: "push", anchorY: 0.5, compare: null });
  }
  // Re-index and close any rounding gaps so shots tile the timeline exactly.
  for (const [i, sh] of shots.entries()) {
    sh.index = i;
    // The video starts at 0 whatever the track's first beat is (a later first
    // shot would shift every following cut by that much).
    sh.startSec = i > 0 ? shots[i - 1].endSec : 0;
    sh.frames = Math.max(1, Math.round((sh.endSec - sh.startSec) * FPS));
  }

  // Transitions on source changes; punch-ins inside a source are plain cuts.
  const boundaries: Boundary[] = [];
  const sfx: SfxEvent[] = [];
  let rot = 0;
  for (let i = 1; i < shots.length; i++) {
    const at = shots[i].startSec;
    const changed = shots[i].url !== shots[i - 1].url;
    let tr: Transition = "cut";
    if (Math.abs(at - dropSec) < 1e-3) tr = "flash";
    else if (ctaSec !== null && Math.abs(at - ctaSec) < 1e-3) tr = "whip";
    // Hook cuts don't advance the body rotation, so hook variants keep identical body transitions.
    else if (changed && shots[i].segment === "HOOK") tr = "whip";
    else if (changed) tr = BODY_ROTATION[rot++ % BODY_ROTATION.length];
    else if (shots[i].zoom > shots[i - 1].zoom) tr = "zoom";
    // The opening and the ending are where motion sells: no plain cuts there.
    if (tr === "cut" && (at <= STRONG_OPEN_SEC || i >= shots.length - 2)) tr = shots[i].zoom > shots[i - 1].zoom ? "zoom" : "whip";
    boundaries.push({ atSec: at, transition: tr });
  }
  // No sound on transitions at all — whooshes and thumps on cuts read as noise ("cha-cha") under the
  // voice and music (Barron, 2026-10-04). The only effect is the soft pop when the CTA button lands.

  // On-screen text: the hook headline, short claims, the offer on the end card.
  const cards: TextCard[] = [];
  const hookRaw = laid.find((s) => s.segment === "HOOK" && s.text?.trim())?.text?.trim();
  const hookText = opts.hookText?.trim() || (hookRaw ? hookHeadline(hookRaw) : null);
  // Several hook frames with their own text (locked scripts): each line holds its own frame;
  // otherwise the first line holds the whole hook.
  const hookFrames = laid.filter((s) => s.segment === "HOOK" && s.text?.trim());
  if (hookFrames.length > 1 && !opts.hookText) {
    hookFrames.forEach((s, i) =>
      cards.push({ text: s.text!.trim(), startSec: s.startSec, endSec: i === hookFrames.length - 1 ? Math.max(s.endSec, dropSec) : s.endSec, role: "hook" })
    );
  } else if (hookText) cards.push({ text: hookText, startSec: 0, endSec: Math.max(1.5, dropSec), role: "hook" });
  for (const s of main) {
    if (s.segment !== "BODY" || !s.text?.trim()) continue;
    if (!isClaimWorthShowing(s.text, opts.voiceovers?.get(s.frameNumber))) continue;
    const last = cards[cards.length - 1];
    if (last?.text === s.text.trim()) {
      last.endSec = s.endSec;
      continue;
    }
    cards.push({ text: s.text.trim(), startSec: s.startSec, endSec: s.endSec, role: "claim" });
  }
  const fine = laid.find((s) => s.fine?.trim())?.fine?.trim();
  if (fine) {
    const from = laid.filter((s) => s.fine?.trim()).reduce((m, s) => Math.min(m, s.startSec), durationSec);
    cards.push({ text: fine, startSec: from, endSec: durationSec, role: "fine" });
  }
  const offerText = ctaFrames.find((s) => s.text?.trim())?.text?.trim();
  if (offerText && ctaSec !== null) cards.push({ text: offerText, startSec: ctaSec, endSec: durationSec, role: "offer" });
  // The CTA button (with the logo) bounces in for the last second of every ad, with a soft pop.
  const ctaButton = ctaSec !== null ? { text: "Shop now", startSec: round3(Math.max(ctaSec, durationSec - CTA_BUTTON_SEC)) } : null;
  if (ctaButton) sfx.push({ kind: "click", atSec: ctaButton.startSec });

  return { durationSec, grid, dropSec, ctaSec, breakdownSec, shots, boundaries, sfx, cards, ctaButton };
}
