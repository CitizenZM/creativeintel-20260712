# Retrospective — TCL Black Friday 15 s × 3 (2026-10-04)

QM7L "Unwrap the Holidays", QM8L "Hangs Like Art", NXTPAPER 14 "Full Page, No Glare". Eight cuts (v1→v8) from
Barron's notes. Locked scripts: `examples/tcl-bfcm/locked_v4.py`; composites: `examples/tcl-bfcm/build_v4.py`.
Read this before planning any promo ad; the rules themselves live in `promo-campaign-planning.md`.

## What went wrong, and the rule it produced
| Area | What happened | Rule now |
|---|---|---|
| Hook | Doorbell / installers opened the ad — no pull | 0–3 s = sale pitch: question + live % off + the product's surprise (gift reveal, 1-s install) |
| Offer | No number on screen | % from live price vs compare-at (Shopify `.js`), "UP TO" when sizes differ, dated fine print |
| Casting | Unspecified extras came out random; ethnic drift; East Asian installers | Brief sets the audience; every person described in every prompt; one family/couple cast sheet; "only X from image 1" |
| Identity | Group shots drift; Kling morphs fast group jumps | Lead sharp in front, extras soft behind; avoid mass jumping on Kling |
| Product | Thick bezels: the reference was an angled crop | Straight-front render, screen rect by pixel profile, shot's own picture composited on screen (`refImageUrl`) |
| Wording | "framed painting" → model drew a wooden frame; cream mat read as a border | Say "full-screen picture, hair-thin metal edge"; art mode is edge-to-edge |
| Life | Thrown popcorn, people staring at the TV | Christmas balloons, people talking/looking at each other, the family dog on the floor |
| Video | Keyframe faces hidden, but the clip turned installers to camera | Motion prompt must keep backs to camera; check clips, not only keyframes |
| Zoom | Hand-set targets missed the product | Detect product box + claim point on the actual clip frame; target 0.6·point + 0.4·centre |
| VO | 1-s frames with 5-word lines → rushed, fragmented ("Unwrap… Next Paper") | ≤ 3 words per 1-s frame, lines may run into the next silent frame; one thought per line |
| Captions | "Next Paper Fourteen" on screen; caption repeated the headline | `{NXTPAPER 14|Next Paper Fourteen}` spelling markup; captions skip text already on screen |
| TTS | "&" in "Bang & Olufsen" silently killed the whole QM8L voiceover; QC passed | SSML escaping; QC fails a master whose script has VO but no words |
| SFX | Zoom thumps, then per-cut whooshes ("cha-cha") | Transitions silent; one soft pop for the CTA button |
| Music | Synth EDM bed felt cheap | Seasonal bed: Jingle Bells chorus (public domain) on celesta + soft piano, clean bells, under the voice |
| CTA | Static end card | Last 1 s: logo + bouncing "CLAIM COUPON" (brand kit CTA) |
| QC | Flash vision flagged bezels on everything; Gemini can't name melodies | Pro for disputed geometry, pixels/FFT for precise checks; 3 failed re-rolls → stop and ask |
| Cost | Vision QC uncounted → ~$9–10 vs $8.5 cap; usage log double-counts concurrent polls | Budget includes review calls; cap check before every paid step |
| Tooling | Importing `build.py` re-ran it and overwrote approved stills | Composite scripts: helpers separate from side effects |

## Where the skill goes next (priority order)
1. **Pitch-line generator** — read live price/compare-at + promo, write the 3 hook lines, VO and dated fine print.
2. **Product-reference builder in the pipeline** — screen-rect detection on the front render, per-shot screen
   composites, automatic `refImageUrl`; no hand work.
3. **Script linter** before any spend — per-frame VO word budget, banned phrases (framed painting, thrown food,
   faces to camera), every cast shot has an interaction, every person has ethnicity/age/wardrobe, claims ↔ sources.
4. **Clip-level QC with auto re-render** — sample each clip (identity vs cast sheet, faces of installers,
   morphing, bezel) and re-render failures inside the approved budget.
5. **Zoom targeting inside render** — detect product + claim point per zoom shot at assembly time.
6. **Better voice** — Edge TTS sounds robotic in reviews; add a premium TTS option (budgeted) and voice casting.
7. **Music library** — moods beyond holiday (premium, tech, family) and brand-licensed tracks via the kit.
8. **Budget ledger** — every paid call (generation + review) against the run's cap; fix the double-logged polls.
