# Motion and rhythm — the five defects and their permanent fixes

Written after the 2026-09-11 review of the MIXIK and TCL runs, where all five problems Barron
named were reproduced with measurements (`scripts/diagnose_cut.py`, `scripts/av_sync.py`) and
then fixed in code. Every rule below is enforced by `scripts/qc_gate.py`; the implementations
live in `scripts/motion_engine.py`.

---

## 1. "Too many still frames" — the motion floor

**What actually happened.** In the TCL v1 ads 8 of 15 seconds were locally composited product
plates and end cards, rendered as one static image with text on top. Measured: `static_share`
0.53–0.61 and a 2.7 s stretch with no movement at all, against 0.25–0.42 in benchmark ads.

**Rule: no frame is ever drawn twice.** Every synthetic frame carries at least two independent
motions. Use `motion_engine`:

| Layer | Function | Typical setting |
|---|---|---|
| Product / hero | `plate_motion(age)` → scale, bob, drift | push 0.09/s, bob 11 px @ 2.4 rad/s |
| Backdrop / screen content | `ken_burns(src, t)` | zoom 1.14, pan 0.10/s, breathe 0.06 |
| Light | `light_sweep(im, t)` | period 1.9 s, strength 0.34 |
| Text | `eob()` pop on entry, never a hard appear | 0.16–0.25 s |
| Synthetic camera moves | `motion_blur(img, prev, 0.25)` | always — without it a push still reads as a slide |

**Corollary for generated clips**: a still + Ken Burns is a fallback, not a shot. Budget one
generated clip per ~1.5 s of人 footage; reusing one clip more than twice in 15 s is a defect
(`beat_accent_pct` stays fine but the ad feels looped).

---

## 2. "Beats don't land" — nearest-frame snapping

Three separate causes, all found by measurement:

1. **Mux offset** — ruled out. `av_sync.py` measured 0 ms lag (corr 0.998) between the render's
   audio and the source window. Never assume this; measure it first, it takes 5 seconds.
2. **Frame rounding** — the real cause. v1 decided cuts with `if t < beat`, which effectively
   rounds UP: every cut landed 0–33 ms late, mean **+21 ms**. Fix: `snap()` rounds to the
   nearest frame. Measured bias afterwards: **−11 ms**.
3. **Transition placement** — a transition running entirely *before* the boundary moves the
   perceived change earlier; running it after moves it later. Fix: `apply_transition()` centres
   the window on the beat frame (±2 frames for dissolve/flash, ±3 for whip/zoom) so the frame
   where the picture actually changes IS the beat frame.

**Never place anything by feel.** Beat list from `aubio`, every cut / word / logo / speed change
snapped to it, then `qc_gate.py` proves it. `beat_bias_ms` ≤ ±20, `beat_max_ms` ≤ 50.

---

## 3. "Weak rhythm" — accents on beats that have no cut

A 15 s ad at 125 BPM has ~32 beats but only ~12 cuts. v1 gave the other 20 beats nothing, and
that is what "卡点不准" actually feels like even when the cuts are frame-exact.

`apply_accent()` runs on every output frame: 2–3.5 % scale pop + 5 % brightness lift decaying
over 3 frames, plus an 18 % white flash on downbeats. Cost: zero credits, ~0 ms.

**Target**: ≥ 25 % of beats carry a cut, 100 % carry an accent.

---

## 4. "Hard jumps" — transition grammar

Never cut hard out of the hook. Assign a transition to every segment boundary:

| Boundary | Transition | Why |
|---|---|---|
| Hook → body | `whip` (blur ±3 frames) | carries energy, hides a subject change |
| Body → body, same subject | `dissolve` (±2) | keeps continuity while the product changes |
| Into a price / offer reveal | `zoom` punch (±3) | reads as emphasis, not as a new scene |
| The track's measured drop | `flash` (±2) | the loudest musical event gets the loudest visual one |

Rotate them — three identical whips in 15 s reads as a template. Find the drop by taking the
largest positive jump in the RMS envelope of the music window, then give the boundary nearest it
the flash.

**Two implementation traps, both found by the QC gate, both now fixed in `motion_engine`:**

* **A transition must never swap content itself.** The segment function already switched at the
  beat frame; a transition that also blends toward `other` after `fi` restores the OUTGOING
  segment for the rest of the window and moves the visible change ~100 ms late. This bit both
  the zoom punch and the flash, and only showed up on the two ads whose drop landed on a flash
  boundary — which is why the gate has to run on every file, not on one sample.
* A whip's blur envelope must be **asymmetric**: build over the frames before the beat, clear
  within 2 frames after it. A symmetric envelope buries the change under maximum blur exactly
  where it should be sharpest, and the cut reads ~2 frames late.

**Clamp synthetic motion.** A push of 9 %/s is right for a 2 s plate and absurd for a 20 s still;
cap the motion age (2.5 s) so nothing ever grows out of frame.

---

## 5. Hook grammar — the first 3 seconds

The hook must pose something the rest of the ad pays off. Three structures, all implemented as
swappable functions so they can be A/B tested on the same edit:

| Variant | Structure | Payoff |
|---|---|---|
| `q` question | on-screen question over live footage, second line lands on beat 2 | the body answers it |
| `c` contrast | small, dim, boxed "before" frame → explodes full-bleed on beat 2 | the size/quality jump IS the product claim |
| `p` product blast | product pushed at the lens on frame one, bright, spec lines stack in | straight to the offer, best for retargeting |

Hard rules: **frame one is bright and contains the product or the subject**; no 2–3 s build-up;
the hook's last frame transitions (never cuts) into the body; the payoff arrives before 5 s.

---

## 6. CTA — four styles, chosen not defaulted

Implemented in the builder as `--cta 1..4`, always rendered natively per ratio:

1. **Stacked** — product, red save badge, CTA line, logo, URL. Safest, works at 1:1.
2. **Banner wipe** — full-bleed colour bar wipes in on a beat, CTA reversed out of it. Highest contrast.
3. **Light card + pill button** — light ground, red pill with back-out easing. Feels like the site.
4. **Split block** — product above, offer block with a colour rule beside the copy. Most "retail".

All four: logo and URL appear ≥ 0.35 s after the CTA text (so the eye reads the offer first),
legal line at 26 px bottom, product small and low so nothing overlaps.

---

## 7. Audio

- Always end with `-af loudnorm=I=-14:TP=-1.5:LRA=7`. v1 shipped at **+1.5 dBFS true peak**
  (clipping on phone speakers) and −10 LUFS; both fail `qc_gate`.
- Measure mux lag with `av_sync.py` once per project, not per render.
- A 10 s cutdown needs **its own music window** with its own build→drop, not the first 10 s of
  the 15 s window.
- If the licence forbids remixing (Mixkit free), the window must already contain the build and
  the drop — you cannot splice one together.
- **SFX are synthesised, not sampled** (`scripts/sfx.py`): swept-noise whoosh on whip/dissolve
  boundaries, sine-thump impact on zoom/flash boundaries and the drop, a short blip when the CTA
  lands. Generating them from noise and sine primitives removes the licence question entirely and
  costs nothing. Mix the bed at about −17 dBFS under the music with ffmpeg `amix`, then let
  `loudnorm` normalise the sum.
- **Derive SFX timings from the rendered boundaries, not from the plan** — pass the same snapped
  frame indices the picture used, so the sound cannot drift from the cut.
