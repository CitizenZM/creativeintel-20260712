# Failures from the MIXIK run and what fixed them

Chronological, because the order matters — each fix came from a specific piece of feedback.

| # | What went wrong | Root cause | Fix |
|---|---|---|---|
| 1 | Planned around a natural-language API with no parameter control | Read the agent-skill docs first, not the CLI | The `libtv` CLI exposes model/ratio/duration/mode explicitly — always check the CLI before assuming an API's limits |
| 2 | First storyboard had 6 shots in 15s | Guessed the pacing | Benchmarks run 13–19 cuts/15s; measure real ads before设计节奏 |
| 3 | Background blended with the product (pink bottle on pink) | Colour chosen for brand consistency, not contrast | Pick the背景 by complement: lilac→sky for a pink pack, peach for green, mint for red |
| 4 | AI bottles had garbled labels and wrong silhouettes | Models can't render small type | Composite the official cutout; see product-consistency.md |
| 5 | Vision person-segmentation couldn't isolate fingers from the bottle | Held objects are classified as "person" | Skin-hue mask inside the new silhouette |
| 6 | Ad read as a slideshow | Half the segments were stills with Ken Burns moves; each clip used only 1s | Only end cards are static; every other cut is a real clip with a complete action |
| 7 | The 360° orbit fell apart mid-way | Single 5s generation drifts | Two 180° halves with first/last frames, whip-blur on the seam; or use the usable head and tail of one orbit |
| 8 | Product 3–6× too large | Used the brand's own macro packshot as the scale reference | Ask for cm, convert to face-height ratio, put it in every prompt, audit with face detection |
| 9 | Dancers weren't dancing | Keyframes were static standing poses | Generate keyframes mid-movement and write two-beat motion phrases |
| 10 | Opening was dark and moody for 2–3s | Borrowed a K-pop MV silhouette opening | First frame bright, product pushed at the lens, high-key set |
| 11 | Slogan clipped at the frame edges | One long line at 96px on a 1080 frame | Two short lines, measure with `textbbox` before rendering |
| 12 | CTA text overlapped the bottle | Text and product both centred | Product low and small on CTA plates, words stacked above |
| 13 | 8.6MB masters failed to upload to the phone client | Delivery limit | Always also export a 720p CRF-28 preview (~2MB) |
| 14 | Music couldn't be re-cut per section | Mixkit licence forbids remixing | Choose a window that already contains a build→drop, or get a library that allows editing |
| 15 | Subagents couldn't write their report files | Environment blocks file writes from subagents | Have them return findings in the final message; the main session writes the files |
| 16 | CLI started failing mid-session with `用户未授权` | Token expiry | Re-login flow via ego-browser callback |

## TCL run (2026-09-10/11) — additional failures

| # | What went wrong | Root cause | Fix |
|---|---|---|---|
| 17 | "Free price probe" was not free — 11 probe nodes cost 72 credits | CLI `node create` with a reference edge is billed even without `--run` | Never create probe nodes via CLI; use the measured price table or change the model dropdown on one existing node in the web UI |
| 18 | A sound bar dropped into the middle of a TV ad felt random | Tried to feature every best seller in every ad | **One hero product per ad, at most two supporting products**, each with a reason to be in the scene |
| 19 | Tablet and phone screens were blank white in the final cut | Clips were generated with placeholder screens and never filled | Generate plain-grey screens on purpose, then composite original content locally (`scripts/screens.py`: luminance-band + low-saturation mask → largest blob → extreme-point quad → perspective warp → paste *through the mask* so fingers stay on top) |
| 20 | One clip's tablet screen faced away from camera | Keyframe composition | Use such clips as reaction shots; put screen content only where the panel is visible |
| 21 | Official TV images carried NFL marks and a player | Brand marketing art includes partner IP | Pick hero images without third-party marks, or replace the panel content with original footage |
| 22 | Assumed a Halloween / Black Friday promo existed on the site | Didn't check first | Verify live promos before writing claims; mark every unlaunched campaign detail `[占位]` |
| 23 | Centre-cropping 9:16 end cards to 4:5 / 1:1 would cut the URL and legal line | Layout expressed for one aspect | Render plates, price cards and end cards natively per ratio; only centre-crop the generated people clips |

