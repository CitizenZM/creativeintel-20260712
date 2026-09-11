---
name: design-video-ad-libtv
description: End-to-end pipeline for producing short vertical video ads (TikTok/Meta, 10–15s) with the LibTV CLI — brand research, reference-video teardown, beat-synced shot design, keyframe→clip generation, product-consistency enforcement, and local beat-accurate assembly. Use whenever Barron asks for AI-generated video or image ads for a brand.
tags: [video, ads, libtv, tiktok, meta, storyboard, beat-sync, kbeauty, production]
---

# Video ad production with LibTV

Built from the MIXIK campaign (2026-09-10): 4 hours, 1,053 credits, 3 script generations,
11 finished 15s cuts. Everything here is measured, not assumed.

## The one rule that shapes everything

**All thinking happens locally in Claude; LibTV is only a render farm.**
Briefs, competitor teardowns, creative concepts, shot lists, prompts, captions, edits and QC
are done locally. LibTV is called only to generate images and video clips. Never use LibTV's
in-canvas LLM (GVLM / script node / Agent) for analysis or writing — it duplicates what Claude
already does and costs credits.

Corollary: **the final edit is local** (Python/PIL + ffmpeg). Text, logo, captions, speed ramps,
transitions, colour effects and the end card never come out of a video model — models garble text
and can't hit a beat.

## Six phases

1. **Brand intake** — official site `/products.json` (SKUs, prices, claims, image URLs), social
   footprint, review voice, competitors. Download official product photos; they are the only
   source of truth for packaging. Ask which SKU the ad features: pack shapes differ (MIXIK's 80ml
   full size has a sphere "gumball" cap; the 30ml travel mist is a slim cylinder with a flat cap —
   using the wrong one invalidates every shot).
2. **Reference teardown** — analyse competitor/benchmark ads locally with
   `scripts/analyze_reference.py` (see `reference/reference-analysis.md`). Produce a per-cut
   shot table, not a vibe description. Cite video + timestamp for every borrowed move.
3. **Concept + script** — write the script locally: beat grid, per-cut画面/运镜/转场/字幕/声音,
   generation plan, cost estimate. Get approval **before** spending credits.
4. **Keyframes** — generate images first (cheap). A clip inherits its first frame: a static
   keyframe yields a static clip. See `reference/shot-design.md`.
5. **Clips** — image-to-video, cheapest model that passes QC. Measure cost before batching
   (`reference/libtv-cli.md` has the price-probe trick and a measured price table).
6. **Assembly + QC** — local build script cuts on the measured beat grid; verify with scene
   detection that every cut lands within one frame of a beat; measure product-to-face ratio;
   export 9:16 master, 4:5 crop, 720p preview for phone delivery.

## Hard rules learned the hard way

- **Product consistency is non-negotiable.** Any frame where the label is readable uses the
  official photo composited locally. AI-rendered packaging garbles small text and drifts in shape.
  `reference/product-consistency.md` has the cutout + bottle-swap + scale-audit procedure.
- **Scale is a spec, not a vibe.** Ask for the real height in cm, convert to a face-height ratio,
  put it in every prompt, and audit it with `scripts/face_box.swift`. Marketing packshots are
  deliberately oversized — never use them as a scale reference.
- **Make the first frame bright and put the product in it.** A dark 2–3s build-up loses the
  scroll. Frame one: product pushed at the lens on a high-key set.
- **If it looks like a slideshow, the keyframes were static.** Every generated shot must contain
  a complete action (one dance phrase, one spray, one turn), 1.2–2.2s used per cut.
- **Cut on measured beats, not on a guessed BPM.** `aubio` gives the grid; the build script places
  every cut/word/logo on it; scene detection proves it afterwards.
- **Budget discipline**: probe prices with an unrun node, use the cheapest model that passes QC,
  generate at the resolution you will actually ship, and report credits spent every round.

## Quick command map

```bash
# analyse a reference ad (local, no credits)
python3 scripts/analyze_reference.py "<url>" --out refs/<slug> --vocab "Brand, Product"

# LibTV: bind a canvas, upload refs, generate, download
libtv project create "<canvas>" && libtv project use <uuid>
libtv upload "ref name" --file path.png
libtv node create "K1" -t image  --left "ref name" --prompt "..." \
  -s "model=Seedream 5.0 Pro" -s modeType=image2image -s ratio=9:16 -s quality=2K -s count=1 --run
libtv node create "V1" -t video  --left "FF K1" --prompt "..." \
  -s "model=Hailuo 2.3 Fast" -s modeType=singleImage2video -s duration=6 --run
libtv download -n "V1" -o clips/ --without-ai-watermark --vip

# product work (local)
swift scripts/cutout.swift product.png cutouts/product.png      # Apple Vision subject lift
swift scripts/face_box.swift shot.png                            # face box → scale audit

# assembly (local) — see scripts/build_cut_example.py
python3 build_cut.py --version clean|led|prism
```

## Reference files

| File | What's in it |
|---|---|
| `reference/libtv-cli.md` | auth, node/edge model, params per model, **measured credit prices**, price probing, canvas-only features (运镜/特效/导演台), error catalogue |
| `reference/shot-design.md` | 15s beat structures, keyframe-must-be-mid-motion rule, K-pop pose recipes, transition/speed-ramp templates, VFX menu, typography + safe zones |
| `reference/product-consistency.md` | cutout, scale rule + audit, bottle swap with finger preservation, what Vision can and cannot separate |
| `reference/reference-analysis.md` | the local video-teardown method and its token economics |
| `reference/lessons.md` | every failure from the MIXIK run and the fix |

## Decision points to raise with Barron (don't guess)

Which SKU and its real dimensions · talent look and ethnicity · credit cap per ad · music source
(library licence may forbid re-editing) · claim substantiation ("#1 best seller") · where the CTA
points · which visual-effect variants to A/B.
