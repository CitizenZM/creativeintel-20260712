#!/usr/bin/env python3
"""motion_engine — the five fixes from the 2026-09-11 review, as reusable parts.

Import this in every brand build script instead of re-deriving the maths:

    from motion_engine import (snap, beat_frames, apply_accent, apply_transition,
                               ken_burns, light_sweep, plate_motion, Timeline)

Why each piece exists (all measured, see reference/qc-gate.md for thresholds):

* snap()            v1 tested `t < beat` inside the frame loop, which rounds a cut UP to the
                    next frame — a systematic +21 ms late bias on every single cut. Rounding to
                    the NEAREST frame removes it (measured bias went +21 ms -> -11 ms).
* apply_transition()a transition that runs entirely BEFORE the beat makes the picture change
                    early; one that runs after makes it change late. Centre the window on the
                    beat frame so the actual change lands on it.
* apply_accent()    a cut only exists on ~1 beat in 4. The other beats still need a visible
                    reaction or the ad reads as "not on the beat" even when the cuts are exact.
* ken_burns/
  light_sweep/
  plate_motion      every synthetic frame (product plate, end card, screen content) must move,
                    or static_share blows past 0.42 and the ad reads as a slideshow.
"""
import math

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

FPS = 30


# ---------------------------------------------------------------- beat grid
def snap(t_beat, fps=FPS, lead_frames=0):
    """Beat time (s) -> frame index, NEAREST frame. Never floor/ceil.

    lead_frames=1 places the change one frame early; only use it if a QC run shows a
    positive (late) bias you cannot remove otherwise.
    """
    return max(int(round(t_beat * fps)) - lead_frames, 0)


def beat_frames(beats, fps=FPS, lead_frames=0, downbeat_every=4):
    """-> (set of beat frame indices, set of downbeat frame indices)."""
    bf = {snap(t, fps, lead_frames) for t in beats}
    db = {snap(beats[i], fps, lead_frames) for i in range(0, len(beats), downbeat_every)}
    return bf, db


