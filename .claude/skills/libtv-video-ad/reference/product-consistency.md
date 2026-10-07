# Keeping the product exact

AI models get packaging *nearly* right: silhouette and colour survive, small type and proportions
do not. The brand owner will notice. Three mechanisms, in order of preference.

## 1. Composite the real photo (best)
Any frame where the label is legible — packshots, pedestal shots, product inserts, CTA, end card —
is built locally from the official photo. Never generated.

```bash
swift scripts/cutout.swift products/item.png cutouts/item.png   # Apple Vision foreground mask
```
`VNGenerateForegroundInstanceMaskRequest` handles frosted white bottles that a white-threshold key
would eat. Crop to `getbbox()` afterwards.

Compositing recipe: contact shadow ellipse (blur ~10–30px, 25–45% opacity) + optional soft
directional shadow + a reflection copy at ~18% alpha for glossy floors. Match the plate's light
direction; brighten the cutout ~4% on high-key plates.

## 2. Swap the AI bottle for the real one (for held products)
Works on stills, and the swapped still can then be used as the first frame of a clip.
1. Read the AI bottle's axis from the image: cap-centre and base-centre coordinates.
2. Derive scale + rotation from cap→base vs the same two points measured on the cutout
   (cap centre = midpoint of the top blob down to the narrowest neck row; base = last opaque row).
3. Paste the real bottle **oversized by ~8–10%** so the AI bottle underneath is fully covered.
4. Re-paste the fingers on top: skin-hue mask (H 5–45°, S 0.15–0.75, V>0.25) inside the dilated new
   silhouette, median-filtered and feathered.

**Apple Vision person segmentation cannot do step 4** — it classifies a held bottle as part of the
person. Skin-hue masking is the workaround. Residual artefacts (cap notches, slivers between two
bottles) are acceptable in fast motion, not in hero stills.

## 3. Constrain generation (when neither is possible)
- Put the real dimension in the prompt: *"The bottle is SMALL — a 30 ml travel mist about 7 cm tall,
  roughly one quarter of her face height; do not enlarge it."*
- Describe the packaging explicitly (shape, cap type, liquid layers, wordmark orientation).
- Add *"stays exactly the same size, shape and label throughout — it must not grow or warp"* to
  every video prompt.
- Keep the product small and fast-moving in generated shots; save legible framing for composites.

## Scale audit (do this every round)
```bash
swift scripts/face_box.swift shot.png    # → "x y w h" per detected face
```
bottle height ÷ face-box height:

| Product | Real height | Target ratio |
|---|---|---|
| 30 ml travel mist | ~7 cm | 0.28–0.35 |
| 80 ml full size | ~11 cm | 0.45–0.5 |

Measured failures from the MIXIK run: beauty close-up 0.80, duo lineup 1.47 — i.e. 3–6× oversized.
**Marketing packshots exaggerate**: the brand's own hand-held photo implies a ~20 cm bottle, so it
must never be used as the scale reference. Ask for the spec in cm.

## Which SKU?
Pack shapes differ inside one product line (MIXIK 80 ml = cone bottle with sphere "gumball" cap;
30 ml = slim cylinder with a flat cap). Confirm the SKU before generating anything, and cut the
matching cutout.

## Screen plates (TVs, tablets, monitors — screen content must be real)
Video models can't render readable or accurate screen content: a Van Gogh on a frame TV, sheet
music on a tablet or a crisp HDR picture all come out mushy or invented. Don't ask the model for
the content. Ask for a **flat screen** and let the edit composite the real images onto it, following
the screen as it moves (`src/services/video-gen/edit/screen-plate.ts`, applied by edit engine v2 before
reframing, text and the end card).

1. **Video prompt (and both keyframes):** the screen is *"switched on, showing a flat, evenly lit,
   pure green (#00FF00) image edge to edge, no reflections, no UI, no text"*. Use pure black only when
   green would spill onto a face or white walls. Keep fingers and hands off the screen, or let them
   pass **in front** of it. With a green key they stay on top, but with black they would be covered.
   Keep the whole screen in frame, with no extreme angles (under ~60° off-axis).
2. **Corners:** state the screen's four inner glass corners (TL, TR, BR, BL, as 0–1 of the frame) on the
   first and last keyframe → `firstLast`. If they're unknown or the motion isn't linear, use
   `detect: "key"`. It's free: it finds the green screen every 0.5 s. `detect: "vision"` (one paid vision call
   on each of the first and last frames, then a free local edge snap) is the fallback for screens that
   aren't keyed.
3. **Contents:** list the content images and their switch times in clip seconds (time 0 = the clip's first
   frame). Use `fade` for a gallery change and `wipe` for a page turn. Give `aspect` (TV 16/9, NXTPAPER 14
   tablet ≈ 1.6) so the picture isn't stretched, and use `fit: "contain"` when nothing may be cropped
   (a sheet-music page, a UI screenshot).

```json
"locked": {
  "engine": "veo",
  "screenPlate": {
    "contents": [
      { "url": "https://…/sunflowers-vangogh.jpg", "fromSec": 0 },
      { "url": "https://…/sheet-music.png", "fromSec": 2.0, "transition": "fade" }
    ],
    "firstLast": [[[0.12,0.31],[0.86,0.28],[0.88,0.52],[0.10,0.50]],
                  [[0.19,0.37],[0.92,0.41],[0.89,0.62],[0.16,0.57]]],
    "key": "#00FF00",
    "aspect": 1.778
  }
}
```
Examples: QM8L frame TV = the painting full-screen (`fit: "cover"`). NXTPAPER 14 = a hand drawing,
then sheet music at the page-turn beat (`wipe`). QM7L = an HDR still or frame from the brand's
own footage. With a green `key` the screen colour is keyed out and the content sits underneath
(occlusion-safe). Without one, the content is laid over the stated quad with a 2 px bleed onto the bezel,
a 1.5 px feathered edge and a faint glass sheen (`glare`, default 0.06).
