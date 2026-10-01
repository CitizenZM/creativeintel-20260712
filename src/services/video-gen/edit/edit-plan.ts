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
import { beatGrid, FPS, snapToFrame, round3, type BeatGrid } from "./beat-grid";
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
  role: "hook" | "claim" | "offer";
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
  opts: { bpm?: number; voiceovers?: Map<number, string | null>; hookStyle?: HookStyle; hookText?: string | null } = {}
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
  const grid = beatGrid(durationSec, opts.bpm ?? 120);
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
    const b = Math.min(durationSec, onBeat(end));
    if (b - a < 1 / FPS) return;
    shots.push({
      index: shots.length,
      kind: s.kind,
      url: s.url,
      srcFrom: s.kind === "clip" ? round3(s.from + (start - s.startSec)) : 0,
      startSec: a,
      endSec: b,
      frames: Math.round((b - a) * FPS),
      zoom: 1,
      anchorY: 0.45,
      motion: s.kind === "still" ? "push" : "none",
      frameNumber: s.frameNumber,
      segment: s.segment,
      ...extra,
    });
  };

  // CTA frames merge into one end card.
  const ctaFrames = laid.filter((s) => s.segment === "CTA");
  const main = laid.filter((s) => s.segment !== "CTA");
  let bodyFrame = 0;
  for (const s of main) {
    const len = s.endSec - s.startSec;
    const half = s.startSec + Math.round((len / 2) / grid.period) * grid.period;
    const prev = shots[shots.length - 1];
    const sameSource = prev && prev.url === s.url;
    if (s.segment === "HOOK" && len >= 4 * grid.period * 0.99) {
      // Hook: two shots per 2 s frame — wide, then a punch-in on the beat.
      push(s, s.startSec, half, { zoom: 1, motion: s.kind === "still" ? "push" : "none" });
      push(s, half, s.endSec, { zoom: 1.22, anchorY: 0.4, motion: s.kind === "still" ? "drift" : "none" });
    } else if (s.kind === "still" && len >= 4 * grid.period * 0.99) {
      // A still never holds for a whole frame: push, then pull from a tighter frame.
      push(s, s.startSec, half, { motion: "push" });
      push(s, half, s.endSec, { zoom: 1.15, motion: "pull", anchorY: 0.5 });
    } else if (len >= 4 * grid.period * 0.99 && bodyFrame++ % 2 === 0) {
      // Every other body frame is cut in two (wide → punch-in) — about 1.3 s per
      // shot on average, the pace of the benchmark TV ads.
      push(s, s.startSec, half, { zoom: sameSource && prev.zoom === 1 ? 1.12 : 1, anchorY: 0.42 });
      push(s, half, s.endSec, { zoom: 1.2, anchorY: 0.4 });
    } else {
      // A clip continuing from the previous shot gets a reframe so the cut still reads.
      push(s, s.startSec, s.endSec, { zoom: sameSource && prev.zoom === 1 ? 1.14 : 1, anchorY: 0.42 });
    }
  }
  if (ctaFrames.length) {
    const first = ctaFrames[0];
    const last = ctaFrames[ctaFrames.length - 1];
    push({ ...first, endSec: last.endSec }, first.startSec, last.endSec, { motion: "push" });
  }
  // Hook variants rewrite only the opening shot; body and CTA stay identical.
  const opener = shots[0];
  if (opener && opener.segment === "HOOK" && opts.hookStyle === "c") opener.contrast = true;
  if (opener && opener.segment === "HOOK" && opts.hookStyle === "p") {
    const product = laid.find((s) => s.segment === "CTA" && s.kind === "still");
    if (product) Object.assign(opener, { kind: "still", url: product.url, srcFrom: 0, zoom: 1.1, motion: "push", anchorY: 0.5 });
  }
  // Re-index and close any rounding gaps so shots tile the timeline exactly.
  for (const [i, sh] of shots.entries()) {
    sh.index = i;
    if (i > 0) sh.startSec = shots[i - 1].endSec;
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
    boundaries.push({ atSec: at, transition: tr });
    if (tr === "flash") sfx.push({ kind: "impact", atSec: at });
    else if (tr === "whip") sfx.push({ kind: "whoosh", atSec: at });
    else if (tr === "zoom" && changed) sfx.push({ kind: "impact", atSec: at });
  }
  if (ctaSec !== null) sfx.push({ kind: "click", atSec: round3(Math.min(durationSec - 0.3, ctaSec + 2 * grid.period)) });

  // On-screen text: the hook headline, short claims, the offer on the end card.
  const cards: TextCard[] = [];
  const hookRaw = laid.find((s) => s.segment === "HOOK" && s.text?.trim())?.text?.trim();
  const hookText = opts.hookText?.trim() || (hookRaw ? hookHeadline(hookRaw) : null);
  if (hookText) cards.push({ text: hookText, startSec: 0, endSec: Math.max(1.5, dropSec), role: "hook" });
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
  const offerText = ctaFrames.find((s) => s.text?.trim())?.text?.trim();
  if (offerText && ctaSec !== null) cards.push({ text: offerText, startSec: ctaSec, endSec: durationSec, role: "offer" });
  // The button lands two beats into the end card — unless the offer line already is the CTA.
  const ctaButton =
    ctaSec !== null && !(offerText && isCtaLine(offerText)) ? { text: "Shop now", startSec: round3(ctaSec + 2 * grid.period) } : null;

  return { durationSec, grid, dropSec, ctaSec, breakdownSec, shots, boundaries, sfx, cards, ctaButton };
}
