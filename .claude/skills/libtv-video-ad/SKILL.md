---
name: libtv-video-ad
description: LibTV 视频广告生成 — end-to-end pipeline for short vertical video ads and ad images (TikTok/Meta, 10–15s) with the LibTV CLI: brand research, reference teardown, hook grammar, beat-accurate shot design, keyframe→clip generation, product-consistency enforcement, local motion-floor assembly, and a measured QC gate. Use whenever Barron asks for AI-generated video or image ads for a brand.
tags: [video, ads, libtv, tiktok, meta, storyboard, beat-sync, motion, qc, production]
---

# LibTV 视频广告生成

Built from the MIXIK campaign (2026-09-10) and the TCL US campaign (2026-09-11), then rewritten
after the 2026-09-11 review in which all five of Barron's complaints were reproduced as numbers
and fixed in code. Everything here is measured, not assumed.


## Planning layer (2026-10 research → `src/services/creative/`, built in)
Run these before writing any script; the script writer and the director receive the result automatically.
The condensed research lives in **`reference/ad-planning-playbook.md`** — category selling-point patterns,
platform table, hook library H01–H35, end cards E01–E12, script formulas. Read it before planning by hand.
**Direction (Barron, 2026-10-06):** sell hard. Use the boldest, most persuasive wording the product's real
facts support (real numbers, superlatives, urgency); the brand owner carries the legal side. The only hard
data rule: never invent a number, rating, review or offer — every figure comes from the page, the brief or
the live promo. (`strictCompliance: true` on any action restores the old legal layer; default off.)
1. **Product brief (sp-1):** operator `{"action":"product-brief","projectId":…, "reviews":[{stars,text}…], "qa":[…], "price","listPrice","rating","reviewCount"}`.
   One structured pass → category, audience, JTBD, big idea + 3 alternates, 5–8 ranked selling points
   (claim → benefit → **proof shot** → facts), objections, keywords, beat map; stored on
   `Project.productBrief`. Feed stratified reviews (5★ / 3–4★ / 1–2★) — anxieties make the best objection busters.
2. **Campaign plan:** operator `{"action":"plan-campaign","projectId":…, "platforms":["tiktok","instagram_reels","meta_feed"],
   "goal":"promo", "promo":{"pct":20,"price":279.99,"comparePrice":349.97,"code":"NXT20","deadline":…}, "runDate":…,
   "overrides":{"tiktok":{"hookIds":["H08"],"endCardId":"E12"}}}` (Studio: `POST /api/projects/<id>/campaign-plan`, `GET` reads it).
   Per platform: profile-fitted length/aspect/pacing/voice/captions/music, **3 hook variants** (reveal + claim +
   native/demo), end card with the promo facts filled in (+ alternates), a **timed beat map** (hook → sale pitch
   inside 0–3 s for promo → one proof beat per ranked selling point using its proof shot → objection buster →
   offer → **last 1 s logo + bouncing CTA button**; product on screen ≥ 2×, every zoom lands on the product) and
   one script per hook variant. One text-model call per platform writes VO / on-screen text / hook openings; if
   it fails the deterministic scaffold copy is kept. Stored on `Project.campaignPlan`; **the script writer then
   follows the plan's beat map**, rotating the hook variants across a batch.
3. **Creative choice only:** operator `{"action":"select-creative","projectId":…, "platform":"tiktok|instagram_reels|meta_feed|youtube_shorts|youtube_instream_skippable|…", "goal":"cold|retarget|promo|awareness|app_install|lead", "promo":{price,comparePrice,code,deadline}, "runDate":…}`
   → 3 opening hooks + an end card. Price / % / coupon / deadline / rating cards need the number to exist.
4. **Platform profiles** (12): audience, length, hook second, cut rate, sound mode, caption/voice/music/CTA style,
   safe zone, do-nots — `platformBrief(id)` is the prompt block; `playbookSlice()` adds the category proof shots,
   platform grammar and hook / VO / CTA formulas (≤ 400 words) to every script-writer and director prompt.
   Make Meta and TikTok variants genuinely different concepts, not resizes.
5. **End card in the storyboard:** on the CTA frame set `locked.endCard = {id: "E02", data: {pct, code, price,
   comparePrice, tag, sticker}}`. Renderable: E01, E02, E03, E04, E08, E09, E12.
6. **First + last frame anchoring (strict consistency):** every generated segment ≥ ~3 s gets an end keyframe
   `K<n>E` edited from its approved start keyframe + the casting sheet + the product photo, and the clip is
   generated between both anchors (Veo 3.1 / Kling 3.0 / Seedance). Plan people and product segments at 3–4 s
   with framings inside (the edit still cuts every ≤ 2 s); set `locked.endState` for the exact end pose, or
   `anchorEnd:false` to opt out. Keyframes edited from references are QC'd for identity and re-rolled up to 2×.
   Product-detail shots (sides, 360°, ports, close-ups) are built from official photos, never generated.
Research files: `out/research/ad-research/01–04*.md`.

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

1. **Brand intake** — `scripts/shopify_research.py` (best-selling order, variants + compare-at prices,
   spec table, service/promo lines, every official image tagged for rights). Reviews give the real
   use scenes. Official photos are the only source of truth for the product. Read live promos,
   prices and services off the page so every number in the ad is real; mark unannounced details `[占位]`. See `reference/product-research.md`.