## Working habits that paid off
- **Use the cheapest measured model, not a probe.** Seedream 4.0 image2image = 1 credit and
  Hailuo 2.3 Fast 768P = 12 credits were the cheapest verified options; composite products and
  screens locally so generation is only needed for people and hands.
- **Verify claims with measurement, not eyeballs.** Scene detection for beat accuracy, face
  detection for product scale, `ffprobe` for duration — every claim in a status report is backed.
- **Delegate research to subagents, keep production in the main session.** Reference hunting,
  music sourcing and dance-style research ran in parallel while the main session generated and
  assembled.
- **Report credits every round** (spent / remaining) and flag when a request will exceed the cap.
- **Show, don't describe**: send a contact sheet, a before/after swap, a scale card, a 720p preview.

## Review run (2026-09-11) — measured defects in the delivered v1 ads

All five were things Barron named; each was reproduced as a number before being fixed, and each
now has a `qc_gate.py` check so it cannot ship again.

| # | What went wrong | Measured | Root cause | Fix |
|---|---|---|---|---|
| 24 | "固定图片类型的画面过多" | static_share 0.53–0.61 vs 0.25–0.42 benchmark; longest still 2.7s | 8 of 15s were static composited plates | motion floor: push+bob+drift, Ken Burns, light sweep, text easing, motion blur (`motion_engine`) |
| 25 | "音乐的卡点不准" | every cut +21 ms late, bias +21 ms | `if t < beat` rounds UP to the next frame | `snap()` = nearest frame; measured bias −11 ms |
| 26 | rhythm still felt loose after the cuts were exact | only 6 of 32 beats had any visual reaction | beats without a cut got nothing | `apply_accent()` on every beat, flash on downbeats |
| 27 | "过渡不丝滑" | 100 % hard cuts | no transition layer | dissolve / whip / zoom / flash, **centred on the beat frame** |
| 28 | one CTA only | — | not parameterised | four CTA styles as `--cta 1..4`, three hooks as `--hook q|c|p` |
| 29 | audio clipping on phones | true peak **+1.5 dBFS**, −10 LUFS | no loudness stage | `-af loudnorm=I=-14:TP=-1.5:LRA=7` → −2.8 dBFS / −14.2 LUFS |
| 30 | hook had no payoff | — | hook was "footage + headline" | hook must pose a question/contrast/blast that the body answers before 5 s |
| 31 | screen content inside devices was a frozen image | — | stills composited once | animate the content with `ken_burns` before compositing |
| 32 | one people clip used 3× in 15 s | — | clip budget too thin | ≥1 clip per 1.5 s of人 footage; no clip twice+ |
| 33 | 10 s cutdown lost the drop | — | reused the 15 s window's first 10 s | cut a separate 10 s window with its own build→drop |
| 34 | mux offset suspected, never verified | lag 0 ms, corr 0.998 | assumption | `av_sync.py` once per project before blaming the edit |
| 35 | no SFX on cuts | — | never planned | SFX layer (whoosh/impact/click) — needs a licensed library, ask first |
| 36 | v2 still had one boundary 80 ms off the beat | beat_max_ms 80 | (a) zoom punch swapped content a second time at the end of its window; (b) whip blur peaked ON the beat, hiding the change | both fixed in `motion_engine`; v3 measures bias +1.9 ms, max 23 ms |
| 37 | `diagnose_cut` counted every transition twice | benchmarks read 21–34 cuts/15s | in/out spikes 0.13 s apart, merge window was 0.12 s | merge inside 0.20 s and keep the strongest frame; benchmark table re-measured (7.9–12.1) |
| 38 | a still rendered at t=20 s zoomed the product out of frame | push 2.0× | `plate_motion` age was unbounded | clamp motion age to 2.5 s |
| 39 | SFX blocked on "which sound library?" | — | assumed sounds must be sampled | synthesise them (`sfx.py`) — no licence, no cost, timings taken from the rendered boundaries |
