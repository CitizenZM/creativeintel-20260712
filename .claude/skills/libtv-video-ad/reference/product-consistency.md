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
