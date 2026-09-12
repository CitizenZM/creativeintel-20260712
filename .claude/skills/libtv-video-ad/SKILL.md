---
name: libtv-video-ad
description: LibTV 视频广告生成 — end-to-end pipeline for short vertical video ads and ad images (TikTok/Meta, 10–15s) with the LibTV CLI: brand research, reference teardown, hook grammar, beat-accurate shot design, keyframe→clip generation, product-consistency enforcement, local motion-floor assembly, and a measured QC gate. Use whenever Barron asks for AI-generated video or image ads for a brand.
tags: [video, ads, libtv, tiktok, meta, storyboard, beat-sync, motion, qc, production]
---

# LibTV 视频广告生成

Built from the MIXIK campaign (2026-09-10) and the TCL US campaign (2026-09-11), then rewritten
after the 2026-09-11 review in which all five of Barron's complaints were reproduced as numbers
and fixed in code. Everything here is measured, not assumed.

## Two rules that shape everything

**1. All thinking happens locally in Claude; LibTV is only a render farm.**
Briefs, competitor teardowns, concepts, shot lists, prompts, captions, edits and QC are local.
LibTV is called only to generate images and video clips. Never use LibTV's in-canvas LLM
(GVLM / script node / Agent) — it duplicates Claude and costs credits.

**2. Nothing ships unmeasured.** Every render goes through `scripts/qc_gate.py` before it is
shown to anyone. If a check fails, either fix it or state the failure explicitly — never send a
file whose gate you did not run. See `reference/qc-gate.md`.

Corollary: **the final edit is local** (Python/PIL + ffmpeg). Text, logo, captions, speed ramps,
transitions, colour effects and end cards never come out of a video model — models garble text
and cannot hit a beat.

## Seven phases

1. **Brand intake** — official site `/products.json` (SKUs, prices, claims, image URLs), social
   footprint, review voice, competitors. Download official product photos; they are the only
   source of truth for packaging. Confirm which SKU and its real height in cm. Verify live
   promos before writing any promo claim; mark unlaunched details `[占位]`.
2. **Reference teardown** — `scripts/analyze_reference.py` on 3–5 benchmark ads. Produce a
   per-cut shot table *and* run `scripts/diagnose_cut.py` on each so the campaign has its own
   measured targets for cut density, static share and motion. Cite video + timestamp for every
   borrowed move.
3. **Concept + hook** — pick a hook structure per ad (question / contrast / product-blast, see
   `reference/motion-and-rhythm.md` §5) and write the payoff it sets up. A hook with no payoff
   in the body is a rejected concept.
4. **Script** — beat grid from `aubio`, per-cut 画面/运镜/转场/字幕/声音, **a transition named for
   every boundary**, generation plan, cost estimate. Approval gate before spending credits.
5. **Keyframes** — images first (cheap). A clip inherits its first frame: static keyframe →
   static clip. Generate mid-movement. See `reference/shot-design.md`.
6. **Clips** — image-to-video, cheapest model that passes QC. Budget roughly one clip per 1.5 s
   of人 footage; no clip may appear more than twice in 15 s.
7. **Assembly + QC** — build with `scripts/motion_engine.py` (motion floor, `snap()`, centred
   transitions, per-beat accents), then `scripts/qc_gate.py` on every ratio and duration, then
   export 9:16 master + natively-laid-out 4:5 / 1:1 + 720p preview.

## Hard rules learned the hard way

- **No frame is ever drawn twice.** Every synthetic frame carries ≥2 motions (push + bob, pan +
  breathe, light sweep, text easing) and synthetic camera moves get `motion_blur`. A still with
  Ken Burns is a fallback, not a shot. *(v1: static_share 0.61, longest still 2.7 s.)*
- **Snap to the nearest frame, never `t < beat`.** Rounding up put every cut 21 ms late.
- **Centre transitions on the beat frame**, so the frame where the picture changes IS the beat.
- **Accent every beat, not just the cuts.** ~32 beats per 15 s, only ~12 cuts — the other 20 get
  a scale pop + brightness lift, downbeats get a flash.