2. **Reference teardown** — `scripts/analyze_reference.py` on 3–5 benchmark ads. Produce a
   per-cut shot table *and* run `scripts/diagnose_cut.py` on each so the campaign has its own
   measured targets for cut density, static share and motion. Cite video + timestamp for every
   borrowed move.
3. **Concept + hook** — selling points first: each gets a visual proof (`reference/director-v2.md` §1).
   Pick a hook structure per ad (question / contrast / product-blast, `reference/motion-and-rhythm.md`
   §5) and the payoff it sets up; a promo/service is shown as action by 5 s. A hook with no payoff is a
   rejected concept. For promo campaigns deliver the approval plan in
   `reference/promo-campaign-planning.md` — 3 creatives per product — and stop until approved.
4. **Script** — beat grid from `aubio`, per-cut 画面/运镜/转场/字幕/声音, **a transition named for
   every boundary**, generation plan, cost estimate. Approval gate before spending credits.
5. **Keyframes** — images first (cheap). A clip inherits its first frame: static keyframe →
   static clip. Generate mid-movement. See `reference/shot-design.md`.
6. **Clips** — image-to-video on **Seedance 2.5** (`star-video2.5`), Barron's standing choice.
   It bills per second (uploaded reference video included), ≈39 credits/s at 720P, so generate
   the shortest clip that holds the action (4–5 s) and cut two or three shots out of it. Budget
   roughly one clip per 1.5 s of人 footage; no clip may appear more than twice in 15 s. Agree a
   credit cap before the batch — see `reference/libtv-cli.md`.
7. **Assembly + QC** — build with `scripts/motion_engine.py` (motion floor, `snap()`, centred
   transitions, per-beat accents), then `scripts/qc_gate.py` on every ratio and duration, then
   export 9:16 master + natively-laid-out 4:5 / 1:1 + 720p preview.

## Server render path (CreativeIntel app, 2026-10)

The app now renders the same plan on its own: shot director v2 (selling points, a camera move per shot,
VO fitted at 2.6 words/s, 1–4 word keywords) → Seedream 5 Flash cast-locked keyframes → Veo 3.1 Lite clips,
Kling 3.0 for action shots → edit v2 (≤ 2 s framings, strong open/close transitions, film finish) → QC 13
checks + AI director review. ~$1.5 per 20 s ad on OpenRouter. Rules: `reference/director-v2.md`.

## Hard rules learned the hard way

- **No plastic**: never prompt "photorealistic / cinematic / 8K"; name imperfections; one hard key light;
  negatives (3–5) in the model's own field; finish with lifted blacks + luma grain, never a contrast boost
  with colour noise (measured: it crushed 5 % of pixels and raised saturation).
- **Every shot moves** (push / pull / orbit / arc / track / crane / whip / rack) and **no framing holds over 2 s**.
- **Rights**: no league marks (NFL…), film posters or app UI from official images in an ad.

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
- **Synthesise the SFX** (`scripts/sfx.py`) instead of waiting for a sound-library decision, and
  take their timings from the rendered boundary frames.
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
  -s "model=Seedance 2.5" -s modeType=singleImage2video -s ratio=9:16 \
  -s resolution=720p -s duration=5 -s enableSound=off --run
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
| `reference/director-v2.md` | selling point → proof, camera grammar, anti-plastic prompting + negatives, Kling/Veo routing, VO budget, 2 s rule, film finish, token economy |
| `reference/product-research.md` | best-seller order, specs/prices/discounts, verifying promos & services, scenes, image rights |
| `reference/ad-planning-playbook.md` | condensed ad research: category selling points + proof shots, platform table, hooks H01–H35, end cards E01–E12, hook / VO / CTA formulas, `plan-campaign` usage — **read before planning** |
| `reference/promo-campaign-planning.md` | BF/CM-style 15 s plan template (3 creatives per product), service-as-hero messaging, first-3-s sale pitch |
| `reference/retrospective-tcl-bfcm.md` | TCL BF 2026-10: every failure → rule (hook pitch, casting, bezels, zooms, VO, captions, TTS, SFX, music, CTA, QC, cost) and the skill roadmap — **read before any promo ad** |

## Scripts

| Script | Use |
|---|---|
| `motion_engine.py` | `snap`, `Timeline`, `apply_transition`, `apply_accent`, `ken_burns`, `light_sweep`, `plate_motion`, `motion_blur` |
| `qc_gate.py` | the ship gate (exits non-zero on failure) |
| `sfx.py` | synthesised whoosh / impact / click bed — no sound library, no licence question |
| `diagnose_cut.py` | cuts, static share, motion, beat offsets for any video |
| `av_sync.py` | audio lag between a render and its source music |
| `screens.py` | composite original content into device panels |
| `shopify_research.py` | brand-store intake: best sellers, specs, prices, service lines, images + rights tags |
| `analyze_reference.py` | reference-ad teardown with transcript + contact sheets |
| `cutout.swift` / `face_box.swift` / `person_mask.swift` | Apple Vision subject lift, scale audit |
| `build_cut_example.py` / `build_multi_ratio_example.py` | skeleton builders |

## Decision points to raise with Barron (don't guess)

SKU and real dimensions · talent look and ethnicity · credit cap per ad · music source (licence
may forbid re-editing) and whether an SFX library is available · where the
CTA points · which hook variant and CTA style to ship · which visual-effect variants to A/B.
