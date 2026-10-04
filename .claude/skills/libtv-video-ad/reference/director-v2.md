# Director v2 — how every shot is planned, prompted, rendered and finished

Implemented in the app (`src/services/video-gen/shot-director.ts`, `edit/edit-plan.ts`, `edit/render-v2.ts`,
`openrouter-executor.ts`, PRs #85–#93, 2026-10-04). The same rules apply when planning by hand.

## 1. Selling point → proof → shot
- Pick 2–4 selling points from the product facts. Each gets a **visual proof**, never an adjective:
  brightness = a sunlit room where the picture still punches; contrast = night scene, true black beside a
  bright moon; colour = macaw feathers; HDMI = four controllers on the table; paper display = full A4 page
  of sheet music with no glare.
- Every BODY shot proves exactly one selling point; its 1–4 word on-screen keyword names it ("3,000 NITS").
- A service or promo (free installation, Black Friday price) is a shot, not a caption: installers walking
  in, a level on the wall, the TV clicking onto the mount.

## 2. Camera — every shot moves
push_in · pull_out · orbit (≈30° per 5 s clip — models can't do a true 360; fake it with the product or room
turning while the camera arcs) · arc 30–60° · track · crane · whip (lands sharp within 0.5 s; never smear the
product or a face) · rack_focus · handheld_follow. Never locked off, never "static", never frozen at the end.
No repeated move on consecutive shots. Open on a fast move; the last non-CTA shot pulls out or cranes up.

## 3. One clip = one continuous take
No cuts, no shot-size change, no "Beat 1 / Beat 2" inside a clip (the old prompt produced in-clip scene
changes). Motion starts in the first second, ends mid-movement. Movement direction carries across cuts.
Engine: one clip per shot ("full" budget mode). Action shots (big body movement) → **Kling 3.0 Std**
(bills 3 s as 5 s — $0.4158 — so render 5 s); product/atmosphere → **Veo 3.1 Lite** ($0.03/s, 4/6/8 s).

## 4. Prompts that don't look plastic
- Keyframe (55–85 words): shot size, angle, lens → subject mid-action → location + 2 lived-in props → ONE hard
  key light (source, side, colour temp) → named imperfections (pores, creases, dust, fingerprints).
- Never write photorealistic / cinematic / 8K / flawless / perfect (they pull toward the glossy render).
- Realism block appended to stills: "35mm film photograph, handheld, documentary, observational…".
- Negatives (3–5 terms, more over-constrains) go in the model's own field via OpenRouter `provider.options`:
  Kling `{kling:{negative_prompt}}` = waxy skin, plastic texture, rubbery motion, floating hair, doll-like
  features; Veo `{"google-vertex":{parameters:{negativePrompt}}}` = over-smoothed, detail loss, watercolor
  effect, painterly artifacts, pristine condition.
- Dark scenes are lit by screen glow + a practical lamp — readable on a phone.
- Screens show a specific image we own (landscape, generic sport with no league marks) — never text/UI.

## 5. Copy
- VO: ~2.6 words/s for the whole ad; most lines cover two shots (vo null on the covered shot). A too-long line
  takes over the next shots (never into the CTA) then is trimmed at a clause. A null VO stays silent — never
  fall back to the storyboard line (it gets spoken twice). The ad always ends on a spoken CTA.
- On-screen: 1–4 word keywords are always shown (even if the VO says them); HOOK = the hook ≤ 6 words.

## 6. Edit
- No framing longer than **2 s**: longer shots are cut on a beat into alternating framings (the clip's
  action continues across the cut).
- No plain cuts in the first 3 s or on the last two cuts; zoom-through-from-dark intro with a whoosh; slow
  push over the final 0.8 s.

## 7. Film finish (replaces the old grade, which caused the plastic look)
Measured on a real frame: `eq=contrast=1.04 + noise=alls=5` crushed 5.2 % of pixels to black, clipped 3.7 % of
highlights and *raised* saturation (colour noise). Now, on generated clips only:
`gblur=0.45 → curves (blacks lifted to 0.035, highlights rolled to 0.94) → saturation 0.88 → warm shadows →
luma-only temporal grain (c0s=8) → gblur=0.35 → mild vignette`. No halation/bloom (itself an AI tell).

## 8. Token economy
Director input uses short keys and drops empty fields (one call per ad, −38 % cost: $0.0103 on DeepSeek V4
Pro, reasoning off). Vision checks send 512 px JPEGs. Director review samples 8 frames at 360 px.