# ---------------------------------------------------------------- per-beat accent
def apply_accent(img, i, bfs, dbs, pop=0.02, pop_down=0.035, lift=0.05, flash=0.18, tail=2):
    """Scale-pop + brightness lift for `tail` frames after each beat; white flash on downbeats.

    Call on every output frame. Costs nothing, and it is what makes beats 2/3/4 of a bar
    readable when there is no cut there.
    """
    W, H = img.size
    for bf in bfs:
        d = i - bf
        if 0 <= d <= tail:
            fall = 1 - d / (tail + 1)
            s = 1.0 + (pop_down if bf in dbs else pop) * fall
            cw, ch = int(W / s), int(H / s)
            img = img.crop(((W - cw) // 2, (H - ch) // 2, (W - cw) // 2 + cw, (H - ch) // 2 + ch)) \
                     .resize((W, H), Image.BILINEAR)
            img = ImageEnhance.Brightness(img).enhance(1.0 + lift * fall)
            if bf in dbs and d == 0 and flash:
                img = Image.blend(img, Image.new("RGB", (W, H), (255, 255, 255)), flash)
    return img


# ---------------------------------------------------------------- transitions
def apply_transition(img, i, fi, kind, prev_fn, next_fn, t):
    """Blend `img` toward the neighbouring segment across a window CENTRED on frame `fi`.

    kind: "dissolve" | "whip" | "zoom" | "flash"
    prev_fn/next_fn: render callables taking t (seconds) — the outgoing / incoming segment.
    Returns img unchanged when i is outside the window, so it is safe to call unconditionally.
    """
    half = 2 if kind in ("dissolve", "flash") else 3
    if not (fi - half <= i <= fi + half):
        return img
    W, H = img.size
    k = (i - (fi - half)) / (2 * half)          # 0 -> 1 across the window
    env = 1 - abs(k - 0.5) * 2                  # 0 at the edges, 1 on the beat frame
    other = next_fn(t) if i < fi else prev_fn(t)
    if kind == "dissolve":
        return Image.blend(img, other, (0.5 - abs(k - 0.5)) * 0.9)
    if kind == "whip":
        amt = max(int(2 + 40 * env), 1)
        img = img.filter(ImageFilter.BoxBlur(amt))
        if abs(i - fi) <= 1:
            img = Image.blend(img, other.filter(ImageFilter.BoxBlur(amt)), 0.35)
        return img
    if kind == "flash":
        img = Image.blend(img, other, 1.0 if i >= fi else 0.0)
        return Image.blend(img, Image.new("RGB", (W, H), (255, 255, 255)), 0.75 * env)
    z = 1 + 0.22 * env                          # zoom punch
    cw, ch = int(W / z), int(H / z)
    img = img.crop(((W - cw) // 2, (H - ch) // 2, (W - cw) // 2 + cw, (H - ch) // 2 + ch)) \
             .resize((W, H), Image.BILINEAR)
    return Image.blend(img, other, 1.0) if i > fi + half - 1 else img


def motion_blur(img, prev, amount=0.45):
    """Cheap directional smear for synthetic camera moves: blend with the previous frame.

    Without it a Ken-Burns push reads as a slideshow even at the right speed.
    """
    return Image.blend(img, prev, amount) if prev is not None else img


# ---------------------------------------------------------------- always-moving imagery
def ken_burns(src, t, zoom=1.14, speed=0.10, breathe=0.06, sway=0.05):
    """Crop a still so it pans AND breathes — never a frozen frame.

    src: PIL RGB image (screen content, backdrop, packshot backdrop).
    """
    z = zoom + breathe * math.sin(t * 1.1)
    cw, ch = int(src.width / z), int(src.height / z)
    x = int((src.width - cw) * min(max(0.15 + speed * t, 0), 1))
    y = int((src.height - ch) * (0.5 + sway * math.sin(t * 0.8)))
    return src.crop((x, y, x + cw, y + ch))


def light_sweep(im, t, period=1.9, strength=0.34, colour=(255, 255, 255)):
    """A soft band of light travelling across the frame — motion on an otherwise still plate."""
    W, H = im.size
    k = (t % period) / period
    m = Image.new("L", (W, H), 0)
    sx = int(-400 + (W + 800) * k)
    ImageDraw.Draw(m).polygon([(sx, 0), (sx + 150, 0), (sx + 420, H), (sx + 270, H)],
                              fill=int(255 * strength))
    return Image.composite(Image.new("RGB", (W, H), colour), im, m.filter(ImageFilter.GaussianBlur(70)))


def plate_motion(age, push_rate=0.09, bob_px=11, bob_rate=2.4, drift_px=10, drift_rate=0.9):
    """-> (scale, bob_y, drift_x) for a product sitting on a plate. `age` = t - segment start."""
    return (1.0 + push_rate * age,
            int(bob_px * math.sin(age * bob_rate)),
            int(drift_px * math.sin(age * drift_rate)))


def eob(t):
    """Back-out easing for text/badge pops."""
    c1, c3 = 1.70158, 2.70158
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2


# ---------------------------------------------------------------- timeline glue
class Timeline:
    """Segments defined by beat INDEX, rendered with centred transitions and per-beat accents.

        tl = Timeline(beats, fps=30)
        tl.add(0, 4,  hook_fn,  "whip")
        tl.add(4, 8,  plate_fn, "dissolve")
        tl.add(8, None, cta_fn, None)
        frames = tl.render(duration_s)
    """

    def __init__(self, beats, fps=FPS, lead_frames=0, accent=True):
        self.b, self.fps, self.lead, self.accent = beats, fps, lead_frames, accent
        self.segs = []

    def add(self, start_beat, end_beat, fn, transition="dissolve"):
        self.segs.append((start_beat, end_beat, fn, transition))

    def _fn_at(self, t):
        for s, e, fn, _ in self.segs:
            if e is None or t < self.b[e] - self.lead / self.fps:
                return fn
        return self.segs[-1][2]

    def render(self, dur, blur_synth=False):
        bfs, dbs = beat_frames(self.b, self.fps, self.lead)
        bounds = [(snap(self.b[e], self.fps, self.lead), tr, fn, self.segs[i + 1][2])
                  for i, (s, e, fn, tr) in enumerate(self.segs) if e is not None and tr]
        out, prev = [], None
        for i in range(int(dur * self.fps)):
            t = i / self.fps
            img = self._fn_at(t)(t)
            for fi, kind, prev_fn, next_fn in bounds:
                img = apply_transition(img, i, fi, kind, prev_fn, next_fn, t)
            if self.accent:
                img = apply_accent(img, i, bfs, dbs)
            if blur_synth:
                img, prev = motion_blur(img, prev, 0.25), img
            out.append(img)
        return out