- **Never hard-cut out of the hook**; name a transition for every boundary and rotate the kinds.
- **Frame one is bright and contains the product or subject.** No dark 2–3 s build-up.
- **Always `-af loudnorm=I=-14:TP=-1.5:LRA=7`.** v1 shipped clipping at +1.5 dBFS.
- **A 10 s cutdown gets its own music window**, with its own build→drop.
- **Product consistency is non-negotiable.** Any frame where the label is readable uses the
  official photo composited locally (`reference/product-consistency.md`).
- **Scale is a spec, not a vibe.** cm → face-height ratio, in every prompt, audited with
  `scripts/face_box.swift` (≤0.28 for a 4–5 cm product).
- **One hero product per ad**, at most two supporting, **no blank device screens** — composite
  original content into every visible panel (`scripts/screens.py`).
- **Render plates and end cards natively per ratio**; only centre-crop generated people footage.
- **Offer choices, don't default them**: ship hook variants and CTA styles as flags, and send a
  contact sheet so Barron picks.
- **Budget discipline**: CLI node creation is billed even without `--run` — never probe prices
  that way. Use the measured table in `reference/libtv-cli.md`, generate only people/hands
  (products and screens are composited locally), and read the balance in the web UI before and
  after every batch.

## Quick command map

```bash
# analyse references + set this campaign's targets (local, no credits)
python3 scripts/analyze_reference.py "<url>" --out refs/<slug> --vocab "Brand, Product"
python3 scripts/diagnose_cut.py refs/<slug>/source.mp4

# LibTV: bind a canvas, upload refs, generate, download
libtv project create "<canvas>" && libtv project use <uuid>
libtv upload "ref name" --file path.png
libtv node create "K1" -t image  --left "ref name" --prompt "..." \
  -s "model=Seedream 4.0" -s modeType=image2image -s ratio=9:16 -s quality=2K -s count=1 --run
libtv node create "V1" -t video  --left "K1" --prompt "..." \
  -s "model=Hailuo 2.3 Fast" -s modeType=singleImage2video -s duration=6 --run
libtv download -n "V1" -o clips/ --without-ai-watermark --vip

# product work (local)
swift scripts/cutout.swift product.png cutouts/product.png
swift scripts/face_box.swift shot.png

# build + gate (local) — motion_engine supplies snap/transitions/accents
python3 build_<brand>.py --hook q|c|p --cta 1|2|3|4 --dur 15 --ratio 9x16
python3 scripts/qc_gate.py out/*.mp4 --beats assets/music/track_15s.beats.txt
python3 scripts/av_sync.py out/ad.mp4 assets/music/track_15s.m4a     # once per project
```

## Reference files

| File | What's in it |
|---|---|
| `reference/motion-and-rhythm.md` | motion floor, nearest-frame snapping, beat accents, transition grammar, hook structures, CTA styles, audio rules — **read before writing any build script** |
| `reference/qc-gate.md` | the ten checks, benchmark-derived thresholds, the v1→v2 record, manual gates |
| `reference/libtv-cli.md` | auth, node/edge model, params per model, measured credit prices, canvas-only features, error catalogue |
| `reference/shot-design.md` | beat structures, keyframe-must-be-mid-motion rule, pose recipes, VFX menu, typography + safe zones |
| `reference/product-consistency.md` | cutout, scale rule + audit, bottle swap with finger preservation |
| `reference/reference-analysis.md` | the local video-teardown method and its token economics |
| `reference/lessons.md` | every failure from all three runs and its fix |

## Scripts

| Script | Use |
|---|---|
| `motion_engine.py` | `snap`, `Timeline`, `apply_transition`, `apply_accent`, `ken_burns`, `light_sweep`, `plate_motion`, `motion_blur` |
| `qc_gate.py` | the ship gate (exits non-zero on failure) |
| `diagnose_cut.py` | cuts, static share, motion, beat offsets for any video |
| `av_sync.py` | audio lag between a render and its source music |
| `screens.py` | composite original content into device panels |
| `analyze_reference.py` | reference-ad teardown with transcript + contact sheets |
| `cutout.swift` / `face_box.swift` / `person_mask.swift` | Apple Vision subject lift, scale audit |
| `build_cut_example.py` / `build_multi_ratio_example.py` | skeleton builders |

## Decision points to raise with Barron (don't guess)

SKU and real dimensions · talent look and ethnicity · credit cap per ad · music source (licence
may forbid re-editing) and whether an SFX library is available · claim substantiation · where the
CTA points · which hook variant and CTA style to ship · which visual-effect variants to A/B.
